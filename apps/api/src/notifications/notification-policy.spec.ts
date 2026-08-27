import {
  FAILURE_CODES,
  MAPPED_EVENT_TYPES,
  NOTIFICATION_LIMITS,
  OVERDUE_REMINDER_DAYS,
  SUPPORTED_EVENTS,
  backoffSeconds,
  classifyFailure,
  deduplicationKey,
  isOverdueReminderDay,
  isSupportedChannel,
  isSupportedEvent,
  preferenceCategoryFor,
} from './notification-policy';

/**
 * Module 16 — the policy decisions every other service in the module reads.
 *
 * These are pure functions, so the properties worth pinning are the ones whose
 * failure is silent rather than loud: a backoff that stops being deterministic,
 * a permanent failure that becomes retryable, an event that quietly loses its
 * preference category and so becomes unsuppressible without being marked
 * mandatory.
 */

describe('NOTIFICATION_LIMITS', () => {
  it('matches the values @lms/validation declares', () => {
    // Two declarations of the same numbers — here for the CJS Nest build, and
    // in @lms/validation for the browser, which cannot share this file. The
    // duplication is forced; the drift it invites is not. A test on each side
    // asserting literals is what keeps them together.
    expect(NOTIFICATION_LIMITS.MAX_ATTEMPTS).toBe(5);
    expect(NOTIFICATION_LIMITS.BACKOFF_BASE_SECONDS).toBe(60);
    expect(NOTIFICATION_LIMITS.MAX_BACKOFF_SECONDS).toBe(3600);
    expect(NOTIFICATION_LIMITS.LIST_PAGE_SIZE).toBe(25);
    expect(NOTIFICATION_LIMITS.MAX_LIST_PAGE_SIZE).toBe(100);
  });
});

describe('backoffSeconds', () => {
  it('produces the exact deterministic schedule Rule 21 requires', () => {
    // Written out rather than computed: changing the base should be a visible
    // edit to an expected sequence, not a silent change to when a support
    // engineer expects the next attempt to land.
    const schedule = [1, 2, 3, 4, 5].map((attempt) => backoffSeconds(attempt));

    expect(schedule).toEqual([60, 120, 240, 480, 960]);
  });

  it('is deterministic — the same attempt always yields the same delay', () => {
    // Rule 21 chose predictability over load-spreading. If jitter is ever
    // wanted it belongs at the queue's startAfter, so that this stays a pure
    // function an operator can reason about.
    const first = backoffSeconds(3);
    const second = backoffSeconds(3);

    expect(first).toBe(second);
  });

  it('honours a rule-configured base', () => {
    expect([1, 2, 3].map((n) => backoffSeconds(n, 30))).toEqual([30, 60, 120]);
  });

  it('clamps at the ceiling rather than growing unbounded', () => {
    // A rule configured with a large base must degrade to a fixed hourly retry,
    // not to attempts days apart — by which point nobody is watching.
    expect(backoffSeconds(20)).toBe(NOTIFICATION_LIMITS.MAX_BACKOFF_SECONDS);
    expect(backoffSeconds(1, 3600)).toBe(
      NOTIFICATION_LIMITS.MAX_BACKOFF_SECONDS,
    );
  });

  it('treats the first attempt as the base, not double it', () => {
    // Off-by-one here would make every retry land twice as late as configured.
    expect(backoffSeconds(1)).toBe(NOTIFICATION_LIMITS.BACKOFF_BASE_SECONDS);
  });
});

