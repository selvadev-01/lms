import { registerAs } from '@nestjs/config';

/** Parse an integer environment value, falling back to a documented default. */
function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Module 16 — notification delivery and queue settings.
 *
 * Split from `auth.config.ts` (which owns `SMS_PROVIDER`) because the two have
 * different lifetimes: the SMS gateway serves password recovery and mobile
 * verification whether or not notifications exist, while everything here is
 * dead configuration until the notification pipeline runs.
 */
export default registerAs('notifications', () => ({
  /**
   * Whether this process registers queue workers.
   *
   * True in development and production; the Jest suite sets it false so unit
   * tests do not spawn pollers against a real database. Note that a process
   * with workers disabled still *enqueues* — turning this off makes a replica
   * write-only, it does not disable notifications.
   */
  workerEnabled: bool(process.env.NOTIFICATIONS_WORKER_ENABLED, true),

  /**
   * How many jobs one worker takes per poll, and how often it polls.
   *
   * Modest on purpose: notification delivery is not latency-critical, and a
   * large batch holds more rows under a single failure.
   */
  workerBatchSize: int(process.env.NOTIFICATIONS_WORKER_BATCH_SIZE, 10),
  workerPollIntervalSeconds: int(
    process.env.NOTIFICATIONS_WORKER_POLL_SECONDS,
    5,
  ),

  /**
   * How long a completed pg-boss job row is kept.
   *
   * This is queue bookkeeping, not the notification audit trail — the
   * authoritative history lives in `notifications` and `notification_deliveries`
   * and is never purged (Rules 69, 70). Seven days is enough to debug a delivery
   * incident while the operator still remembers it.
   */
  jobRetentionDays: int(process.env.NOTIFICATIONS_JOB_RETENTION_DAYS, 7),

  /**
   * The cron expression and timezone for the daily reminder sweep.
   *
   * 06:00 Asia/Kolkata: late enough that an EMI due today reads as due *today*
   * to a recipient in the field, early enough to precede a working day. The
   * timezone is not configurable by accident — every business date in the LMS is
   * Asia/Kolkata, and a sweep running on a different one would compute a
   * different "today" than the schedule it is reading.
   */
  reminderCron: process.env.NOTIFICATIONS_REMINDER_CRON ?? '0 6 * * *',
  reminderTimezone: 'Asia/Kolkata',

  /**
   * The deployment-wide email gateway, used when an organization has no
   * `email_provider_configs` row. Mirrors how `SMS_PROVIDER` behaves.
   */
  emailProvider: (process.env.EMAIL_PROVIDER ?? 'console').toLowerCase(),

  /**
   * SMTP credentials and defaults.
   *
   * The password is environment-only and never stored in the database, matching
   * the `SmsProviderConfig` principle: the database says *which* provider and
   * *how to address it*, the environment says how to authenticate.
   */
  smtp: {
    host: process.env.SMTP_HOST ?? null,
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    username: process.env.SMTP_USERNAME ?? null,
    password: process.env.SMTP_PASSWORD ?? null,
    fromAddress: process.env.SMTP_FROM_ADDRESS ?? null,
    fromName: process.env.SMTP_FROM_NAME ?? 'LMS',
  },
}));
