import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  NotificationBlocker,
  NotificationEventRuleDetail,
  NotificationEventRuleListResult,
  NotificationEventRuleSummary,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateRuleDto,
  ListRulesDto,
  UpdateRuleDto,
} from '../dto/notifications.dto';
import { NOTIFICATION_LIMITS, isSupportedEvent } from '../notification-policy';

export const RULES_VIEW_PERMISSION = 'notifications.rules.view';
export const RULES_MANAGE_PERMISSION = 'notifications.rules.manage';
export const RULES_DELETE_PERMISSION = 'notifications.rules.delete';

const NOT_REACHABLE = 'Notification rule not found';

/**
 * Notification event rule administration.
 *
 * # Reads 404, writes 403
 *
 * The two are deliberately different, following the convention Modules 13 and
 * 15 settled on.
 *
 * A *read* of a rule outside the caller's scope is a 404: a 403 would confirm
 * the rule exists in another branch, which is a disclosure in itself.
 *
 * A *write* that explicitly names another branch is a 403 (Scenario 41). The
 * caller did not stumble onto something they cannot see — they asked for a
 * branch by id and must be told they may not have it. A 404 there would be
 * misleading, because the branch plainly exists.
 *
 * # A rule that cannot resolve anybody is refused at configuration time
 *
 * Scenario 15 for the (module, event) pair, and the strategy-coherence checks
 * for the recipient fields. Both are also CHECK constraints. The constraint is
 * the guarantee; this is what turns a violation into a readable 400 rather than
 * an opaque 503, and what stops a rule being saved that would fail silently at
 * 2 a.m. as an absence of notifications.
 */
