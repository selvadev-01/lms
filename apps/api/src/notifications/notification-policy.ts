/**
 * Module 16 — the policy decisions that are the same everywhere.
 *
 * Four things live here rather than in the services that use them, because each
 * is consulted from more than one place and a second copy of any of them would
 * be a silent behaviour split:
 *
 *  1. The retry bounds and the backoff schedule (Rules 19-21).
 *  2. Which provider failures may be retried and which never may (Rules 19, 20;
 *     Scenarios 28, 29).
 *  3. Which (source module, event) pairs a rule may claim to listen to
 *     (Scenario 15).
 *  4. Which preference category an event belongs to, which is what makes a
 *     nine-switch preferences screen able to govern thirty-two events.
 */

/**
 * Bounds the notification pipeline enforces.
 *
 * Declared here rather than imported from `@lms/constants`, following the same
 * convention `report-scope.ts`, `auth/session-state.ts` and
 * `field/gps-verification.ts` document: that package ships raw ESM with no build
 * step, so the CJS Nest build cannot require it. `NOTIFICATION_LIMITS` in
 * `@lms/validation` is the shared declaration for the web app, and a test there
 * pins the two together.
 *
 * A retry cap the browser displays and the server ignores produces a
 * configuration screen that lies about when a message stops being retried.
 */
export const NOTIFICATION_LIMITS = {
  /**
   * Rule 20: permanent failures must not retry indefinitely, so there is a cap
   * at all. Five attempts across the backoff below spans roughly 31 minutes,
   * which outlasts an ordinary provider blip without holding a dead message for
   * hours.
   */
  MAX_ATTEMPTS: 5,
  /**
   * Rule 21: deterministic backoff, no jitter. The rule asks for predictability,
   * and a support engineer being able to say when the next attempt lands is
   * worth more here than spreading load across replicas.
   */
  BACKOFF_BASE_SECONDS: 60,
  MAX_BACKOFF_SECONDS: 3600,
  LIST_PAGE_SIZE: 25,
  MAX_LIST_PAGE_SIZE: 100,
  MAX_MESSAGE_TEMPLATE_LENGTH: 2000,
  MAX_TITLE_TEMPLATE_LENGTH: 500,
} as const;

/**
 * When the next attempt should run, in seconds after the one that just failed.
 *
 * `attemptNumber` is the attempt that failed, 1-based. Exponential on the base,
 * clamped at the ceiling — so a rule configured with a large base degrades to a
 * fixed hourly retry rather than to attempts days apart.
 *
 * Deterministic on purpose (Rule 21). If jitter is ever wanted, it belongs at
 * the queue's `startAfter`, not here, so this stays a pure function that a test
 * can assert an exact sequence against.
 */
export function backoffSeconds(
  attemptNumber: number,
  baseSeconds: number = NOTIFICATION_LIMITS.BACKOFF_BASE_SECONDS,
): number {
  const exponent = Math.max(0, attemptNumber - 1);
  const raw = baseSeconds * 2 ** exponent;
  return Math.min(raw, NOTIFICATION_LIMITS.MAX_BACKOFF_SECONDS);
}

/**
 * How a delivery failure is classified.
 *
 * The distinction is Rules 19 and 20: a retryable failure gets a scheduled next
 * attempt, a permanent one must never be retried again. Getting this wrong in
 * either direction is costly — retrying a permanent failure is Rule 20's
 * "retry indefinitely" in slow motion, and giving up on a transient one loses a
 * notification the recipient needed.
 */
export type FailureClass = 'RETRYABLE' | 'PERMANENT';

/**
 * Canonical failure codes, recorded on the delivery attempt.
 *
 * Written out rather than passed through from the provider so that the retry
 * decision reads a value this module defines. A provider that starts returning
 * a new error string must be mapped here deliberately; until it is, it lands in
 * `PROVIDER_ERROR` and is treated as retryable, which fails safe.
 */
export const FAILURE_CODES = {
  /** No email address or mobile number on the recipient. */
  MISSING_CONTACT: 'MISSING_CONTACT',
  /** The provider rejected the address itself. */
  INVALID_RECIPIENT: 'INVALID_RECIPIENT',
  /** SMTP 5xx, or a gateway's equivalent hard bounce. */
  PERMANENT_PROVIDER_ERROR: 'PERMANENT_PROVIDER_ERROR',
  /** SMTP 4xx — greylisting, mailbox full, rate limit. */
  TRANSIENT_PROVIDER_ERROR: 'TRANSIENT_PROVIDER_ERROR',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  /** Anything unmapped. Retryable by default — see FAILURE_CODES' note. */
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  /** The organization has no usable configuration for this channel. */
  CHANNEL_NOT_CONFIGURED: 'CHANNEL_NOT_CONFIGURED',
} as const;

