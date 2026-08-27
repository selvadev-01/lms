import type {
  GpsFailureReason,
  GpsNetworkStatus,
  GpsPermissionStatus,
  GpsVerificationStatus,
} from '@lms/types';

/**
 * GPS check-in verification rules.
 *
 * The source flow diagram shows only `GPS Check-in → Location Verified` and
 * never defines the failure branch, the accuracy threshold or the freshness
 * window (Q-GPS-1, Q-GPS-7, Q-GPS-10, Q-GPS-11, Q-GPS-12). The thresholds are
 * therefore applied defaults, passed in as {@link GpsPolicy} so a product
 * decision changes an environment variable rather than this file.
 *
 * What is *not* a default is the direction of failure: the story is explicit
 * that the system must never mark a check-in verified without a valid location
 * (Rules 8, 9). Every rule below is written so that missing or unusable
 * evidence fails, rather than being assumed acceptable.
 *
 * Pure, like `deriveSessionState`: no clock read, no I/O. The caller supplies
 * `now`, so every branch is directly testable and the same inputs always give
 * the same verdict.
 *
 * Runtime values are declared here rather than imported from @lms/constants —
 * that package ships raw ESM with no build step, so the CJS Nest build cannot
 * require it. GPS_VERIFICATION_STATUS and GPS_FAILURE_REASON there are the
 * shared declaration for web; the two must be kept in step.
 */

export const GPS_VERIFICATION_STATUS = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const satisfies Record<string, GpsVerificationStatus>;

export const GPS_FAILURE_REASON = {
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  POSITION_UNAVAILABLE: 'POSITION_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  ACCURACY_REJECTED: 'ACCURACY_REJECTED',
  STALE_LOCATION: 'STALE_LOCATION',
  INVALID_COORDINATES: 'INVALID_COORDINATES',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  NETWORK_LOST: 'NETWORK_LOST',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  CANCELLED: 'CANCELLED',
} as const satisfies Record<string, GpsFailureReason>;

/** Thresholds from `field.config.ts`. */
export interface GpsPolicy {
  /** Worst acceptable device-reported accuracy, in metres. 0 disables the rule. */
  maxAccuracyMeters: number;
  /** How old a device-reported position may be, in seconds. */
  maxLocationAgeSeconds: number;
  /**
   * How far a device clock may run ahead before its timestamp is disbelieved.
   * Real clocks drift by seconds; without an allowance, honest devices fail.
   */
  maxClockSkewSeconds: number;
}

/** What the client claims about the position and the device that produced it. */
export interface LocationCandidate {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  locationTimestamp?: Date;
  permissionStatus: GpsPermissionStatus;
  networkStatus: GpsNetworkStatus;
}

export type VerificationOutcome =
  | { status: typeof GPS_VERIFICATION_STATUS.VERIFIED }
  | { status: typeof GPS_VERIFICATION_STATUS.FAILED; reason: GpsFailureReason };

/** Finite and inside `[-limit, limit]`. Rejects NaN and Infinity by construction. */
function isValidCoordinate(value: number | undefined, limit: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= limit
  );
}

function fail(reason: GpsFailureReason): VerificationOutcome {
  return { status: GPS_VERIFICATION_STATUS.FAILED, reason };
}

/**
 * Decides whether one candidate position may be marked `VERIFIED`.
 *
 * Order is significant, and is by what the user must fix first rather than by
 * how the data is laid out:
 *
 *   1. Permission — nothing downstream is meaningful if the device was never
 *      allowed to locate itself, and a client can send coordinates alongside a
 *      DENIED permission, so this must outrank them (Scenarios 7, 8).
 *   2. Network — an offline attempt cannot be server-verified at all, so it is
 *      refused before its contents are judged (Scenario 17).
 *   3. Coordinates — with no usable position, the freshness and accuracy of
 *      "nothing" are not facts worth reporting (Scenario 9).
 *   4. Freshness — a real but old position is a different failure from an
 *      absent one, and is the one the story calls out by name (Scenario 21).
 *   5. Accuracy — checked last: it is the weakest claim, and only meaningful
 *      once the position is known to be real and current (Scenario 10).
 */
export function evaluateLocation(
  candidate: LocationCandidate,
  policy: GpsPolicy,
  now: Date,
): VerificationOutcome {
  if (candidate.permissionStatus !== 'GRANTED') {
    return fail(GPS_FAILURE_REASON.PERMISSION_DENIED);
  }

  if (candidate.networkStatus !== 'ONLINE') {
    return fail(GPS_FAILURE_REASON.NETWORK_LOST);
  }

  if (
    !isValidCoordinate(candidate.latitude, 90) ||
    !isValidCoordinate(candidate.longitude, 180)
  ) {
    return fail(GPS_FAILURE_REASON.INVALID_COORDINATES);
  }

  // Absent freshness evidence is not evidence of freshness — a missing
  // timestamp is treated exactly like an expired one.
  if (!candidate.locationTimestamp) {
    return fail(GPS_FAILURE_REASON.STALE_LOCATION);
  }

  const ageMs = now.getTime() - candidate.locationTimestamp.getTime();

  // A negative age means the device clock is ahead. Beyond the skew allowance
  // that is disbelieved rather than accepted: otherwise winding the clock
  // forward would make any stale position look permanently fresh.
  if (
    ageMs > policy.maxLocationAgeSeconds * 1000 ||
    ageMs < -policy.maxClockSkewSeconds * 1000
  ) {
    return fail(GPS_FAILURE_REASON.STALE_LOCATION);
  }

  if (policy.maxAccuracyMeters > 0) {
    const accuracy = candidate.accuracyMeters;

    // Unknown or nonsensical accuracy cannot be shown to meet the threshold.
    if (
      typeof accuracy !== 'number' ||
      !Number.isFinite(accuracy) ||
      accuracy < 0 ||
      accuracy > policy.maxAccuracyMeters
    ) {
      return fail(GPS_FAILURE_REASON.ACCURACY_REJECTED);
    }
  }

  return { status: GPS_VERIFICATION_STATUS.VERIFIED };
}
