"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { env } from "@/lib/env";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../api/session";

export interface RevokeSessionState {
  /** Non-field error shown above the table. */
  message?: string;
  /** Confirmation shown after a successful revocation. */
  success?: string;
}

const NOT_PERMITTED = "You do not have permission to end that session.";
const RATE_LIMITED = "Too many attempts. Please wait a moment and try again.";
const SERVICE_UNAVAILABLE =
  "Sessions are temporarily unavailable. Please try again shortly.";

/**
 * Ends one of the caller's own sessions.
 *
 * The session id travels in the URL of the API call and is validated there; the
 * server pairs it with the caller's own user id from the session cookie, so a
 * tampered id cannot reach another user's session (Scenario 24).
 */
export async function revokeSessionAction(
  _previous: RevokeSessionState,
  formData: FormData,
): Promise<RevokeSessionState> {
  const sessionId = formData.get("sessionId");
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { message: SERVICE_UNAVAILABLE };
  }

  const cookieStore = await cookies();

  /**
   * Resolved inside the try, acted on outside it.
   *
   * `redirect` works by throwing, so calling it inside the try below would be
   * caught by this action's own catch and reported as a failure — turning a
   * successful sign-out into an error message.
   */
  let outcome: "revoked" | "session-ended" | { message: string };

  try {
    const response = await fetch(
      `${env.API_BASE_URL}/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: { cookie: cookieStore.toString() },
        cache: "no-store",
      },
    );

    if (response.status === 401) {
      // The caller's own session has gone: send them to sign in rather than
      // reporting a failure they cannot act on.
      outcome = "session-ended";
    } else if (response.status === 403) {
      outcome = { message: NOT_PERMITTED };
    } else if (response.status === 429) {
      outcome = { message: RATE_LIMITED };
    } else if (!response.ok) {
      outcome = { message: SERVICE_UNAVAILABLE };
    } else {
      const body = (await response.json()) as {
        currentSessionRevoked?: boolean;
      };
      outcome =
        body.currentSessionRevoked === true ? "session-ended" : "revoked";
    }
  } catch {
    // Scenario 38: never claim a server-side termination that was not
    // confirmed. The local session is left intact and the user can retry.
    return { message: SERVICE_UNAVAILABLE };
  }

  if (typeof outcome === "object") return outcome;

  if (outcome === "session-ended") {
    cookieStore.delete(ACCESS_COOKIE);
    cookieStore.delete(REFRESH_COOKIE);
    redirect("/signin");
  }

  revalidatePath("/active-sessions");
  return { success: "That session has been signed out." };
}