export type FailureCode = (typeof FAILURE_CODES)[keyof typeof FAILURE_CODES];

/**
 * The failures that must never be retried.
 *
 * Note what is here and why: a missing email address is *permanent*, not
 * transient. Retrying a send to an address that does not exist burns the whole
 * attempt budget to arrive at the same answer, and the fix is a data change
 * rather than the passage of time.
 *
 * `CHANNEL_NOT_CONFIGURED` is the same shape: an organization with no SMTP
 * settings will still have none in sixteen minutes.
 */
const PERMANENT_FAILURES: ReadonlySet<string> = new Set<string>([
  FAILURE_CODES.MISSING_CONTACT,
  FAILURE_CODES.INVALID_RECIPIENT,
  FAILURE_CODES.PERMANENT_PROVIDER_ERROR,
  FAILURE_CODES.CHANNEL_NOT_CONFIGURED,
]);

/**
 * Whether a failure may be retried.
 *
 * Unknown codes are retryable. That is the safer default of the two: retrying
 * something permanent wastes at most `MAX_ATTEMPTS` calls and leaves a visible
 * trail, whereas treating something transient as permanent silently drops a
 * notification that would have succeeded on the next attempt.
 */
export function classifyFailure(code: string | null | undefined): FailureClass {
  if (!code) return 'RETRYABLE';
  return PERMANENT_FAILURES.has(code) ? 'PERMANENT' : 'RETRYABLE';
}

/**
 * The (source module, event) pairs a rule may be configured against.
 *
 * Scenario 15 requires an unsupported combination be rejected rather than saved
 * and left inert. A free-text `sourceModule` with no whitelist would let a rule
 * name `recovery` / `DISBURSAL_COMPLETED` — saved happily, matching nothing,
 * and indistinguishable from a delivery bug when someone asks why the
 * notification never arrived.
 *
 * Keyed by module so the rule form can populate its event dropdown from the
 * module the administrator picked first.
 */
export const SUPPORTED_EVENTS: Readonly<Record<string, readonly string[]>> = {
  loan_application: [
    'APPLICATION_SUBMITTED',
    'APPLICATION_RETURNED',
    'APPLICATION_REJECTED',
  ],
  approval: [
    'APPROVAL_REQUESTED',
    'APPROVAL_APPROVED',
    'APPROVAL_REJECTED',
    'APPROVAL_ESCALATED',
    'LOAN_APPROVED',
    'LOAN_REJECTED',
  ],
  disbursal: ['DISBURSAL_COMPLETED', 'DISBURSAL_FAILED'],
  repayment_schedule: ['EMI_DUE_TOMORROW', 'EMI_DUE_TODAY'],
  collection: [
    'EMI_PAID',
    'EMI_PARTIALLY_PAID',
    'RECEIPT_POSTED',
    'RECEIPT_REVERSED',
    'RECEIPT_GENERATED',
  ],
  field_collection: ['FIELD_SYNC_EXCEPTION'],
  cash: ['CASH_SHORTAGE', 'CASH_EXCESS'],
  overdue: ['EMI_MISSED', 'EMI_OVERDUE', 'PENALTY_ADDED', 'NPA_STATE_CHANGED'],
  recovery: [
    'RECOVERY_ASSIGNED',
    'PROMISE_TO_PAY_REMINDER',
    'PROMISE_TO_PAY_MISSED',
    'LOAN_WRITTEN_OFF',
  ],
  loan: ['LOAN_CLOSED', 'LOAN_FORECLOSED'],
  auth: ['SECURITY_ALERT'],
} as const;

/** Scenario 15: whether a rule may claim this (module, event) pair. */
export function isSupportedEvent(
  sourceModule: string,
  eventType: string,
): boolean {
  return SUPPORTED_EVENTS[sourceModule]?.includes(eventType) ?? false;
}

/**
 * Which preference category governs an event.
 *
 * A user toggles nine categories, not thirty-two events: nine switches is a
 * screen someone will configure, thirty-two is one they will abandon. This map
 * is what connects the two, and every event must appear in it — an event with
 * no category would be ungovernable by preference and would behave as though
 * mandatory without being marked so.
 *
 * `preferenceCategoryFor` throws on an unmapped event rather than defaulting,
 * so adding an event to the enum and forgetting this map fails a test rather
 * than silently making that event unsuppressible.
 */
