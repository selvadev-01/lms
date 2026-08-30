"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { CSRF_HEADERS } from "@/lib/api-call";
import { env } from "@/lib/env";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  forgetCachedSession,
} from "../api/session";
import type { RevokeSessionState } from "./revoke-session.action";

const RATE_LIMITED = "Too many attempts. Please wait a moment and try again.";
const SERVICE_UNAVAILABLE =
  "Sessions are temporarily unavailable. Please try again shortly.";

/**
 * Ends every session except this one.
 *
 * The current session is deliberately spared by the API, so the user is not
 * signed out of the screen they are using to secure their account.
 */
export async function revokeAllSessionsAction(
  /**
   * `useActionState` passes the previous state positionally. This action needs
   * nothing from it — the API takes both the caller and the session to spare
   * from the session cookie — but the parameter must exist to be passed over.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _previous: RevokeSessionState,
): Promise<RevokeSessionState> {
  const cookieStore = await cookies();

  // Resolved inside the try and acted on outside it, because `redirect` throws.
  let outcome: { revokedCount: number } | "session-ended" | { message: string };

  try {
    const response = await fetch(
      `${env.API_BASE_URL}/api/v1/auth/sessions/revoke-all`,
      {
        method: "POST",
        headers: { ...CSRF_HEADERS, cookie: cookieStore.toString() },
        cache: "no-store",
      },
    );

    if (response.status === 401) {
      outcome = "session-ended";
    } else if (response.status === 429) {
      outcome = { message: RATE_LIMITED };
    } else if (!response.ok) {
      outcome = { message: SERVICE_UNAVAILABLE };
    } else {
      const body = (await response.json()) as { revokedCount?: number };
      outcome = { revokedCount: body.revokedCount ?? 0 };
    }
  } catch {
    return { message: SERVICE_UNAVAILABLE };
  }

  if (outcome === "session-ended") {
    forgetCachedSession(cookieStore.get(ACCESS_COOKIE)?.value);
    cookieStore.delete(ACCESS_COOKIE);
    cookieStore.delete(REFRESH_COOKIE);
    redirect("/signin");
  }

  if ("message" in outcome) return outcome;

  revalidatePath("/active-sessions");

  // Reporting the count matters: "0 other sessions ended" tells the user their
  // account was only signed in here, which a bare "Done" would not.
  return {
    success:
      outcome.revokedCount === 0
        ? "There were no other sessions to sign out."
        : `Signed out ${outcome.revokedCount} other ${
            outcome.revokedCount === 1 ? "session" : "sessions"
          }.`,
  };
}
