import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  NotificationBlocker,
  NotificationTemplateDetail,
  NotificationTemplateListResult,
  NotificationTemplateSummary,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTemplateDto,
  ListTemplatesDto,
  UpdateTemplateDto,
} from '../dto/notifications.dto';
import { NOTIFICATION_LIMITS, isSupportedEvent } from '../notification-policy';

export const TEMPLATES_VIEW_PERMISSION = 'notifications.templates.view';
export const TEMPLATES_MANAGE_PERMISSION = 'notifications.templates.manage';
export const TEMPLATES_DELETE_PERMISSION = 'notifications.templates.delete';

const NOT_REACHABLE = 'Notification template not found';

/**
 * Notification template administration.
 *
 * # Editing never rewrites history
 *
 * `update` bumps `version` and changes the template row. It does not touch a
 * single `Notification`, because notifications carry their own frozen `title`
 * and `message` rendered at creation. That is Rule 40 and Scenario 8, and it
 * holds by construction rather than by this service being careful — there is no
 * code path here that could rewrite created content even if someone tried.
 *
 * # Deletion is refused three ways
 *
 * A protected system template is never deletable (Rule 33). A template
 * referenced by a rule or by any notification is never deletable (Rules 36, 37;
 * Scenarios 10, 11) — deactivation is the sanctioned removal. Only an
 * unreferenced, non-system template may go (Scenario 48).
 *
 * The blockers are *named* in the response rather than returned as a bare 409,
 * because an administrator refused a deletion needs to know which rule to
 * repoint before they can proceed.
 */