describe('classifyFailure', () => {
  describe('Rules 19, 20 and Scenario 29: permanent failures never retry', () => {
    it.each([
      FAILURE_CODES.MISSING_CONTACT,
      FAILURE_CODES.INVALID_RECIPIENT,
      FAILURE_CODES.PERMANENT_PROVIDER_ERROR,
      FAILURE_CODES.CHANNEL_NOT_CONFIGURED,
    ])('classifies %s as permanent', (code) => {
      expect(classifyFailure(code)).toBe('PERMANENT');
    });

    it('treats a missing contact as permanent, not transient', () => {
      // The one that is easy to get wrong. An address that does not exist will
      // still not exist in sixteen minutes; retrying burns the whole attempt
      // budget to reach the same answer, which is Rule 20's "retry
      // indefinitely" in slow motion. The fix is a data change, not time.
      expect(classifyFailure(FAILURE_CODES.MISSING_CONTACT)).toBe('PERMANENT');
    });
  });

  describe('Scenario 28: transient failures are retried', () => {
    it.each([
      FAILURE_CODES.TRANSIENT_PROVIDER_ERROR,
      FAILURE_CODES.PROVIDER_TIMEOUT,
      FAILURE_CODES.PROVIDER_UNAVAILABLE,
      FAILURE_CODES.PROVIDER_ERROR,
    ])('classifies %s as retryable', (code) => {
      expect(classifyFailure(code)).toBe('RETRYABLE');
    });
  });

  it('defaults an unmapped code to retryable', () => {
    // The safer of the two defaults. Retrying something permanent wastes at
    // most MAX_ATTEMPTS calls and leaves a visible trail; treating something
    // transient as permanent silently drops a notification that would have
    // succeeded on the next attempt.
    expect(classifyFailure('SOME_NEW_GATEWAY_ERROR')).toBe('RETRYABLE');
    expect(classifyFailure(null)).toBe('RETRYABLE');
    expect(classifyFailure(undefined)).toBe('RETRYABLE');
  });
});

describe('isSupportedEvent', () => {
  it('accepts a pair the owning module really raises', () => {
    expect(isSupportedEvent('recovery', 'RECOVERY_ASSIGNED')).toBe(true);
    expect(isSupportedEvent('disbursal', 'DISBURSAL_COMPLETED')).toBe(true);
  });

  describe('Scenario 15: an unsupported combination is rejected', () => {
    it('refuses an event the named module does not raise', () => {
      // Saved happily without this check, matching nothing, and
      // indistinguishable from a delivery bug when someone asks why the
      // notification never arrived.
      expect(isSupportedEvent('recovery', 'DISBURSAL_COMPLETED')).toBe(false);
    });

    it('refuses an unknown module', () => {
      expect(isSupportedEvent('not_a_module', 'RECOVERY_ASSIGNED')).toBe(false);
    });
  });
});

describe('preferenceCategoryFor', () => {
  it('maps every event the rule whitelist can raise', () => {
    // The load-bearing assertion in this file. An event that reaches the
    // pipeline with no category cannot be governed by a preference, so it would
    // behave as though mandatory without being marked mandatory — Rules 47 and
    // 48 inverted, and invisible until a user complains they cannot turn
    // something off.
    const whitelisted = Object.values(SUPPORTED_EVENTS).flat();

    for (const eventType of whitelisted) {
      expect(() => preferenceCategoryFor(eventType)).not.toThrow();
    }
  });

  it('throws rather than defaulting for an unmapped event', () => {
    // Deliberately not a fallback category. A default would make "added an
    // event, forgot the map" silent, and the symptom would be a notification
    // nobody can suppress.
    expect(() => preferenceCategoryFor('NOT_AN_EVENT')).toThrow(
      /No preference category is mapped/,
    );
  });

  it('groups events into the nine categories the story names', () => {
    const categories = new Set(
      MAPPED_EVENT_TYPES.map((event) => preferenceCategoryFor(event)),
    );

    expect(categories).toEqual(
      new Set([
        'APPLICATION',
        'APPROVAL',
        'DISBURSAL',
        'EMI',
        'COLLECTION',
        'FIELD_COLLECTION',
        'OVERDUE',
        'RECOVERY',
        'SECURITY',
      ]),
    );
  });
});

