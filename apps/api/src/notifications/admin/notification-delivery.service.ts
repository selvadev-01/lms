import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DeliveryAttempt, DeliveryMonitorResult } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUES, QueueService } from '../../queue/queue.service';
import { ListDeliveriesDto, RetryDeliveryDto } from '../dto/notifications.dto';
import { NOTIFICATION_LIMITS } from '../notification-policy';

export const DELIVERIES_VIEW_PERMISSION = 'notifications.deliveries.view';
export const DELIVERIES_RETRY_PERMISSION = 'notifications.deliveries.retry';
export const NOTIFICATIONS_VIEW_PERMISSION = 'notifications.view';

const NOT_REACHABLE = 'Notification not found';

/**
 * Delivery monitoring — the one read in Module 16 that spans recipients.
 *
 * # Content is gated separately from the rows
 *
 * `deliveries.view` opens the screen: statuses, channels, attempt counts,
 * provider references, failure classifications. `notifications.view` is what
 * adds the message bodies.
 *
 * That split is Rule 55 — notification content must be minimised and controlled
 * by permission policy, not merely by channel. An operator diagnosing why a
 * branch's email is failing needs to see the attempts; they do not necessarily
 * need to read what was said to whom. Two permissions let an organization draw
 * that line where it wants it.
 *
 * # A manual retry does not bypass the cap
 *
 * Scenario 45 asks for retry to be a distinct authority, and Rules 19 and 20
 * still bound it. `retry` re-enqueues; the dispatch service applies the same
 * `maxAttempts` check it applies to an automatic retry, so an administrator
 * cannot loop a permanently-failing delivery forever by clicking a button.
 */
@Injectable()
export class NotificationDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  async list(
    actor: AuthContext,
    query: ListDeliveriesDto,
    meta: RequestMeta,
  ): Promise<DeliveryMonitorResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? NOTIFICATION_LIMITS.LIST_PAGE_SIZE;

    // Scenario 40. A branch-confined caller sees their own branch only; a
    // requested branch narrows within that and can never widen it.
    const branchId = actor.branchId ?? query.branchId ?? null;

    const where = {
      orgId: actor.orgId,
      ...(branchId ? { branchId } : {}),
      ...(query.eventType ? { eventType: query.eventType as never } : {}),
      ...(query.status
        ? { deliveries: { some: { status: query.status as never } } }
        : {}),
      ...(query.channel
        ? { deliveries: { some: { channel: query.channel as never } } }
        : {}),
      ...(query.fromDate || query.toDate
        ? {
            createdAt: {
              ...(query.fromDate
                ? { gte: new Date(`${query.fromDate}T00:00:00.000Z`) }
                : {}),
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

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: {
          recipientUser: { select: { name: true } },
          branch: { select: { name: true } },
          deliveries: { orderBy: { attemptNumber: 'desc' }, take: 1 },
          _count: { select: { deliveries: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    // Rule 55: bodies only for a caller entitled to read other users' content.
    const mayReadContent = actor.permissions.includes(
      NOTIFICATIONS_VIEW_PERMISSION,
    );

    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.NOTIFICATION_LISTED,
        entityType: 'NOTIFICATION',
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { total, scope: 'DELIVERY_MONITOR', mayReadContent },
      })
      .catch(() => undefined);

    return {
      items: rows.map((row) => ({
        notificationId: row.notificationId,
        eventType: row.eventType,
        status: row.status as never,
        priority: row.priority as never,
        ...(mayReadContent ? { title: row.title, message: row.message } : {}),
        recipientUserId: row.recipientUserId ?? undefined,
        recipientName: row.recipientUser?.name,
        branchId: row.branchId ?? undefined,
        branchName: row.branch?.name,
        attemptCount: row._count.deliveries,
        lastAttempt: row.deliveries[0]
          ? this.toAttempt(row.deliveries[0])
          : undefined,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** The attempt history for one notification (Rule 15). */
  async attempts(
    actor: AuthContext,
    notificationId: string,
    meta: RequestMeta,
  ): Promise<DeliveryAttempt[]> {
    await this.findInScope(actor, notificationId, meta);

    const rows = await this.prisma.notificationDelivery.findMany({
      where: { orgId: actor.orgId, notificationId },
      orderBy: { attemptNumber: 'asc' },
    });

    return rows.map((row) => this.toAttempt(row));
  }

  /**
   * Re-enqueue a failed delivery (Scenario 45).
   *
   * Refused unless the notification actually failed: retrying something that
   * succeeded would send it twice, and retrying something suppressed would
   * defeat the preference or policy that suppressed it.
   *
   * The attempt cap is *not* re-checked here. That is deliberate — the dispatch
   * service applies it, so there is one place that decides when a delivery is
   * finished rather than two that could disagree.
   */
  async retry(
    actor: AuthContext,
    notificationId: string,
    dto: RetryDeliveryDto,
    meta: RequestMeta,
  ): Promise<{ queued: boolean }> {
    const notification = await this.findInScope(actor, notificationId, meta);

    if (!['FAILED', 'RETRYING'].includes(notification.status)) {
      throw new ConflictException(
        `Only a failed delivery can be retried; this one is ${notification.status}.`,
      );
    }

    await this.prisma.notification.update({
      where: { orgId_notificationId: { orgId: actor.orgId, notificationId } },
      data: { status: 'QUEUED', queuedAt: new Date() },
    });

    await this.queue.send(QUEUES.NOTIFICATION_DELIVER, {
      orgId: actor.orgId,
      notificationId,
    });

    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.NOTIFICATION_DELIVERY_RETRIED_MANUALLY,
        entityType: 'NOTIFICATION',
        entityId: notificationId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        // Who judged the failure transient, and why (Rule 73).
        metadata: { reason: dto.reason, previousStatus: notification.status },
      })
      .catch(() => undefined);

    return { queued: true };
  }

  private async findInScope(
    actor: AuthContext,
    notificationId: string,
    meta: RequestMeta,
  ) {
    const row = await this.prisma.notification.findFirst({
      where: {
        orgId: actor.orgId,
        notificationId,
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
      },
      select: { notificationId: true, status: true },
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
        })
        .catch(() => undefined);

      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  private toAttempt(row: {
    deliveryId: string;
    channel: string;
    attemptNumber: number;
    status: string;
    provider: string | null;
    providerMessageId: string | null;
    providerStatus: string | null;
    failureCode: string | null;
    failureReason: string | null;
    attemptedAt: Date;
    completedAt: Date | null;
    deliveredAt: Date | null;
    nextRetryAt: Date | null;
  }): DeliveryAttempt {
    return {
      deliveryId: row.deliveryId,
      channel: row.channel as DeliveryAttempt['channel'],
      attemptNumber: row.attemptNumber,
      status: row.status as DeliveryAttempt['status'],
      provider: row.provider ?? undefined,
      providerMessageId: row.providerMessageId ?? undefined,
      providerStatus: row.providerStatus ?? undefined,
      failureCode: row.failureCode ?? undefined,
      failureReason: row.failureReason ?? undefined,
      attemptedAt: row.attemptedAt.toISOString(),
      completedAt: row.completedAt?.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString(),
      nextRetryAt: row.nextRetryAt?.toISOString(),
    };
  }
}
