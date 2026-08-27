import "server-only";

import type { SessionSummary } from "@lms/types";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

/**
 * Active Sessions data layer.
 *
 * Server-only and cookie-forwarding, exactly as `session.ts` is: the browser
 * never calls the API directly, so the session cookies stay same-site and the
 * access token is never exposed to client JavaScript.
 */

export type SessionsResult =
  | { status: "ok"; sessions: SessionSummary[] }
  /** The session ended underneath us — the caller should send them to sign in. */
  | { status: "unauthenticated" }
  /** The API is unreachable or errored; the screen shows a retry state. */
  | { status: "error" };

/**
 * Loads the caller's active sessions.
 *
 * Returns a discriminated result rather than throwing or returning an empty
 * list on failure: "you have no other sessions" and "we could not find out"
 * are different things, and a screen about session security must not present
 * the second as the first.
 */
export async function fetchActiveSessions(): Promise<SessionsResult> {
  const cookieStore = await cookies();

  try {
    const response = await fetch(`${env.API_BASE_URL}/api/v1/auth/sessions`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });

    if (response.status === 401) return { status: "unauthenticated" };
    if (!response.ok) return { status: "error" };

    const body = (await response.json()) as { sessions: SessionSummary[] };
    return { status: "ok", sessions: body.sessions };
  } catch {
    return { status: "error" };
  }
}
