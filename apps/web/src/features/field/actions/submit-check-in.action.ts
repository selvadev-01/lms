"use server";

import type { SubmitCheckInResponse } from "@lms/types";
import { gpsCheckInSchema } from "@lms/validation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/features/auth/api/session";
import { CSRF_HEADERS } from "@/lib/api-call";
import { env } from "@/lib/env";

export interface CheckInState {
  /** Non-field error shown above the panel. */
  message?: string;
  /** Set when the location was verified, so the panel can offer to continue. */
  verified?: boolean;
  /** Recorded failure cause, so the panel can explain what to fix. */
  failureReason?: string;
}

const NOT_PERMITTED =
  "Your account is not set up for field check-in. Contact your administrator.";
const RATE_LIMITED = "Too many attempts. Please wait a moment and try again.";
const SERVICE_UNAVAILABLE =
  "Check-in is temporarily unavailable. Please try again shortly.";
const INVALID_READING =
  "That location reading could not be used. Please try again.";

/**
 * Human-readable explanation for each recorded failure.
 *
 * Deliberately actionable rather than diagnostic: the field employee needs to
 * know what to do next, not which rule fired. The precise reason is still in
 * the audit log and the check-in row for support to look up.
 */
const FAILURE_MESSAGES: Record<string, string> = {
  PERMISSION_DENIED:
    "Location permission is blocked. Allow location access for this site in your browser settings, then try again.",
  POSITION_UNAVAILABLE:
    "Your device could not determine a location. Move to an area with a clearer view of the sky and try again.",
  TIMEOUT:
    "Finding your location took too long. Check that location services are on, then try again.",
  ACCURACY_REJECTED:
    "Your location was not precise enough to verify. Move outdoors or closer to a window and try again.",
  STALE_LOCATION:
    "That location reading was out of date. Please try again to capture a current position.",
  INVALID_COORDINATES:
    "Your device did not return a usable location. Please try again.",
  PROVIDER_ERROR: "Your device reported a location error. Please try again.",
  NETWORK_LOST:
    "You went offline before the check-in could be confirmed. Reconnect and try again.",
};

function describeFailure(reason: string | null | undefined): string {
  return (reason && FAILURE_MESSAGES[reason]) ?? INVALID_READING;
}

/**
 * Submits a captured position for verification.
 *
 * The coordinates arrive as hidden form fields because the browser geolocation
 * API only exists client-side; the panel captures the position, fills them in
 * and submits. The values are still validated here — a Server Action is a
 * public endpoint, and a hidden input is not a guarantee of anything.
 */
export async function submitCheckInAction(
  _previous: CheckInState,
  formData: FormData,
): Promise<CheckInState> {
  const parsed = gpsCheckInSchema.safeParse({
    clientAttemptId: formData.get("clientAttemptId"),
    latitude: formData.get("latitude") || undefined,
    longitude: formData.get("longitude") || undefined,
    accuracyMeters: formData.get("accuracyMeters") || undefined,
    locationTimestamp: formData.get("locationTimestamp") || undefined,
    permissionStatus: formData.get("permissionStatus"),
    networkStatus: formData.get("networkStatus"),
  });

  if (!parsed.success) return { message: INVALID_READING };

  const cookieStore = await cookies();

  // Resolved inside the try, acted on outside it, because redirect() throws
  // and would otherwise be caught by this action's own catch.
  let outcome: SubmitCheckInResponse | "session-ended" | { message: string };

  try {
    const response = await fetch(`${env.API_BASE_URL}/api/v1/field/check-in`, {
      method: "POST",
      headers: {
        ...CSRF_HEADERS,
        "Content-Type": "application/json",
        cookie: cookieStore.toString(),
      },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    });

    if (response.status === 401) outcome = "session-ended";
    else if (response.status === 403) outcome = { message: NOT_PERMITTED };
    else if (response.status === 429) outcome = { message: RATE_LIMITED };
    else if (!response.ok) outcome = { message: SERVICE_UNAVAILABLE };
    else outcome = (await response.json()) as SubmitCheckInResponse;
  } catch {
    return { message: SERVICE_UNAVAILABLE };
  }

  if (outcome === "session-ended") {
    cookieStore.delete(ACCESS_COOKIE);
    cookieStore.delete(REFRESH_COOKIE);
    redirect("/signin");
  }

  if ("message" in outcome) return outcome;

  // Both outcomes revalidate: a failure changes the history the page shows,
  // and a success changes whether /field will admit the user at all.
  revalidatePath("/field/check-in");
  revalidatePath("/field");

  if (outcome.verified) return { verified: true };

  return {
    verified: false,
    failureReason: outcome.checkIn.failureReason ?? undefined,
    message: describeFailure(outcome.checkIn.failureReason),
  };
}
