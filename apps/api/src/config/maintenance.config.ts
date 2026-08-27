import { registerAs } from '@nestjs/config';

/**
 * Module 17 — maintenance and end-of-day.
 *
 * Two absences here are deliberate.
 *
 * **No `eodTimezone`.** The business date an EOD run closes is Asia/Kolkata by
 * Rule 65, and a configurable scheduling timezone would let the sweep fire on a
 * day boundary the data does not share — closing yesterday or tomorrow depending
 * on the operator's guess. The cron EXPRESSION is configurable; the timezone it
 * is interpreted in is not.
 *
 * **No `workerEnabled`.** `QueueService` already has one global switch
 * (`notifications.workerEnabled`, despite the name) and `work()` no-ops when it
 * is false. A second flag would be a divergent switch that could disable half a
 * process's workers — and a replica registering the reminder sweep but not the
 * EOD sweep is not a state anybody wants to debug.
 */
export default registerAs('maintenance', () => ({
  /**
   * When the nightly sweep fires, in Asia/Kolkata.
   *
   * Default 21:30 — after the working day and before midnight, so the run's
   * derived business date is still the day being closed. A value past midnight
   * silently closes the FOLLOWING day, because the handler derives its date from
   * the clock rather than being told.
   */
  eodCron: process.env.MAINTENANCE_EOD_CRON ?? '30 21 * * *',
}));
