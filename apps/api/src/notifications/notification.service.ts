import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  NotificationDetail,
  NotificationListResult,
  NotificationSummary,
} from '@lms/types';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { ListNotificationsDto } from './dto/notifications.dto';
import { NOTIFICATION_LIMITS } from './notification-policy';

const NOT_REACHABLE = 'Notification not found';

/** What the list and detail reads select. */
const NOTIFICATION_SELECT = {
  notificationId: true,
  eventType: true,
  title: true,
  message: true,
  priority: true,
  status: true,
  readStatus: true,
  readAt: true,
  archivedAt: true,
  isMandatory: true,
  sourceType: true,
  sourceId: true,
  branchId: true,
  createdAt: true,
} as const;

/**
 * A user's own notification centre.
 *
 * # There is no permission on this surface
 *
 * Deliberate, and the one non-obvious decision in Module 16's permission model.
 * Rule 53 gives every user the notifications addressed to them, and Rule 47
 * makes some of them mandatory — an operational alert nobody may switch off. A
 * permission gate would mean an unpermissioned user silently missing exactly
 * those. So `/notifications` requires authentication and nothing more.
 *
 * `notifications.view` exists for a different thing entirely: reading *other*
 * users' notification content inside Delivery Monitoring.
 *
 * # Every query is bounded by the caller
 *
 * `where: { orgId: actor.orgId, recipientUserId: actor.userId }`, always, with
 * no DTO field able to influence either half. That is Rules 5 and 53 and
 * Scenarios 1 and 42 made structural: there is no request a client can
 * construct that asks for someone else's notifications.
 *
 * A notification belonging to another user is a **404, not a 403** — the
 * convention Modules 04, 12 and 13 already use. A 403 would confirm the row
 * exists, which is a disclosure in itself.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The caller's own notifications (Rule 54, Scenario 5).
   *
   * `unreadCount` rides along with the page so the bell badge needs one request
   * rather than two, and so the count and the list can never disagree about
   * what "unread" means.
   */
  async list(
    actor: AuthContext,
    query: ListNotificationsDto,
    meta: RequestMeta,
  ): Promise<NotificationListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? NOTIFICATION_LIMITS.LIST_PAGE_SIZE;

    const where = {
      ...this.ownScope(actor),
      ...(query.readStatus === 'READ' ? { readStatus: true } : {}),
      ...(query.readStatus === 'UNREAD' ? { readStatus: false } : {}),
      ...(query.eventType ? { eventType: query.eventType as never } : {}),
      ...(query.sourceModule ? { sourceType: query.sourceModule } : {}),
      ...(query.priority ? { priority: query.priority as never } : {}),
      // Rule 71: archived rows leave the active list without being deleted.
      ...(query.includeArchived ? {} : { archivedAt: null }),
      // A suppressed notification was never sent, so it is not the recipient's
      // business — it is an administrative fact, visible in Delivery Monitoring.
      status: { not: 'SUPPRESSED' as const },
      ...(query.fromDate || query.toDate
        ? {
            createdAt: {
              ...(query.fromDate
                ? { gte: new Date(`${query.fromDate}T00:00:00.000Z`) }
                : {}),
              // Exclusive upper bound on the next day, so a `toDate` of the
              // 27th includes everything on the 27th rather than only midnight.
              ...(query.toDate
                ? {
                    lt: new Date(
                      new Date(`${query.toDate}T00:00:00.000Z`).getTime() +
                        24 * 60 * 60 * 1000,
                    ),
                  }
                : {}),
            },
          }
        : {}),
    };

    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        select: NOTIFICATION_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.unreadCountFor(actor),
    ]);

    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.NOTIFICATION_LISTED,
        entityType: 'NOTIFICATION',
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { total, readStatus: query.readStatus ?? 'ALL' },
      })
      .catch(() => undefined);

    return {
      items: rows.map((row) => this.toSummary(row)),
      total,
      page,
      pageSize,
      unreadCount,
    };
  }

  /** The bell badge. */
  async unreadCount(actor: AuthContext): Promise<{ unreadCount: number }> {
    return { unreadCount: await this.unreadCountFor(actor) };
  }

  async detail(
    actor: AuthContext,
    notificationId: string,
    meta: RequestMeta,
  ): Promise<NotificationDetail> {
    const row = await this.findOwn(actor, notificationId, meta);

    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.NOTIFICATION_VIEWED,
        entityType: 'NOTIFICATION',
        entityId: notificationId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })
      .catch(() => undefined);

    return {
      ...this.toSummary(row),
      templateVersion: row.templateVersion ?? undefined,
      suppressionReason: row.suppressionReason ?? undefined,
      recipientRoleSnapshot: row.recipientRoleSnapshot ?? undefined,
      sentAt: row.sentAt?.toISOString(),
    };
  }

  /**
   * Mark read (Rule 51, Scenario 3).
   *
   * Touches `readStatus` and `readAt` on the caller's own row and nothing else.
   * That is the whole of Scenario 4 — the same event's notification to another
   * user is a different row and is untouched — and the whole of Rule 51: the
   * source business record is not referenced here, let alone written.
   *
   * Idempotent: marking an already-read notification read again is a no-op
   * rather than a conflict, because a double-click is not an error.
   */
  async markRead(
    actor: AuthContext,
    notificationId: string,
    meta: RequestMeta,
  ): Promise<NotificationDetail> {
    const row = await this.findOwn(actor, notificationId, meta);

    if (!row.readStatus) {
      await this.prisma.notification.update({
        where: {
          orgId_notificationId: { orgId: actor.orgId, notificationId },
        },
        // Paired: `notifications_read_state_coherent` refuses one without the
        // other.
        data: { readStatus: true, readAt: new Date() },
      });

      // Rule 73 and Scenario 59: acknowledgement is auditable.
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.NOTIFICATION_READ,
          entityType: 'NOTIFICATION',
          entityId: notificationId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        })
        .catch(() => undefined);
    }

    return this.detail(actor, notificationId, meta);
  }

  /** Mark unread again, for a user who wants to come back to something. */
  async markUnread(
    actor: AuthContext,
    notificationId: string,
    meta: RequestMeta,
  ): Promise<NotificationDetail> {
    const row = await this.findOwn(actor, notificationId, meta);

    if (row.readStatus) {
      await this.prisma.notification.update({
        where: {
          orgId_notificationId: { orgId: actor.orgId, notificationId },
        },
        data: { readStatus: false, readAt: null },
      });

      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.NOTIFICATION_UNREAD,
          entityType: 'NOTIFICATION',
          entityId: notificationId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        })
        .catch(() => undefined);
    }

    return this.detail(actor, notificationId, meta);
  }

  /**
   * Archive (Rule 71, Scenario 46).
   *
   * A timestamp, never a delete. The row and its delivery attempts are retained
   * for audit (Rule 70, Scenario 47); archiving only removes it from the active
   * list. There is deliberately no delete endpoint on this surface at all.
   */
  async archive(
    actor: AuthContext,
    notificationId: string,
    meta: RequestMeta,
  ): Promise<NotificationDetail> {
    const row = await this.findOwn(actor, notificationId, meta);

    if (!row.archivedAt) {
      await this.prisma.notification.update({
        where: {
          orgId_notificationId: { orgId: actor.orgId, notificationId },
        },
        data: { archivedAt: new Date() },
      });

      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.NOTIFICATION_ARCHIVED,
          entityType: 'NOTIFICATION',
          entityId: notificationId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        })
        .catch(() => undefined);
    }

    return this.detail(actor, notificationId, meta);
  }

  /**
   * The scope every read on this surface uses.
   *
   * One method so no query can accidentally omit half of it. Note that neither
   * value comes from the request.
   */
  private ownScope(actor: AuthContext) {
    return { orgId: actor.orgId, recipientUserId: actor.userId };
  }

  private async unreadCountFor(actor: AuthContext): Promise<number> {
    return this.prisma.notification.count({
      where: {
        ...this.ownScope(actor),
        readStatus: false,
        archivedAt: null,
        status: { not: 'SUPPRESSED' },
      },
    });
  }

  /**
   * One of the caller's own notifications, or a 404.
   *
   * 404 rather than 403 even when the row exists for someone else: a 403 would
   * confirm its existence, which is the disclosure Scenario 1 forbids.
   */
  private async findOwn(
    actor: AuthContext,
    notificationId: string,
    meta: RequestMeta,
  ) {
    const row = await this.prisma.notification.findFirst({
      where: { ...this.ownScope(actor), notificationId },
      select: {
        ...NOTIFICATION_SELECT,
        templateVersion: true,
        suppressionReason: true,
        recipientRoleSnapshot: true,
        sentAt: true,
      },
    });

    if (!row) {
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.NOTIFICATION_SCOPE_DENIED,
          entityType: 'NOTIFICATION',
          entityId: notificationId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        })
        .catch(() => undefined);

      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  private toSummary(row: {
    notificationId: string;
    eventType: string;
    title: string;
    message: string;
    priority: string;
    status: string;
    readStatus: boolean;
    readAt: Date | null;
    archivedAt: Date | null;
    isMandatory: boolean;
    sourceType: string | null;
    sourceId: string | null;
    branchId: string | null;
    createdAt: Date;
  }): NotificationSummary {
    return {
      notificationId: row.notificationId,
      eventType: row.eventType,
      title: row.title,
      message: row.message,
      priority: row.priority as NotificationSummary['priority'],
      status: row.status as NotificationSummary['status'],
      readStatus: row.readStatus,
      readAt: row.readAt?.toISOString(),
      archivedAt: row.archivedAt?.toISOString(),
      isMandatory: row.isMandatory,
      sourceModule: row.sourceType ?? undefined,
      sourceType: row.sourceType ?? undefined,
      sourceId: row.sourceId ?? undefined,
      branchId: row.branchId ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
