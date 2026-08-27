import "server-only";

import type { CheckInStatusResponse, GpsCheckInSummary } from "@lms/types";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

/**
 * GPS check-in data layer.
 *
 * Server-only and cookie-forwarding, exactly as the auth feature's fetchers
 * are: the browser never calls the API directly, so session cookies stay
 * same-site and the access token is never exposed to client JavaScript.
 */

export type CheckInStatusResult =
  | { status: "ok"; data: CheckInStatusResponse }
  /** The session ended underneath us — the caller should send them to sign in. */
  | { status: "unauthenticated" }
  /** The caller does not hold `field.checkin`. */
  | { status: "forbidden" }
  /** The API is unreachable or errored. */
  | { status: "error" };

/**
 * Loads whether the caller currently holds a verified check-in.
 *
 * Returns a discriminated result rather than defaulting to `verified: false`
 * on failure. Both mean "you may not proceed", but only one of them means
 * "check in now" — telling a field employee to re-verify when the API is
 * simply down would send them chasing a GPS fix that was never the problem.
 */
export async function fetchCheckInStatus(): Promise<CheckInStatusResult> {
  const cookieStore = await cookies();

  try {
    const response = await fetch(
      `${env.API_BASE_URL}/api/v1/field/check-in/status`,
      {
        headers: { cookie: cookieStore.toString() },
        cache: "no-store",
      },
    );

    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status === 403) return { status: "forbidden" };
    if (!response.ok) return { status: "error" };

    const data = (await response.json()) as CheckInStatusResponse;
    return { status: "ok", data };
  } catch {
    return { status: "error" };
  }
}

export type CheckInHistoryResult =
  | { status: "ok"; checkIns: GpsCheckInSummary[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "error" };

/** The caller's own recent check-in attempts, successful and failed alike. */
export async function fetchCheckInHistory(): Promise<CheckInHistoryResult> {
  const cookieStore = await cookies();

  try {
    const response = await fetch(
      `${env.API_BASE_URL}/api/v1/field/check-in/history`,
      {
        headers: { cookie: cookieStore.toString() },
        cache: "no-store",
      },
    );

    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status === 403) return { status: "forbidden" };
    if (!response.ok) return { status: "error" };

    const body = (await response.json()) as { checkIns: GpsCheckInSummary[] };
    return { status: "ok", checkIns: body.checkIns };
  } catch {
    return { status: "error" };
  }
}
