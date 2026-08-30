"use server";

import { gpsFailureSchema } from "@lms/validation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/features/auth/api/session";
import { CSRF_HEADERS } from "@/lib/api-call";
import { env } from "@/lib/env";

import type { CheckInState } from "./submit-check-in.action";

const NOT_PERMITTED =
  "Your account is not set up for field check-in. Contact your administrator.";
const SERVICE_UNAVAILABLE =
  "Check-in is temporarily unavailable. Please try again shortly.";

/** Mirrors the messages in submit-check-in.action.ts for the device-side causes. */
const FAILURE_MESSAGES: Record<string, string> = {
  PERMISSION_DENIED:
    "Location permission is blocked. Allow location access for this site in your browser settings, then try again.",
  POSITION_UNAVAILABLE:
    "Your device could not determine a location. Move to an area with a clearer view of the sky and try again.",
  TIMEOUT:
    "Finding your location took too long. Check that location services are on, then try again.",
  PROVIDER_ERROR: "Your device reported a location error. Please try again.",
  NETWORK_LOST:
    "You appear to be offline. Reconnect to check in, or continue in Offline Mode.",
  CANCELLED: "Location check was cancelled.",
};

/**
 * Records a failure the browser reported before any position existed.
 *
 * This exists so a denied permission or a timeout still produces a durable,
 * audited record (Scenarios 6-8, 11, 12). Without it those failures would
 * happen entirely in the browser and the server would never learn that a field
 * employee tried and could not check in.
 *
 * The user still sees an error either way; the point of the round trip is the
 * audit trail, so a failure to record it must not itself become a second error
 * message competing with the first.
 */
export async function reportCheckInFailureAction(
  _previous: CheckInState,
  formData: FormData,
): Promise<CheckInState> {
  const parsed = gpsFailureSchema.safeParse({
    clientAttemptId: formData.get("clientAttemptId"),
    permissionStatus: formData.get("permissionStatus"),
    networkStatus: formData.get("networkStatus"),
    failureReason: formData.get("failureReason"),
  });

  if (!parsed.success) return { message: SERVICE_UNAVAILABLE };

  const userMessage =
    FAILURE_MESSAGES[parsed.data.failureReason] ?? SERVICE_UNAVAILABLE;

  const cookieStore = await cookies();

  let outcome: "recorded" | "session-ended" | { message: string };

  try {
    const response = await fetch(
      `${env.API_BASE_URL}/api/v1/field/check-in/failure`,
      {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          "Content-Type": "application/json",
          cookie: cookieStore.toString(),
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      },
    );

    if (response.status === 401) outcome = "session-ended";
    else if (response.status === 403) outcome = { message: NOT_PERMITTED };
    // A rate limit or an outage here means the failure went unrecorded. The
    // user's actual problem is still the GPS failure, so that is what they are
    // told — reporting a logging problem instead would be misleading.
    else if (!response.ok) outcome = { message: userMessage };
    else outcome = "recorded";
  } catch {
    return { verified: false, message: userMessage };
  }

  if (outcome === "session-ended") {
    cookieStore.delete(ACCESS_COOKIE);
    cookieStore.delete(REFRESH_COOKIE);
    redirect("/signin");
  }

  if (typeof outcome === "object") return { verified: false, ...outcome };

  revalidatePath("/field/check-in");

  return {
    verified: false,
    failureReason: parsed.data.failureReason,
    message: userMessage,
  };
}
