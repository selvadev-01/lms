"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CSRF_HEADERS } from "@/lib/api-call";
import { env } from "@/lib/env";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  RESET_TOKEN_COOKIE,
  forgetCachedSession,
} from "../api/session";

/**
 * Terminates the session created at sign-in (Scenario 36).
 *
 * Revokes the session server-side first, then clears the local cookies — the
 * database row is what actually invalidates the session, so deleting only the
 * cookies would leave a usable refresh token in existence.
 */
export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  // Read before the cookie is cleared: the profile cache is keyed by the token,
  // so this is the last moment the key is available. Without it a revoked token
  // could still be served from cache for the rest of its lifetime.
  const token = cookieStore.get(ACCESS_COOKIE)?.value;

  try {
    await fetch(`${env.API_BASE_URL}/api/v1/auth/sign-out`, {
      method: "POST",
      headers: { ...CSRF_HEADERS, cookie: cookieStore.toString() },
      cache: "no-store",
    });
  } catch {
    // Even if revocation is unreachable, still clear the local session.
  }

  forgetCachedSession(token);
  cookieStore.delete(ACCESS_COOKIE);
  cookieStore.delete(REFRESH_COOKIE);
  // Belt and braces: the recovery flow already deletes this on both its success
  // and failure paths, so it should never be present here. An abandoned reset
  // (verified, then never submitted) is the one case that leaves it behind, and
  // signing out is a reasonable place to stop carrying it.
  cookieStore.delete(RESET_TOKEN_COOKIE);

  redirect("/signin");
}
