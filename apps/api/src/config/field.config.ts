import { registerAs } from '@nestjs/config';

/**
 * Field-operations configuration.
 *
 * The Field Employee flow diagram establishes only `GPS Check-in → Location
 * Verified`; it defines no accuracy threshold, no timeout, no geofence and no
 * validity window (Q-GPS-1, Q-GPS-3, Q-GPS-7, Q-GPS-10 in
 * docs/OPEN-QUESTIONS.md). Every value below is therefore an *applied default*
 * — documented and env-driven, so answering the open question changes an
 * environment variable rather than this file.
 *
 * The one thing not treated as tunable is the direction of failure: no setting
 * here can make a missing or unusable location verify. That rule lives in
 * `gps-verification.ts` and is not configurable, because the story states it
 * outright (Rules 8, 9).
 */

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default registerAs('field', () => ({
  // --- GPS verification thresholds (Q-GPS-1, Q-GPS-10, Q-GPS-12) -----------
  /**
   * Worst device-reported accuracy accepted, in metres (Q-GPS-1).
   *
   * 100 m is roughly what a phone reports indoors or on network positioning,
   * and comfortably inside what GPS gives outdoors — the intent is to reject a
   * coarse cell-tower fix while not failing a field employee standing inside a
   * customer's house. Set to 0 to disable the rule entirely.
   */
  gpsMaxAccuracyMeters: int(process.env.FIELD_GPS_MAX_ACCURACY_METERS, 100),

  /**
   * How old a device-reported position may be, in seconds (Q-GPS-10).
   *
   * The story forbids silently accepting a stale location as current
   * (Scenario 21). The browser is asked for `maximumAge: 0`, so a fresh fix is
   * always sought; this window only covers the round trip and normal clock
   * drift.
   */
  gpsMaxLocationAgeSeconds: int(
    process.env.FIELD_GPS_MAX_LOCATION_AGE_SECONDS,
    120,
  ),

  /**
   * How far a device clock may run ahead of the server before its timestamp is
   * disbelieved, in seconds (Q-GPS-12).
   *
   * Without an allowance, ordinary drift would fail honest devices; without a
   * bound, winding the clock forward would make any stale position look
   * permanently fresh.
   */
  gpsMaxClockSkewSeconds: int(process.env.FIELD_GPS_MAX_CLOCK_SKEW_SECONDS, 60),

  /**
   * Acquisition timeout handed to the browser, in seconds (Q-GPS-7).
   *
   * Served to the client rather than enforced here — the timeout happens in the
   * device, and the server only records the failure it reports.
   */
  gpsTimeoutSeconds: int(process.env.FIELD_GPS_TIMEOUT_SECONDS, 30),

  // --- Check-in validity ---------------------------------------------------
  /**
   * How long a verified check-in authorizes field operations, in hours.
   *
   * 12 hours covers a working day without letting yesterday's check-in unlock
   * today's. A check-in also dies with its session, so this is the ceiling, not
   * the only limit.
   */
  checkInValidityHours: int(process.env.FIELD_CHECKIN_VALIDITY_HOURS, 12),
}));
