import { Injectable, Logger } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUES, QueueService } from '../../queue/queue.service';
import { PreferenceEvaluatorService } from '../preferences/preference-evaluator.service';
import { RecipientResolverService } from '../recipients/recipient-resolver.service';
import {
  TemplateRenderError,
  TemplateRendererService,
} from '../templates/template-renderer.service';

/**
 * Turns one authoritative source event into notifications (Scenario 22).
 *
 * This is the worker handler for `notifications.ingest`, and the place where
 * most of the specification's generation rules are actually enforced.
 *
 * # Every outcome is recorded
 *
 * There are five ways an event can end without a delivered notification, and
 * the specification names a different treatment for each:
 *
 *  * **No matching rule** — a valid state, not a failure. An organization that
 *    has not configured a rule for an event does not want notifications for it.
 *    Marked PROCESSED.
 *  * **No eligible recipient** (Scenario 53) — no notification is created and
 *    none goes to an arbitrary user. Audited, so there is evidence the event was
 *    considered.
 *  * **Inactive template** (Scenario 12) — a notification row *is* created, with
 *    `status: SUPPRESSED`. The scenario requires the event be handled according
 *    to a suppression policy, and a silent drop leaves nothing to inspect.
 *  * **Disabled preference** (Scenario 20) — same shape, different reason.
 *  * **Render failure** (Scenario 52) — no notification is created at all, and
 *    the event is marked FAILED. Malformed content must never be sent as though
 *    it were a successful notification.
 *
 * # One transaction per rule, not per event
 *
 * A rule's fan-out is atomic — either every recipient of that rule gets a row or
 * none does — but two rules on the same event are independent. Wrapping the
 * whole event would mean one rule's render failure discarding another rule's
 * perfectly good notifications, which no rule in the specification asks for and
 * which would be invisible when it happened.
 *
 * # Idempotent by construction
 *
 * A replayed job re-reads the event and returns immediately unless it is still
 * PENDING (Rule 23). The status transition is the guard, and it is the reason
 * at-least-once queue delivery is safe here.
 */
@Injectable()
export class NotificationIngestionService {
  private readonly logger = new Logger(NotificationIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly recipients: RecipientResolverService,
    private readonly renderer: TemplateRendererService,
    private readonly preferences: PreferenceEvaluatorService,
  ) {}

  async process(orgId: string, eventId: string): Promise<void> {
    const event = await this.prisma.notificationSourceEvent.findUnique({
      where: { orgId_eventId: { orgId, eventId } },
    });

    if (!event) {
      this.logger.warn(`Notification event ${eventId} no longer exists.`);
      return;
    }

    // Rule 23: a replayed job is a no-op. The status is the idempotency guard.
    if (event.status !== 'PENDING') return;

    await this.prisma.notificationSourceEvent.update({
      where: { orgId_eventId: { orgId, eventId } },
      data: { status: 'PROCESSING' },
    });

    const rules = await this.prisma.notificationEventRule.findMany({
      where: {
        orgId,
        eventType: event.eventType,
        isActive: true,
        // Rules 34, 41: a branch-scoped rule fires only for its own branch's
        // events; a null-branch rule fires for every branch.
        ...(event.branchId
          ? { OR: [{ branchId: event.branchId }, { branchId: null }] }
          : { branchId: null }),
      },
      include: { template: true },
    });

    if (rules.length === 0) {
      await this.finish(orgId, eventId, 'PROCESSED');
      await this.auditQuietly({
        orgId,
        action: AuditAction.NOTIFICATION_EVENT_UNMATCHED,
        entityId: eventId,
        metadata: { eventType: event.eventType },
      });
      return;
    }

    let anyFailed = false;

    for (const rule of rules) {
      try {
        await this.applyRule(event, rule);
      } catch (error) {
        // One rule's failure must not discard another rule's notifications.
        anyFailed = true;
        this.logger.error(
          `Rule ${rule.name} failed for event ${eventId}: ${(error as Error).message}`,
        );
        await this.auditQuietly({
          orgId,
          action: AuditAction.NOTIFICATION_EVENT_PROCESSING_FAILED,
          entityId: eventId,
          metadata: {
            ruleId: rule.ruleId,
            ruleName: rule.name,
            failure: (error as Error).message,
          },
        });
      }
    }

    await this.finish(
      orgId,
      eventId,
      anyFailed ? 'FAILED' : 'PROCESSED',
      anyFailed ? 'One or more rules could not be applied.' : null,
    );
  }

