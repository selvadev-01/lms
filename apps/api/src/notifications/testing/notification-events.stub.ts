import type { NotificationEventsService } from '../ingestion/notification-events.service';

/**
 * One event a service under test raised.
 *
 * Mirrors `NotificationEventInput` rather than importing it, so a spec can
 * assert on `payload` fields without the index-signature constraint the real
 * type imposes on emitters.
 */
export interface EmittedEvent {
  orgId: string;
  branchId?: string | null;
  eventType: string;
  sourceModule: string;
  sourceRecordId?: string | null;
  /** What distinguishes a genuine repeat from a replay (Rules 12, 14). */
  sourceVersion?: string | null;
  deduplicationKey?: string;
  occurredAt?: Date;
  payload: Record<string, unknown>;
}

export interface NotificationEventsStub {
  service: NotificationEventsService;
  /** Everything emitted, in order. */
  emitted: EmittedEvent[];
  /** The events of one type, for a focused assertion. */
  ofType: (eventType: string) => EmittedEvent[];
}

/**
 * A recording stand-in for `NotificationEventsService`.
 *
 * Nine business services across seven modules inject the real one. Each has a
 * spec that constructs it with `new`, so without this every one of them would
 * grow its own inline `{ emit: jest.fn() }` cast — nine chances to stub it
 * slightly differently, and no shared place to assert the one property that
 * actually matters.
 *
 * That property is the contract `emit` advertises: **it never throws**. A
 * business transaction has already committed by the time it is called (Rules
 * 60-62), so a stub that rejects would be testing against a service that cannot
 * exist. `failing()` below exists precisely so a caller can prove it keeps
 * working when notification infrastructure is broken.
 */
export function notificationEventsStub(): NotificationEventsStub {
  const emitted: EmittedEvent[] = [];

  const service = {
    emit: (input: EmittedEvent) => {
      emitted.push(input);
      return Promise.resolve();
    },
  } as unknown as NotificationEventsService;

  return {
    service,
    emitted,
    ofType: (eventType) => emitted.filter((e) => e.eventType === eventType),
  };
}

/**
 * A stand-in that rejects, for proving a business flow survives it.
 *
 * The real service swallows its own failures, so this is deliberately *more*
 * hostile than production: if a call site works with this, it works with
 * anything. Use it to pin Scenario 31 — an external provider outage must not
 * roll back a committed transaction.
 */
export function failingNotificationEventsStub(): NotificationEventsService {
  return {
    emit: () =>
      Promise.reject(new Error('notification infrastructure is down')),
  } as unknown as NotificationEventsService;
}