@Injectable()
export class NotificationTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthContext,
    query: ListTemplatesDto,
    meta: RequestMeta,
  ): Promise<NotificationTemplateListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? NOTIFICATION_LIMITS.LIST_PAGE_SIZE;

    // Scenario 9: organization scope, from the JWT and nowhere else.
    const where = {
      orgId: actor.orgId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.channel ? { channel: query.channel as never } : {}),
      ...(query.eventType ? { eventType: query.eventType as never } : {}),
      ...(query.search
        ? {
            OR: [
              {
                name: { contains: query.search, mode: 'insensitive' as const },
              },
              {
                code: { contains: query.search, mode: 'insensitive' as const },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notificationTemplate.findMany({
        where,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notificationTemplate.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toSummary(row)),
      total,
      page,
      pageSize,
    };
  }

  async detail(
    actor: AuthContext,
    templateId: string,
    meta: RequestMeta,
  ): Promise<NotificationTemplateDetail> {
    const row = await this.findInScope(actor, templateId, meta);
    const [ruleCount, notificationCount] = await this.referenceCounts(
      actor.orgId,
      templateId,
    );

    return {
      ...this.toSummary(row),
      subject: row.subject ?? undefined,
      titleTemplate: row.titleTemplate ?? undefined,
      messageTemplate: row.body,
      sensitivity: row.sensitivity,
      createdAt: row.createdAt.toISOString(),
      ruleCount,
      notificationCount,
    };
  }

  /** Scenario 6. */
  async create(
    actor: AuthContext,
    dto: CreateTemplateDto,
    meta: RequestMeta,
  ): Promise<NotificationTemplateDetail> {
    this.assertContentPolicy(dto.channel, dto.containsPii ?? false);
    this.assertSupportedEvent(dto.sourceModule, dto.eventType);

    // Scenario 7. Checked here so the refusal names the conflict; the unique
    // index is what actually guarantees it under a race.
    const clash = await this.prisma.notificationTemplate.findFirst({
      where: {
        orgId: actor.orgId,
        OR: [
          { code: dto.code, channel: dto.channel as never },
          { name: dto.name },
        ],
      },
      select: { code: true, name: true },
    });

    if (clash) {
      throw new ConflictException(
        clash.name === dto.name
          ? `A template named "${dto.name}" already exists.`
          : `A template with code "${dto.code}" already exists for the ${dto.channel} channel.`,
      );
    }

    const created = await this.prisma.notificationTemplate.create({
      data: {
        orgId: actor.orgId,
        name: dto.name,
        code: dto.code,
        category: dto.category,
        sourceModule: dto.sourceModule,
        eventType: dto.eventType as never,
        channel: dto.channel as never,
        status: dto.status as never,
        subject: dto.subject ?? null,
        titleTemplate: dto.titleTemplate ?? null,
        body: dto.messageTemplate,
        locale: dto.locale ?? 'en',
        containsPii: dto.containsPii ?? false,
        sensitivity: dto.sensitivity ?? 'INTERNAL',
        createdBy: actor.userId,
        updatedBy: actor.userId,
      },
      select: { templateId: true },
    });

    await this.record(
      actor,
      meta,
      AuditAction.NOTIFICATION_TEMPLATE_CREATED,
      created.templateId,
      { code: dto.code, channel: dto.channel, status: dto.status },
    );

    return this.detail(actor, created.templateId, meta);
  }

  /**
   * Scenario 8.
   *
   * Bumps `version` and leaves every existing notification untouched. Note what
   * this method cannot change: `code` and `channel` are absent from the DTO
   * because together they are the template's identity, and `eventType` because
   * a template that starts describing a different event would misrepresent
   * every notification already attributed to it.
   */
  async update(
    actor: AuthContext,
    templateId: string,
    dto: UpdateTemplateDto,
    meta: RequestMeta,
  ): Promise<NotificationTemplateDetail> {
    const before = await this.findInScope(actor, templateId, meta);

    const containsPii = dto.containsPii ?? before.containsPii;
    this.assertContentPolicy(before.channel, containsPii);

    if (dto.name && dto.name !== before.name) {
      const clash = await this.prisma.notificationTemplate.findFirst({
        where: { orgId: actor.orgId, name: dto.name },
        select: { templateId: true },
      });
      if (clash) {
        throw new ConflictException(
          `A template named "${dto.name}" already exists.`,
        );
      }
    }

    const result = await this.prisma.notificationTemplate.updateMany({
      where: {
        orgId: actor.orgId,
        templateId,
        // Optimistic concurrency, as the same predicate rather than a
        // read-then-compare: two editors saving at once must not both succeed.
        version: dto.expectedVersion,
      },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject ?? null } : {}),
        ...(dto.titleTemplate !== undefined
          ? { titleTemplate: dto.titleTemplate ?? null }
          : {}),
        ...(dto.messageTemplate ? { body: dto.messageTemplate } : {}),
        ...(dto.containsPii !== undefined
          ? { containsPii: dto.containsPii }
          : {}),
        ...(dto.sensitivity ? { sensitivity: dto.sensitivity } : {}),
        updatedBy: actor.userId,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      throw new ConflictException(
        'This template was changed by someone else. Reload and try again.',
      );
    }

    await this.record(
      actor,
      meta,
      AuditAction.NOTIFICATION_TEMPLATE_UPDATED,
      templateId,
      { fromVersion: dto.expectedVersion },
    );

    return this.detail(actor, templateId, meta);
  }

  /**
   * Scenarios 10 and 12.
   *
   * Deactivation is the sanctioned way to retire a referenced template: it
   * stops new notifications using it (Rule 38) while every historical record
   * stays exactly as it was.
   */
  async setStatus(
    actor: AuthContext,
    templateId: string,
    status: 'ACTIVE' | 'INACTIVE',
    meta: RequestMeta,
  ): Promise<NotificationTemplateDetail> {
    await this.findInScope(actor, templateId, meta);

    await this.prisma.notificationTemplate.update({
      where: { orgId_templateId: { orgId: actor.orgId, templateId } },
      data: { status, updatedBy: actor.userId },
    });

    await this.record(
      actor,
      meta,
      status === 'ACTIVE'
        ? AuditAction.NOTIFICATION_TEMPLATE_ACTIVATED
        : AuditAction.NOTIFICATION_TEMPLATE_DEACTIVATED,
      templateId,
      { status },
    );

    return this.detail(actor, templateId, meta);
  }

  /** Scenarios 11 and 48. */
  async remove(
    actor: AuthContext,
    templateId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const template = await this.findInScope(actor, templateId, meta);
    const blockers = await this.deletionBlockers(actor.orgId, template);

    if (blockers.length > 0) {
      await this.record(
        actor,
        meta,
        AuditAction.NOTIFICATION_TEMPLATE_DELETE_BLOCKED,
        templateId,
        { blockers: blockers.map((blocker) => blocker.key) },
      );

      throw new ConflictException({
        message:
          'This template cannot be deleted. Deactivate it, or remove what references it first.',
        code: 'TEMPLATE_DELETE_BLOCKED',
        blockers,
      });
    }

    await this.prisma.notificationTemplate.delete({
      where: { orgId_templateId: { orgId: actor.orgId, templateId } },
    });

    await this.record(
      actor,
      meta,
      AuditAction.NOTIFICATION_TEMPLATE_DELETED,
      templateId,
      { code: template.code },
    );
  }

  /**
   * Why a template cannot be deleted, named rather than merely counted.
   *
   * An administrator refused a deletion needs to know which rule to repoint;
   * "409 Conflict" tells them only that they failed.
   */
  private async deletionBlockers(
    orgId: string,
    template: { templateId: string; isSystem: boolean },
  ): Promise<NotificationBlocker[]> {
    const blockers: NotificationBlocker[] = [];

    if (template.isSystem) {
      // Rule 33. A protected template may be edited and deactivated, never
      // deleted — an organization that could delete one could break its own
      // mandatory notifications.
      blockers.push({
        key: 'SYSTEM_TEMPLATE',
        reason:
          'This is a protected system template. It can be deactivated but not deleted.',
      });
    }

    const [ruleCount, notificationCount] = await this.referenceCounts(
      orgId,
      template.templateId,
    );

    if (ruleCount > 0) {
      blockers.push({
        key: 'REFERENCED_BY_RULES',
        reason: `${ruleCount} event rule${ruleCount === 1 ? '' : 's'} still use this template.`,
      });
    }

    if (notificationCount > 0) {
      // Rules 39 and 70: historical notifications cite the template version
      // that produced them, and that evidence is retained.
      blockers.push({
        key: 'REFERENCED_BY_HISTORY',
        reason: `${notificationCount} notification${notificationCount === 1 ? '' : 's'} were created from this template and are retained for audit.`,
      });
    }

    return blockers;
  }

  private async referenceCounts(
    orgId: string,
    templateId: string,
  ): Promise<[number, number]> {
    return Promise.all([
      this.prisma.notificationEventRule.count({ where: { orgId, templateId } }),
      this.prisma.notification.count({ where: { orgId, templateId } }),
    ]);
  }

  /**
   * Rules 55 and 56, refused at the service as well as by the renderer and a
   * CHECK constraint. Three layers because customer data leaving on an
   * unencrypted channel is not recoverable once it has happened.
   */
  private assertContentPolicy(channel: string, containsPii: boolean): void {
    if (containsPii && channel !== 'IN_APP') {
      throw new BadRequestException(
        'A template containing customer or financial detail may be used only on the in-app channel.',
      );
    }
  }

  /** Scenario 15, applied to templates as well as rules. */
  private assertSupportedEvent(sourceModule: string, eventType: string): void {
    if (!isSupportedEvent(sourceModule, eventType)) {
      throw new BadRequestException(
        `${sourceModule} does not raise ${eventType}. Choose an event the module actually publishes.`,
      );
    }
  }

  private async findInScope(
    actor: AuthContext,
    templateId: string,
    meta: RequestMeta,
  ) {
    const row = await this.prisma.notificationTemplate.findFirst({
      where: { orgId: actor.orgId, templateId },
    });

    if (!row) {
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.NOTIFICATION_SCOPE_DENIED,
          entityType: 'NOTIFICATION_TEMPLATE',
          entityId: templateId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
        })
        .catch(() => undefined);

      // 404, never 403: Scenario 9 requires another organization's templates
      // not be exposed, and a 403 would confirm one exists.
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  private async record(
    actor: AuthContext,
    meta: RequestMeta,
    action: string,
    templateId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit
      .record({
        orgId: actor.orgId,
        action,
        entityType: 'NOTIFICATION_TEMPLATE',
        entityId: templateId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata,
      })
      .catch(() => undefined);
  }

  private toSummary(row: {
    templateId: string;
    name: string;
    code: string;
    category: string;
    sourceModule: string;
    eventType: string;
    channel: string;
    status: string;
    version: number;
    isSystem: boolean;
    containsPii: boolean;
    locale: string;
    updatedAt: Date;
  }): NotificationTemplateSummary {
    return {
      templateId: row.templateId,
      name: row.name,
      code: row.code,
      category: row.category,
      sourceModule: row.sourceModule,
      eventType: row.eventType,
      channel: row.channel as NotificationTemplateSummary['channel'],
      status: row.status as NotificationTemplateSummary['status'],
      version: row.version,
      isSystem: row.isSystem,
      containsPii: row.containsPii,
      locale: row.locale,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
