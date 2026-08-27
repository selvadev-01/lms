"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/lib/env";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../api/session";

/**
 * Terminates the session created at sign-in (Scenario 36).
 *
 * Revokes the session server-side first, then clears the local cookies — the
 * database row is what actually invalidates the session, so deleting only the
 * cookies would leave a usable refresh token in existence.
 */
export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();

  try {
    await fetch(`${env.API_BASE_URL}/api/v1/auth/sign-out`, {
      method: "POST",
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });
  } catch {
    // Even if revocation is unreachable, still clear the local session.
  }

  cookieStore.delete(ACCESS_COOKIE);
  cookieStore.delete(REFRESH_COOKIE);

  redirect("/signin");
}
