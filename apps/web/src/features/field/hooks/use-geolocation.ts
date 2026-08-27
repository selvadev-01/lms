"use client";

import { useCallback, useRef, useState } from "react";

/** What the browser gave us, normalized into the shape the server expects. */
export interface GeolocationSuccess {
  kind: "success";
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  /** ISO-8601, from `GeolocationPosition.timestamp`. */
  locationTimestamp: string;
}

export interface GeolocationFailure {
  kind: "failure";
  /**
   * Includes GRANTED: a timeout or an unavailable position happens *after*
   * permission was given, and recording it as DENIED would misattribute the
   * cause in the audit trail.
   */
  permissionStatus: "GRANTED" | "DENIED" | "UNAVAILABLE" | "UNKNOWN";
  failureReason:
    "PERMISSION_DENIED" | "POSITION_UNAVAILABLE" | "TIMEOUT" | "PROVIDER_ERROR";
}

export type GeolocationResult = GeolocationSuccess | GeolocationFailure;

/**
 * `GeolocationPositionError` codes, named rather than compared numerically.
 *
 * The constants are only reliably present on an error *instance*, so a test
 * stub or a partial implementation may not expose them — these literals are
 * fixed by the spec and safe to hard-code.
 */
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

function classify(error: { code?: number }): GeolocationFailure {
  switch (error.code) {
    case PERMISSION_DENIED:
      return {
        kind: "failure",
        permissionStatus: "DENIED",
        failureReason: "PERMISSION_DENIED",
      };
    case POSITION_UNAVAILABLE:
      // Covers a disabled location service as well as a failed fix — the
      // browser does not distinguish them, and neither can we (Scenario 8).
      return {
        kind: "failure",
        permissionStatus: "GRANTED",
        failureReason: "POSITION_UNAVAILABLE",
      };
    case TIMEOUT:
      return {
        kind: "failure",
        permissionStatus: "GRANTED",
        failureReason: "TIMEOUT",
      };
    default:
      // An unrecognized code is still a real provider failure (Scenario 12).
      // Never fall through to success.
      return {
        kind: "failure",
        permissionStatus: "UNKNOWN",
        failureReason: "PROVIDER_ERROR",
      };
  }
}

export interface UseGeolocationOptions {
  /** Acquisition timeout in milliseconds, served from server config. */
  timeoutMs: number;
}

/**
 * Wraps `navigator.geolocation.getCurrentPosition` as a promise.
 *
 * Never rejects: a denied permission and a timeout are ordinary, expected
 * outcomes of a check-in attempt, not exceptions. Returning them as values is
 * what lets the caller record every one of them as an audited failure rather
 * than losing some to an unhandled rejection.
 *
 * `maximumAge: 0` is deliberate — a cached position must not be passed off as
 * a current one (Scenario 21). The server independently rejects a stale
 * timestamp, so this is defence in depth rather than the only check.
 */
export function useGeolocation({ timeoutMs }: UseGeolocationOptions) {
  const [acquiring, setAcquiring] = useState(false);
  // Guards against a double click starting two overlapping acquisitions, which
  // would produce two attempt records for one user action.
  const inFlight = useRef(false);

  const acquire = useCallback(async (): Promise<GeolocationResult> => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      // No API at all — an old browser, or an insecure origin (Scenario 8).
      return {
        kind: "failure",
        permissionStatus: "UNAVAILABLE",
        failureReason: "POSITION_UNAVAILABLE",
      };
    }

    if (inFlight.current) {
      return {
        kind: "failure",
        permissionStatus: "UNKNOWN",
        failureReason: "PROVIDER_ERROR",
      };
    }

    inFlight.current = true;
    setAcquiring(true);

    try {
      return await new Promise<GeolocationResult>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) =>
            resolve({
              kind: "success",
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyMeters: Number.isFinite(position.coords.accuracy)
                ? position.coords.accuracy
                : null,
              locationTimestamp: new Date(position.timestamp).toISOString(),
            }),
          (error) => resolve(classify(error)),
          {
            enableHighAccuracy: true,
            timeout: timeoutMs,
            maximumAge: 0,
          },
        );
      });
    } finally {
      inFlight.current = false;
      setAcquiring(false);
    }
  }, [timeoutMs]);

  return { acquire, acquiring };
}