  /**
   * Resolve, evaluate, render and create for one rule.
   *
   * Throws on a render failure so the caller records the event as FAILED
   * (Scenario 52). Every other outcome is a recorded non-failure.
   */
  private async applyRule(
    event: {
      orgId: string;
      eventId: string;
      branchId: string | null;
      eventType: string;
      sourceModule: string;
      sourceRecordId: string | null;
      payload: unknown;
    },
    rule: {
      ruleId: string;
      name: string;
      channel: string;
      priority: string;
      isMandatory: boolean;
      recipientStrategy: string;
      recipientRoleCode: string | null;
      recipientPermissionCode: string | null;
      explicitRecipientUserIds: string[];
      template: {
        templateId: string;
        code: string;
        channel: string;
        status: string;
        version: number;
        subject: string | null;
        titleTemplate: string | null;
        body: string;
        containsPii: boolean;
      };
    },
  ): Promise<void> {
    const recipients = await this.recipients.resolve(rule, {
      orgId: event.orgId,
      branchId: event.branchId,
      sourceModule: event.sourceModule,
      sourceRecordId: event.sourceRecordId,
    });

    if (recipients.length === 0) {
      // Scenario 53. No notification, no fallback to an arbitrary user — only a
      // record that the rule was evaluated and named nobody.
      await this.auditQuietly({
        orgId: event.orgId,
        action: AuditAction.NOTIFICATION_RECIPIENT_UNRESOLVED,
        entityId: event.eventId,
        metadata: {
          ruleId: rule.ruleId,
          ruleName: rule.name,
          strategy: rule.recipientStrategy,
        },
      });
      return;
    }

    // Scenario 12: an inactive template generates no new notification. The rows
    // are still created, SUPPRESSED, so the outcome is inspectable.
    const templateInactive = rule.template.status !== 'ACTIVE';

    // Rendered once for the whole rule rather than per recipient: the content
    // is identical, and a render failure should fail the rule before any row is
    // written rather than midway through a fan-out.
    const rendered = templateInactive
      ? null
      : this.renderer.render(
          rule.template,
          (event.payload ?? {}) as Record<string, unknown>,
        );

    const created: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const recipient of recipients) {
        const decision = templateInactive
          ? { deliver: false, reason: 'INACTIVE_TEMPLATE' as const }
          : await this.preferences.shouldDeliver({
              orgId: event.orgId,
              userId: recipient.userId,
              channel: rule.channel,
              eventType: event.eventType,
              isMandatory: rule.isMandatory,
            });

        const notification = await tx.notification.create({
          data: {
            orgId: event.orgId,
            eventId: event.eventId,
            ruleId: rule.ruleId,
            eventType: event.eventType as never,
            branchId: event.branchId,
            sourceType: event.sourceModule,
            sourceId: event.sourceRecordId,
            recipientUserId: recipient.userId,
            recipientRoleSnapshot: recipient.roleSnapshot || null,
            templateId: rule.template.templateId,
            templateVersion: rendered?.templateVersion ?? null,
            // Frozen at creation (Rule 40, Scenario 8). A suppressed
            // notification still records what *would* have been sent, so the
            // suppression is legible rather than an empty row.
            title: rendered?.title ?? `${event.eventType} (suppressed)`,
            message:
              rendered?.message ??
              'This notification was suppressed before rendering.',
            renderedPayloadHash: rendered?.contentDigest ?? null,
            priority: rule.priority as never,
            isMandatory: rule.isMandatory,
            status: decision.deliver ? 'QUEUED' : 'SUPPRESSED',
            suppressionReason: decision.deliver ? null : decision.reason,
            queuedAt: decision.deliver ? new Date() : null,
          },
          select: { notificationId: true },
        });

        if (decision.deliver) {
          created.push(notification.notificationId);
        }

        await this.audit
          .record(
            {
              orgId: event.orgId,
              action: decision.deliver
                ? AuditAction.NOTIFICATION_CREATED
                : AuditAction.NOTIFICATION_SUPPRESSED,
              entityType: 'NOTIFICATION',
              entityId: notification.notificationId,
              actorUserId: null,
              metadata: {
                eventType: event.eventType,
                channel: rule.channel,
                recipientUserId: recipient.userId,
                ruleName: rule.name,
                // `contentDigest`, never `payloadHash` — sanitizeMetadata drops
                // any key matching /hash/ and the value would vanish.
                contentDigest: rendered?.contentDigest ?? null,
                ...(decision.reason
                  ? { suppressionReason: decision.reason }
                  : {}),
              },
            },
            tx,
          )
          .catch(() => undefined);
      }
    });

    // Enqueued after the transaction commits. Enqueuing inside would let a
    // worker pick up a notification whose row is not yet visible.
    for (const notificationId of created) {
      await this.queue.send(QUEUES.NOTIFICATION_DELIVER, {
        orgId: event.orgId,
        notificationId,
      });
    }
  }

  private async finish(
    orgId: string,
    eventId: string,
    status: 'PROCESSED' | 'FAILED',
    failureReason: string | null = null,
  ): Promise<void> {
    await this.prisma.notificationSourceEvent.update({
      where: { orgId_eventId: { orgId, eventId } },
      data: { status, processedAt: new Date(), failureReason },
    });
  }

  /**
   * Audit without a transaction and without the ability to fail the caller.
   *
   * Both properties are deliberate: a failure record must survive the rollback
   * of whatever it describes, and a broken audit store must not turn a handled
   * outcome into an unhandled one.
   */
  private async auditQuietly(input: {
    orgId: string;
    action: string;
    entityId: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.audit
      .record({
        orgId: input.orgId,
        action: input.action,
        entityType: 'NOTIFICATION_EVENT',
        entityId: input.entityId,
        actorUserId: null,
        metadata: input.metadata,
      })
      .catch(() => undefined);
  }
}

export { TemplateRenderError };
