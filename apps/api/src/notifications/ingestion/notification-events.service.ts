import { Injectable, Logger } from '@nestjs/common';

import type { RequestMeta } from '../../auth/auth.service';
import { AuditAction, AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUES, QueueService } from '../../queue/queue.service';
import { deduplicationKey } from '../notification-policy';

/**
 * One authoritative business event, as a source module reports it.
 *
 * `payload` is the contract between the module that raised the event and the
 * template that renders it. Two rules govern what may go in it, and both are
 * about money:
 *
 *  * Amounts are decimal **strings** of paise, never JSON numbers. JSON numbers
 *    are IEEE-754 doubles, and Rule 25 prohibits floating-point money anywhere
 *    in notification generation.
 *  * Dates are `YYYY-MM-DD` strings. A timestamp would invent the time
 *    component Rules 26 and 68 forbid on a business date.
 *
 * The emitter *formats*; it never computes. Every value here is read from what
 * the source transaction already decided — `collection.allocations` in
 * penalty → interest → principal → fees order, an EMI's stored due date — so
 * that Rule 27's ban on templates recalculating anything holds one layer
 * further up too.
 */
export interface NotificationEventInput {
  orgId: string;
  /** Null for organization-wide events (Rule 2). */
  branchId?: string | null;
  eventType: string;
  sourceModule: string;
  sourceRecordId?: string | null;
  /**
   * What distinguishes a legitimate repeat from a replay. A row version or
   * `updatedAt` for a state change; the Asia/Kolkata business date for a
   * scheduled reminder.
   */
  sourceVersion?: string | null;
  /**
   * An explicit deduplication key, when the caller holds a better natural
   * identity than the computed one — a collection's `Idempotency-Key`, say.
   */
  deduplicationKey?: string;
  /** When the business event actually happened (Rule 67). Defaults to now. */
  occurredAt?: Date;
  payload: Record<string, string | number | boolean | null>;
}

/**
 * How a source module raises a notification event.
 *
 * # This method never throws
 *
 * That is the entire contract, and it is what Rules 60 to 62 require. By the
 * time a source module calls this, its transaction has already committed: a
 * collection has been posted, a ledger entry written, money moved. Nothing that
 * happens here may undo that. So every failure — a dead queue, a duplicate key,
 * a database error — is logged, audited where possible, and swallowed.
 *
 * Callers still wrap the call in `.catch(() => undefined)`, which is belt and
 * braces rather than redundancy: this method's promise could in principle
 * reject on something unanticipated, and the call site should read as
 * obviously safe without the reader having to come here to check.
 *
 * # Why an injectable and not an EventEmitter2
 *
 * An emitter would give looser coupling and take two things away. Static
 * typing: a listener registered for a mistyped event name is silently never
 * called. And a visible failure path: an unhandled rejection inside a Nest
 * emitter listener becomes a process-level unhandled rejection, whereas Rule 62
 * requires a notification failure be *recorded*. One injectable with one method
 * is more explicit, is typed against the input above, and is trivially mockable
 * in the source-module specs that will need it.
 *
 * # Why it writes outside the caller's transaction
 *
 * It takes no `tx` parameter, and that omission is load-bearing. Holding one
 * would make it possible — eventually, by accident — for a notification failure
 * to roll back a business write. Having no `tx` at all makes that structurally
 * impossible rather than merely discouraged (Rules 6, 7, 31; Scenario 35).
 */
@Injectable()
export class NotificationEventsService {
  private readonly logger = new Logger(NotificationEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  async emit(
    input: NotificationEventInput,
    meta: RequestMeta = {},
  ): Promise<void> {
    const key =
      input.deduplicationKey ??
      deduplicationKey({
        eventType: input.eventType,
        sourceModule: input.sourceModule,
        sourceRecordId: input.sourceRecordId,
        sourceVersion: input.sourceVersion,
      });

    try {
      const event = await this.prisma.notificationSourceEvent.create({
        data: {
          orgId: input.orgId,
          branchId: input.branchId ?? null,
          eventType: input.eventType as never,
          sourceModule: input.sourceModule,
          sourceRecordId: input.sourceRecordId ?? null,
          sourceVersion: input.sourceVersion ?? null,
          deduplicationKey: key,
          payload: input.payload,
          occurredAt: input.occurredAt ?? new Date(),
          status: 'PENDING',
        },
        select: { eventId: true },
      });

      await this.audit
        .record({
          orgId: input.orgId,
          action: AuditAction.NOTIFICATION_EVENT_RECEIVED,
          entityType: 'NOTIFICATION_EVENT',
          entityId: event.eventId,
          actorUserId: null,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            eventType: input.eventType,
            sourceModule: input.sourceModule,
            sourceRecordId: input.sourceRecordId ?? null,
            branchId: input.branchId ?? null,
          },
        })
        .catch(() => undefined);

      // If this enqueue is lost the row remains PENDING and is visible in
      // Delivery Monitoring; `QueueService.send` already swallows its own
      // failures and returns null.
      await this.queue.send(QUEUES.NOTIFICATION_INGEST, {
        orgId: input.orgId,
        eventId: event.eventId,
      });
    } catch (error) {
      if (this.isDuplicate(error)) {
        // Rule 22 and Scenario 23. The unique index on
        // `(orgId, deduplicationKey)` is the guarantee; this branch only turns
        // a raw constraint violation into a traceable audit record. Not an
        // error: a duplicate event is a correct outcome of at-least-once
        // delivery, and the first copy is already being processed.
        await this.audit
          .record({
            orgId: input.orgId,
            action: AuditAction.NOTIFICATION_EVENT_DUPLICATE_IGNORED,
            entityType: 'NOTIFICATION_EVENT',
            actorUserId: null,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              eventType: input.eventType,
              sourceModule: input.sourceModule,
              deduplicationKey: key,
            },
          })
          .catch(() => undefined);
        return;
      }

      // Anything else is logged and swallowed. The source transaction has
      // already committed and cannot be undone from here (Rules 60-62).
      this.logger.error(
        `Could not record notification event ${input.eventType} for ` +
          `${input.sourceModule}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Whether a write failed on the deduplication index.
   *
   * Matches Prisma's P2002 rather than the message text, so a localised or
   * reworded database error does not turn a duplicate into a logged failure.
   */
  private isDuplicate(error: unknown): boolean {
    return (error as { code?: string })?.code === 'P2002';
  }
}
