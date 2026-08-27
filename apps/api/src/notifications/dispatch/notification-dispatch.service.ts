import { Injectable, Logger } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import { EmailSendError } from '../../email/email.provider';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUES, QueueService } from '../../queue/queue.service';
import { SmsService } from '../../sms/sms.service';
import {
  FAILURE_CODES,
  NOTIFICATION_LIMITS,
  backoffSeconds,
  classifyFailure,
} from '../notification-policy';

/** What a channel returned when it accepted a message. */
interface DispatchOutcome {
  status: 'DELIVERED' | 'ACCEPTED_BY_PROVIDER';
  provider: string;
  providerMessageId: string | null;
  providerStatus: string | null;
}

/**
 * Attempts delivery of one notification, once, and decides what happens next.
 *
 * This is the worker handler for `notifications.deliver`.
 *
 * # The attempt row is written before the provider is called
 *
 * Two properties depend on that ordering, and both are easy to lose by
 * "optimising" it away:
 *
 *  * If the process dies mid-call, the attempt is visible as PENDING rather
 *    than invisible. A message that may or may not have been sent is a fact
 *    worth recording.
 *  * The unique index on `(orgId, notificationId, channel, attemptNumber)`
 *    makes two dispatchers racing the same attempt collide *before* either
 *    calls a provider. That is Rule 13 and Scenario 24: a retry creates a new
 *    attempt under the same logical notification, and a duplicate send is
 *    prevented by the database rather than by hoping the queue never delivers
 *    twice.
 *
 * # DELIVERED is reachable only in-app
 *
 * Rule 17 and Scenario 27. An external provider accepting a message means it
 * took custody, not that a human received it, so EMAIL and SMS map to
 * ACCEPTED_BY_PROVIDER. Only IN_APP — where the LMS itself is the delivery —
 * may honestly claim DELIVERED. A CHECK constraint enforces this too, so a
 * refactor that gets it wrong fails loudly at the insert.
 *
 * # Retries are bounded and deterministic
 *
 * A permanent failure never retries (Rules 20, 29). A retryable one retries
 * until `rule.maxAttempts`, with `backoffBaseSeconds * 2^(attempt-1)` and no
 * jitter (Rule 21). Both caps are read from the rule rather than hard-coded, so
 * an organization can tune them without a deploy.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
  ) {}

  async deliver(orgId: string, notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { orgId_notificationId: { orgId, notificationId } },
      include: {
        recipientUser: { select: { email: true, mobile: true, status: true } },
        deliveries: { select: { attemptNumber: true, channel: true } },
      },
    });

    if (!notification) {
      this.logger.warn(`Notification ${notificationId} no longer exists.`);
      return;
    }

    // Terminal states are not re-attempted. This is what makes an at-least-once
    // queue safe: a redelivered job for an already-sent notification is a no-op
    // rather than a second send.
    if (['SENT', 'SUPPRESSED', 'ARCHIVED'].includes(notification.status)) {
      return;
    }

    const rule = notification.ruleId
      ? await this.prisma.notificationEventRule.findUnique({
          where: {
            orgId_ruleId: { orgId, ruleId: notification.ruleId },
          },
          select: {
            channel: true,
            maxAttempts: true,
            backoffBaseSeconds: true,
          },
        })
      : null;

    const channel = rule?.channel ?? 'IN_APP';
    const maxAttempts = rule?.maxAttempts ?? NOTIFICATION_LIMITS.MAX_ATTEMPTS;
    const baseSeconds =
      rule?.backoffBaseSeconds ?? NOTIFICATION_LIMITS.BACKOFF_BASE_SECONDS;

    const attemptNumber =
      notification.deliveries
        .filter((delivery) => delivery.channel === channel)
        .reduce(
          (highest, delivery) => Math.max(highest, delivery.attemptNumber),
          0,
        ) + 1;

    // Rules 20, 30 and Scenario 30: the cap is terminal. Reached here rather
    // than after another provider call, so the final attempt is the last one.
    if (attemptNumber > maxAttempts) {
      await this.markPermanentlyFailed(
        orgId,
        notificationId,
        `Exceeded the configured maximum of ${maxAttempts} attempts.`,
      );
      return;
    }

    const delivery = await this.prisma.notificationDelivery.create({
      data: {
        orgId,
        notificationId,
        channel: channel as never,
        attemptNumber,
        status: 'PENDING',
        attemptedAt: new Date(),
      },
      select: { deliveryId: true },
    });

    await this.prisma.notification.update({
      where: { orgId_notificationId: { orgId, notificationId } },
      data: { status: 'PROCESSING', processedAt: new Date() },
    });

    await this.auditQuietly(orgId, {
      action: AuditAction.NOTIFICATION_DELIVERY_ATTEMPTED,
      entityId: notificationId,
      metadata: { channel, attemptNumber, deliveryId: delivery.deliveryId },
    });

    try {
      const outcome = await this.dispatch(orgId, channel, notification);

      await this.prisma.$transaction([
        this.prisma.notificationDelivery.update({
          where: {
            orgId_deliveryId: { orgId, deliveryId: delivery.deliveryId },
          },
          data: {
            status: outcome.status,
            provider: outcome.provider,
            providerMessageId: outcome.providerMessageId,
            providerStatus: outcome.providerStatus,
            completedAt: new Date(),
            // Only set where the claim is honest — see the class comment.
            deliveredAt: outcome.status === 'DELIVERED' ? new Date() : null,
          },
        }),
        this.prisma.notification.update({
          where: { orgId_notificationId: { orgId, notificationId } },
          data: { status: 'SENT', sentAt: new Date() },
        }),
      ]);

      await this.auditQuietly(orgId, {
        action: AuditAction.NOTIFICATION_DELIVERY_ACCEPTED,
        entityId: notificationId,
        metadata: {
          channel,
          attemptNumber,
          canonicalStatus: outcome.status,
          providerReference: outcome.providerMessageId,
          providerStatus: outcome.providerStatus,
        },
      });
    } catch (error) {
      await this.recordFailure({
        orgId,
        notificationId,
        deliveryId: delivery.deliveryId,
        channel,
        attemptNumber,
        maxAttempts,
        baseSeconds,
        error,
      });
    }
  }

  /**
   * Hand the message to its channel.
   *
   * IN_APP has no external step at all: the `Notification` row the recipient
   * reads *is* the delivery, which is why it is the one channel that may report
   * DELIVERED.
   */
  private async dispatch(
    orgId: string,
    channel: string,
    notification: {
      title: string;
      message: string;
      recipientUser: { email: string | null; mobile: string | null } | null;
    },
  ): Promise<DispatchOutcome> {
    if (channel === 'IN_APP') {
      return {
        status: 'DELIVERED',
        provider: 'IN_APP',
        providerMessageId: null,
        providerStatus: 'stored',
      };
    }

    if (channel === 'EMAIL') {
      const to = notification.recipientUser?.email;
      if (!to) {
        // Permanent, not transient: an address that does not exist will still
        // not exist in sixteen minutes, and the fix is a data change.
        throw new EmailSendError(
          'The recipient has no email address.',
          FAILURE_CODES.MISSING_CONTACT,
        );
      }

      const result = await this.email.send(orgId, {
        to,
        subject: notification.title,
        body: notification.message,
      });

      return {
        // Never DELIVERED — Rule 17, Scenario 27.
        status: 'ACCEPTED_BY_PROVIDER',
        provider: 'SMTP',
        providerMessageId: result.providerMessageId ?? null,
        providerStatus: result.providerStatus ?? null,
      };
    }

    if (channel === 'SMS') {
      const to = notification.recipientUser?.mobile;
      if (!to) {
        throw new EmailSendError(
          'The recipient has no mobile number.',
          FAILURE_CODES.MISSING_CONTACT,
        );
      }

      await this.sms.send(orgId, to, notification.message);

      return {
        status: 'ACCEPTED_BY_PROVIDER',
        provider: 'SMS',
        providerMessageId: null,
        providerStatus: 'accepted',
      };
    }

    throw new EmailSendError(
      `Channel ${channel} has no configured provider.`,
      FAILURE_CODES.CHANNEL_NOT_CONFIGURED,
    );
  }

  /**
   * Record a failed attempt and either schedule a retry or stop.
   *
   * The classification decides, and it comes from `notification-policy.ts` so
   * that the retryable/permanent split is one rule rather than one per channel.
   */
  private async recordFailure(input: {
    orgId: string;
    notificationId: string;
    deliveryId: string;
    channel: string;
    attemptNumber: number;
    maxAttempts: number;
    baseSeconds: number;
    error: unknown;
  }): Promise<void> {
    const sendError =
      input.error instanceof EmailSendError ? input.error : null;
    const failureCode = sendError?.failureCode ?? FAILURE_CODES.PROVIDER_ERROR;
    const failureReason = (input.error as Error).message;

    const permanent = classifyFailure(failureCode) === 'PERMANENT';
    const capReached = input.attemptNumber >= input.maxAttempts;
    const terminal = permanent || capReached;

    const nextRetryAt = terminal
      ? null
      : new Date(
          Date.now() +
            backoffSeconds(input.attemptNumber, input.baseSeconds) * 1000,
        );

    await this.prisma.$transaction([
      this.prisma.notificationDelivery.update({
        where: {
          orgId_deliveryId: {
            orgId: input.orgId,
            deliveryId: input.deliveryId,
          },
        },
        data: {
          status: terminal ? 'PERMANENT_FAILURE' : 'RETRY_SCHEDULED',
          failureCode,
          failureReason,
          providerStatus: sendError?.providerStatus ?? null,
          completedAt: new Date(),
          // Only a scheduled retry carries a next attempt time; a CHECK
          // constraint refuses the other combinations.
          nextRetryAt,
        },
      }),
      this.prisma.notification.update({
        where: {
          orgId_notificationId: {
            orgId: input.orgId,
            notificationId: input.notificationId,
          },
        },
        data: { status: terminal ? 'FAILED' : 'RETRYING' },
      }),
    ]);

    await this.auditQuietly(input.orgId, {
      action: terminal
        ? AuditAction.NOTIFICATION_DELIVERY_PERMANENTLY_FAILED
        : AuditAction.NOTIFICATION_DELIVERY_RETRY_SCHEDULED,
      entityId: input.notificationId,
      metadata: {
        channel: input.channel,
        attemptNumber: input.attemptNumber,
        failureCode,
        failureReason,
        classification: permanent ? 'PERMANENT' : 'RETRYABLE',
        capReached,
        nextRetryAt: nextRetryAt?.toISOString() ?? null,
      },
    });

    if (!terminal && nextRetryAt) {
      await this.queue.sendAfter(
        QUEUES.NOTIFICATION_DELIVER,
        { orgId: input.orgId, notificationId: input.notificationId },
        backoffSeconds(input.attemptNumber, input.baseSeconds),
      );
    }
  }

  private async markPermanentlyFailed(
    orgId: string,
    notificationId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.notification.update({
      where: { orgId_notificationId: { orgId, notificationId } },
      data: { status: 'FAILED' },
    });

    await this.auditQuietly(orgId, {
      action: AuditAction.NOTIFICATION_DELIVERY_PERMANENTLY_FAILED,
      entityId: notificationId,
      metadata: { failureReason: reason, capReached: true },
    });
  }

  /**
   * Audit without a transaction and without the ability to fail a delivery.
   *
   * Rule 73 wants every delivery outcome recorded; it does not want a broken
   * audit store to turn a successful send into an exception.
   */
  private async auditQuietly(
    orgId: string,
    input: {
      action: string;
      entityId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.audit
      .record({
        orgId,
        action: input.action,
        entityType: 'NOTIFICATION',
        entityId: input.entityId,
        actorUserId: null,
        metadata: input.metadata,
      })
      .catch(() => undefined);
  }
}