@Injectable()
export class NotificationRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthContext,
    query: ListRulesDto,
    meta: RequestMeta,
  ): Promise<NotificationEventRuleListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? NOTIFICATION_LIMITS.LIST_PAGE_SIZE;

    const where = {
      orgId: actor.orgId,
      // A branch-confined caller sees their own branch's rules and the
      // organization-wide ones that also govern their branch.
      ...(actor.branchId
        ? { OR: [{ branchId: actor.branchId }, { branchId: null }] }
        : {}),
      ...(query.eventType ? { eventType: query.eventType as never } : {}),
      ...(query.channel ? { channel: query.channel as never } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notificationEventRule.findMany({
        where,
        include: {
          template: { select: { name: true } },
          branch: { select: { name: true } },
        },
        orderBy: [{ eventType: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notificationEventRule.count({ where }),
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
    ruleId: string,
    meta: RequestMeta,
  ): Promise<NotificationEventRuleDetail> {
    const row = await this.findInScope(actor, ruleId, meta);
    const notificationCount = await this.prisma.notification.count({
      where: { orgId: actor.orgId, ruleId },
    });

    return {
      ...this.toSummary(row),
      recipientRoleCode: row.recipientRoleCode ?? undefined,
      recipientPermissionCode: row.recipientPermissionCode ?? undefined,
      explicitRecipientUserIds: row.explicitRecipientUserIds,
      maxAttempts: row.maxAttempts,
      backoffBaseSeconds: row.backoffBaseSeconds,
      sendImmediately: row.sendImmediately,
      scheduledOffsetDays: row.scheduledOffsetDays ?? undefined,
      createdAt: row.createdAt.toISOString(),
      notificationCount,
    };
  }

  /** Scenario 14. */
  async create(
    actor: AuthContext,
    dto: CreateRuleDto,
    meta: RequestMeta,
  ): Promise<NotificationEventRuleDetail> {
    const branchId = await this.resolveBranch(actor, dto.branchId, meta);

    this.assertSupportedEvent(dto.sourceModule, dto.eventType);
    this.assertStrategyCoherent(dto);
    await this.assertTemplateUsable(actor, dto.templateId, dto.channel);

    const clash = await this.prisma.notificationEventRule.findFirst({
      where: { orgId: actor.orgId, name: dto.name },
      select: { ruleId: true },
    });
    if (clash) {
      throw new ConflictException(`A rule named "${dto.name}" already exists.`);
    }

    const created = await this.prisma.notificationEventRule.create({
      data: {
        orgId: actor.orgId,
        name: dto.name,
        branchId,
        eventType: dto.eventType as never,
        sourceModule: dto.sourceModule,
        sourceTrigger: dto.sourceTrigger,
        recipientStrategy: dto.recipientStrategy as never,
        recipientRoleCode: dto.recipientRoleCode ?? null,
        recipientPermissionCode: dto.recipientPermissionCode ?? null,
        explicitRecipientUserIds: dto.explicitRecipientUserIds ?? [],
        channel: dto.channel as never,
        templateId: dto.templateId,
        priority: (dto.priority ?? 'NORMAL') as never,
        isMandatory: dto.isMandatory ?? false,
        maxAttempts: dto.maxAttempts ?? NOTIFICATION_LIMITS.MAX_ATTEMPTS,
        backoffBaseSeconds:
          dto.backoffBaseSeconds ?? NOTIFICATION_LIMITS.BACKOFF_BASE_SECONDS,
        sendImmediately: dto.sendImmediately ?? true,
        scheduledOffsetDays: dto.scheduledOffsetDays ?? null,
        isActive: dto.isActive ?? true,
      },
      select: { ruleId: true },
    });

    await this.record(
      actor,
      meta,
      AuditAction.NOTIFICATION_RULE_CREATED,
      created.ruleId,
      {
        eventType: dto.eventType,
        strategy: dto.recipientStrategy,
        channel: dto.channel,
        isMandatory: dto.isMandatory ?? false,
        branchId,
      },
    );

    return this.detail(actor, created.ruleId, meta);
  }

  async update(
    actor: AuthContext,
    ruleId: string,
    dto: UpdateRuleDto,
    meta: RequestMeta,
  ): Promise<NotificationEventRuleDetail> {
    const before = await this.findInScope(actor, ruleId, meta);
    const branchId =
      dto.branchId === undefined
        ? before.branchId
        : await this.resolveBranch(actor, dto.branchId, meta);

    // Coherence is checked against the *merged* rule, not the patch: a partial
    // update that switches to ROLE while leaving the role code unset would
    // otherwise pass a patch-only check and fail at the CHECK constraint.
    this.assertStrategyCoherent({
      recipientStrategy: dto.recipientStrategy ?? before.recipientStrategy,
      recipientRoleCode: dto.recipientRoleCode ?? before.recipientRoleCode,
      recipientPermissionCode:
        dto.recipientPermissionCode ?? before.recipientPermissionCode,
      explicitRecipientUserIds:
        dto.explicitRecipientUserIds ?? before.explicitRecipientUserIds,
      sendImmediately: dto.sendImmediately ?? before.sendImmediately,
      scheduledOffsetDays:
        dto.scheduledOffsetDays ?? before.scheduledOffsetDays ?? undefined,
    });

    if (dto.templateId && dto.templateId !== before.templateId) {
      await this.assertTemplateUsable(actor, dto.templateId, before.channel);
    }

    const result = await this.prisma.notificationEventRule.updateMany({
      where: { orgId: actor.orgId, ruleId, version: dto.expectedVersion },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.branchId !== undefined ? { branchId } : {}),
        ...(dto.recipientStrategy
          ? { recipientStrategy: dto.recipientStrategy as never }
          : {}),
        ...(dto.recipientRoleCode !== undefined
          ? { recipientRoleCode: dto.recipientRoleCode ?? null }
          : {}),
        ...(dto.recipientPermissionCode !== undefined
          ? { recipientPermissionCode: dto.recipientPermissionCode ?? null }
          : {}),
        ...(dto.explicitRecipientUserIds
          ? { explicitRecipientUserIds: dto.explicitRecipientUserIds }
          : {}),
        ...(dto.templateId ? { templateId: dto.templateId } : {}),
        ...(dto.priority ? { priority: dto.priority as never } : {}),
        ...(dto.isMandatory !== undefined
          ? { isMandatory: dto.isMandatory }
          : {}),
        ...(dto.maxAttempts ? { maxAttempts: dto.maxAttempts } : {}),
        ...(dto.backoffBaseSeconds
          ? { backoffBaseSeconds: dto.backoffBaseSeconds }
          : {}),
        ...(dto.sendImmediately !== undefined
          ? { sendImmediately: dto.sendImmediately }
          : {}),
        ...(dto.scheduledOffsetDays !== undefined
          ? { scheduledOffsetDays: dto.scheduledOffsetDays ?? null }
          : {}),
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      throw new ConflictException(
        'This rule was changed by someone else. Reload and try again.',
      );
    }

    await this.record(
      actor,
      meta,
      AuditAction.NOTIFICATION_RULE_UPDATED,
      ruleId,
      { fromVersion: dto.expectedVersion },
    );

    return this.detail(actor, ruleId, meta);
  }

  /** Deactivation, the reversible way to stop a rule firing. */
  async setActive(
    actor: AuthContext,
    ruleId: string,
    isActive: boolean,
    meta: RequestMeta,
  ): Promise<NotificationEventRuleDetail> {
    await this.findInScope(actor, ruleId, meta);

    await this.prisma.notificationEventRule.update({
      where: { orgId_ruleId: { orgId: actor.orgId, ruleId } },
      data: { isActive, version: { increment: 1 } },
    });

    await this.record(
      actor,
      meta,
      AuditAction.NOTIFICATION_RULE_DEACTIVATED,
      ruleId,
      { isActive },
    );

    return this.detail(actor, ruleId, meta);
  }

  /** Scenario 48, with Scenario 11's refusal when history references it. */
  async remove(
    actor: AuthContext,
    ruleId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.findInScope(actor, ruleId, meta);

    const notificationCount = await this.prisma.notification.count({
      where: { orgId: actor.orgId, ruleId },
    });

    if (notificationCount > 0) {
      const blockers: NotificationBlocker[] = [
        {
          key: 'REFERENCED_BY_HISTORY',
          reason: `${notificationCount} notification${notificationCount === 1 ? '' : 's'} were produced by this rule and are retained for audit.`,
        },
      ];

      await this.record(
        actor,
        meta,
        AuditAction.NOTIFICATION_RULE_DELETE_BLOCKED,
        ruleId,
        { notificationCount },
      );

      throw new ConflictException({
        message:
          'This rule cannot be deleted. Deactivate it instead — its notification history is retained.',
        code: 'RULE_DELETE_BLOCKED',
        blockers,
      });
    }

    await this.prisma.notificationEventRule.delete({
      where: { orgId_ruleId: { orgId: actor.orgId, ruleId } },
    });

    await this.record(
      actor,
      meta,
      AuditAction.NOTIFICATION_RULE_DELETED,
      ruleId,
      {},
    );
  }

  /**
   * Narrow a requested branch to what the caller may actually configure.
   *
   * Scenario 41: a branch-confined administrator naming another branch is
   * refused with a 403, not silently rewritten to their own — silently
   * narrowing would let them believe they had configured Branch B.
   *
   * An organization-wide caller may name any branch or none.
   */
  private async resolveBranch(
    actor: AuthContext,
    requested: string | undefined,
    meta: RequestMeta,
  ): Promise<string | null> {
    if (!actor.branchId) return requested ?? null;

    if (requested && requested !== actor.branchId) {
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.NOTIFICATION_SCOPE_DENIED,
          entityType: 'NOTIFICATION_RULE',
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            requestedBranchId: requested,
            actorBranchId: actor.branchId,
          },
        })
        .catch(() => undefined);

      throw new ForbiddenException(
        'You can only configure notification rules for your own branch.',
      );
    }

    // A branch-confined caller's rule is their branch's, even if they sent
    // nothing: an organization-wide rule is a wider authority than they hold.
    return actor.branchId;
  }

  /** Scenario 15. */
  private assertSupportedEvent(sourceModule: string, eventType: string): void {
    if (!isSupportedEvent(sourceModule, eventType)) {
      throw new BadRequestException(
        `${sourceModule} does not raise ${eventType}. No rule can match that combination, so it cannot be activated.`,
      );
    }
  }

  /**
   * Rule 42, mirroring `notification_event_rules_strategy_fields`.
   *
   * The constraint is the guarantee; this makes the refusal a readable 400
   * naming the missing field rather than a 503 carrying a constraint name.
   */
  private assertStrategyCoherent(rule: {
    recipientStrategy: string;
    recipientRoleCode?: string | null;
    recipientPermissionCode?: string | null;
    explicitRecipientUserIds?: string[];
    sendImmediately?: boolean;
    scheduledOffsetDays?: number;
  }): void {
    if (rule.recipientStrategy === 'ROLE' && !rule.recipientRoleCode) {
      throw new BadRequestException(
        'Notifying by role needs a role. Without one the rule would resolve nobody.',
      );
    }

    if (
      rule.recipientStrategy === 'BRANCH_USER_GROUP' &&
      !rule.recipientPermissionCode
    ) {
      throw new BadRequestException(
        'Notifying a branch user group needs a permission to select them by.',
      );
    }

    if (
      rule.recipientStrategy === 'EXPLICIT' &&
      (rule.explicitRecipientUserIds ?? []).length === 0
    ) {
      throw new BadRequestException(
        'An explicit rule needs at least one recipient.',
      );
    }

    if (
      rule.sendImmediately === false &&
      (rule.scheduledOffsetDays === null ||
        rule.scheduledOffsetDays === undefined)
    ) {
      throw new BadRequestException(
        'A scheduled rule needs an offset, or it would fire on the source event like an immediate one.',
      );
    }
  }

  /**
   * Rule 38 and Scenario 12: an inactive template cannot back a new rule, and a
   * template's channel must match the rule's or nothing it renders can be sent.
   */
  private async assertTemplateUsable(
    actor: AuthContext,
    templateId: string,
    channel: string,
  ): Promise<void> {
    const template = await this.prisma.notificationTemplate.findFirst({
      where: { orgId: actor.orgId, templateId },
      select: { status: true, channel: true },
    });

    if (!template) {
      throw new BadRequestException(
        'That notification template does not exist.',
      );
    }

    if (template.status !== 'ACTIVE') {
      throw new BadRequestException(
        'That template is not active. An inactive template cannot be used for new notifications.',
      );
    }

    if (template.channel !== channel) {
      throw new BadRequestException(
        `That template is for the ${template.channel} channel, but this rule sends on ${channel}.`,
      );
    }
  }

  private async findInScope(
    actor: AuthContext,
    ruleId: string,
    meta: RequestMeta,
  ) {
    const row = await this.prisma.notificationEventRule.findFirst({
      where: {
        orgId: actor.orgId,
        ruleId,
        ...(actor.branchId
          ? { OR: [{ branchId: actor.branchId }, { branchId: null }] }
          : {}),
      },
      include: {
        template: { select: { name: true } },
        branch: { select: { name: true } },
      },
    });

    if (!row) {
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.NOTIFICATION_SCOPE_DENIED,
          entityType: 'NOTIFICATION_RULE',
          entityId: ruleId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
        })
        .catch(() => undefined);

      // 404 on a read — see the class comment on why writes differ.
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  private async record(
    actor: AuthContext,
    meta: RequestMeta,
    action: string,
    ruleId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit
      .record({
        orgId: actor.orgId,
        action,
        entityType: 'NOTIFICATION_RULE',
        entityId: ruleId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata,
      })
      .catch(() => undefined);
  }

  private toSummary(row: {
    ruleId: string;
    name: string;
    eventType: string;
    sourceModule: string;
    sourceTrigger: string;
    recipientStrategy: string;
    channel: string;
    templateId: string;
    priority: string;
    isMandatory: boolean;
    isActive: boolean;
    branchId: string | null;
    version: number;
    updatedAt: Date;
    template?: { name: string } | null;
    branch?: { name: string } | null;
  }): NotificationEventRuleSummary {
    return {
      ruleId: row.ruleId,
      name: row.name,
      eventType: row.eventType,
      sourceModule: row.sourceModule,
      sourceTrigger: row.sourceTrigger,
      recipientStrategy:
        row.recipientStrategy as NotificationEventRuleSummary['recipientStrategy'],
      channel: row.channel as NotificationEventRuleSummary['channel'],
      templateId: row.templateId,
      templateName: row.template?.name,
      priority: row.priority as NotificationEventRuleSummary['priority'],
      isMandatory: row.isMandatory,
      isActive: row.isActive,
      branchId: row.branchId ?? undefined,
      branchName: row.branch?.name,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