describe('isOverdueReminderDay', () => {
  it('fires on each configured day', () => {
    for (const day of OVERDUE_REMINDER_DAYS) {
      expect(isOverdueReminderDay(day)).toBe(true);
    }
  });

  it('stays silent between configured days', () => {
    expect(isOverdueReminderDay(2)).toBe(false);
    expect(isOverdueReminderDay(10)).toBe(false);
    expect(isOverdueReminderDay(29)).toBe(false);
  });

  it('repeats monthly after the last configured day', () => {
    // A long-overdue account must keep producing reminders without one entry
    // per day being listed.
    expect(isOverdueReminderDay(60)).toBe(true);
    expect(isOverdueReminderDay(90)).toBe(true);
    expect(isOverdueReminderDay(61)).toBe(false);
  });

  it('never fires on or before the due date', () => {
    // An account that is not yet late has nothing to be reminded about, and a
    // reminder saying it is overdue would be wrong.
    expect(isOverdueReminderDay(0)).toBe(false);
    expect(isOverdueReminderDay(-1)).toBe(false);
  });
});

describe('isSupportedChannel', () => {
  it('accepts the three Module 16 delivers on', () => {
    expect(isSupportedChannel('IN_APP')).toBe(true);
    expect(isSupportedChannel('EMAIL')).toBe(true);
    expect(isSupportedChannel('SMS')).toBe(true);
  });

  it('refuses the legacy enum values that have no provider', () => {
    // PUSH and AUTO_CALL survive in the Postgres enum only because dropping a
    // value rewrites the type. A rule targeting one would accumulate permanent
    // failures instead of failing when it was saved.
    expect(isSupportedChannel('PUSH')).toBe(false);
    expect(isSupportedChannel('AUTO_CALL')).toBe(false);
  });
});

describe('deduplicationKey', () => {
  it('distinguishes two versions of the same source record', () => {
    // Rules 12, 14, 22, 23. Without sourceVersion in the key, a legitimate
    // second event on the same record would be swallowed as a replay.
    const first = deduplicationKey({
      eventType: 'EMI_DUE_TODAY',
      sourceModule: 'repayment_schedule',
      sourceRecordId: 'emi-1',
      sourceVersion: '2026-08-27',
    });
    const second = deduplicationKey({
      eventType: 'EMI_DUE_TODAY',
      sourceModule: 'repayment_schedule',
      sourceRecordId: 'emi-1',
      sourceVersion: '2026-08-28',
    });

    expect(first).not.toBe(second);
  });

  it('is stable for a re-run of the same business date', () => {
    // Scenario 23 and the binding requirement on scheduled reminders: running
    // the daily sweep twice on the same day must create nothing the second
    // time. That falls out of the key rather than needing separate machinery.
    const input = {
      eventType: 'EMI_DUE_TODAY',
      sourceModule: 'repayment_schedule',
      sourceRecordId: 'emi-1',
      sourceVersion: '2026-08-27',
    };

    expect(deduplicationKey(input)).toBe(deduplicationKey(input));
    expect(deduplicationKey(input)).toBe(
      'EMI_DUE_TODAY:repayment_schedule:emi-1:2026-08-27',
    );
  });

  it('does not collide across event types on one record', () => {
    // A loan that is both approved and disbursed must produce two events.
    const approved = deduplicationKey({
      eventType: 'APPROVAL_APPROVED',
      sourceModule: 'approval',
      sourceRecordId: 'loan-1',
      sourceVersion: '1',
    });
    const disbursed = deduplicationKey({
      eventType: 'DISBURSAL_COMPLETED',
      sourceModule: 'disbursal',
      sourceRecordId: 'loan-1',
      sourceVersion: '1',
    });

    expect(approved).not.toBe(disbursed);
  });

  it('substitutes placeholders rather than emitting an ambiguous key', () => {
    // Two record-less events of the same type would otherwise both key on
    // "TYPE:module::" and the second would be swallowed as a duplicate.
    expect(
      deduplicationKey({ eventType: 'SECURITY_ALERT', sourceModule: 'auth' }),
    ).toBe('SECURITY_ALERT:auth:none:v1');
  });
});