const EVENT_PREFERENCE_CATEGORY: Readonly<Record<string, string>> = {
  APPLICATION_SUBMITTED: 'APPLICATION',
  APPLICATION_RETURNED: 'APPLICATION',
  APPLICATION_REJECTED: 'APPLICATION',

  APPROVAL_REQUESTED: 'APPROVAL',
  APPROVAL_APPROVED: 'APPROVAL',
  APPROVAL_REJECTED: 'APPROVAL',
  APPROVAL_ESCALATED: 'APPROVAL',
  LOAN_APPROVED: 'APPROVAL',
  LOAN_REJECTED: 'APPROVAL',

  DISBURSAL_COMPLETED: 'DISBURSAL',
  DISBURSAL_FAILED: 'DISBURSAL',

  EMI_DUE_TOMORROW: 'EMI',
  EMI_DUE_TODAY: 'EMI',
  EMI_PAID: 'EMI',
  EMI_PARTIALLY_PAID: 'EMI',

  RECEIPT_POSTED: 'COLLECTION',
  RECEIPT_REVERSED: 'COLLECTION',
  RECEIPT_GENERATED: 'COLLECTION',

  FIELD_SYNC_EXCEPTION: 'FIELD_COLLECTION',
  CASH_SHORTAGE: 'FIELD_COLLECTION',
  CASH_EXCESS: 'FIELD_COLLECTION',

  EMI_MISSED: 'OVERDUE',
  EMI_OVERDUE: 'OVERDUE',
  PENALTY_ADDED: 'OVERDUE',
  NPA_STATE_CHANGED: 'OVERDUE',

  RECOVERY_ASSIGNED: 'RECOVERY',
  PROMISE_TO_PAY_REMINDER: 'RECOVERY',
  PROMISE_TO_PAY_MISSED: 'RECOVERY',
  LOAN_WRITTEN_OFF: 'RECOVERY',
  LOAN_CLOSED: 'RECOVERY',
  LOAN_FORECLOSED: 'RECOVERY',

  SECURITY_ALERT: 'SECURITY',
} as const;

export function preferenceCategoryFor(eventType: string): string {
  const category = EVENT_PREFERENCE_CATEGORY[eventType];
  if (!category) {
    throw new Error(
      `No preference category is mapped for notification event ${eventType}. ` +
        'Every event must map to one, or it becomes ungovernable by user ' +
        'preference while not being marked mandatory.',
    );
  }
  return category;
}

/** Exposed for the spec that asserts the map covers the whole event enum. */
export const MAPPED_EVENT_TYPES = Object.keys(EVENT_PREFERENCE_CATEGORY);

/**
 * The overdue reminder cadence, in days past due.
 *
 * After the last entry the sweep repeats every `OVERDUE_REPEAT_EVERY_DAYS`, so
 * a long-overdue account keeps producing reminders without one entry per day
 * having to be listed.
 */
// TODO(open-question): Q-NOTIF-40 — the real cadence is unresolved. This one
// front-loads attention in the first fortnight and then settles to monthly,
// which matches how the recovery module's aging buckets are drawn.
export const OVERDUE_REMINDER_DAYS: readonly number[] = [1, 3, 7, 15, 30];
export const OVERDUE_REPEAT_EVERY_DAYS = 30;

/** Whether an overdue reminder is due at this many days past due. */
export function isOverdueReminderDay(daysPastDue: number): boolean {
  if (daysPastDue <= 0) return false;
  if (OVERDUE_REMINDER_DAYS.includes(daysPastDue)) return true;

  const last = OVERDUE_REMINDER_DAYS[OVERDUE_REMINDER_DAYS.length - 1];
  return (
    daysPastDue > last && (daysPastDue - last) % OVERDUE_REPEAT_EVERY_DAYS === 0
  );
}

/**
 * The channels Module 16 can actually deliver on.
 *
 * The Postgres enum also carries `PUSH` and `AUTO_CALL`, kept because dropping
 * an enum value rewrites the type. A rule targeting one would accumulate
 * permanent failures rather than failing when it was saved, so the API refuses
 * them here and a CHECK constraint refuses them again.
 */
export const SUPPORTED_CHANNELS = ['IN_APP', 'EMAIL', 'SMS'] as const;

export type SupportedChannel = (typeof SUPPORTED_CHANNELS)[number];

export function isSupportedChannel(
  channel: string,
): channel is SupportedChannel {
  return (SUPPORTED_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Build the deduplication key for a source event (Rules 12, 14, 22, 23).
 *
 * `sourceVersion` is what distinguishes a legitimate repeat from a replay. For
 * a scheduled reminder it is the Asia/Kolkata business date, which is what makes
 * a same-day re-run of the sweep produce nothing while the next day's run
 * produces the next reminder. For a state change it is the source row's version
 * or updated-at.
 *
 * Callers may pass their own key when they hold a better natural identity — a
 * collection's `Idempotency-Key`, for instance — which is why the emitter takes
 * an override rather than always computing this.
 */
export function deduplicationKey(input: {
  eventType: string;
  sourceModule: string;
  sourceRecordId?: string | null;
  sourceVersion?: string | null;
}): string {
  return [
    input.eventType,
    input.sourceModule,
    input.sourceRecordId ?? 'none',
    input.sourceVersion ?? 'v1',
  ].join(':');
}
