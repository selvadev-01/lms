import "server-only";

import type { AuthUser } from "@lms/types";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { env } from "@/lib/env";

export const ACCESS_COOKIE = "lms_at";
export const REFRESH_COOKIE = "lms_rt";

/**
 * Holds the single-use password-reset authorization between the verify step and
 * the reset form.
 *
 * httpOnly, so the token never reaches the client bundle or the RSC payload —
 * the same reasoning that keeps the password itself in FormData only. It is not
 * a session: it authorizes exactly one operation and is deleted the moment that
 * operation is attempted.
 */
export const RESET_TOKEN_COOKIE = "lms_rst";

/**
 * Resolves the current user from the session cookie.
 *
 * Wrapped in React `cache` so a page render that asks several times still makes
 * one request per render pass. Returns null rather than throwing so callers can
 * decide between redirecting and rendering a signed-out view.
 */
export const getSession = cache(async (): Promise<AuthUser | null> => {
  const cookieStore = await cookies();
  if (!cookieStore.get(ACCESS_COOKIE)) return null;

  try {
    const response = await fetch(`${env.API_BASE_URL}/api/v1/auth/me`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { user: AuthUser };
    return body.user;
  } catch {
    // API unreachable — treat as signed out rather than failing the render.
    return null;
  }
});

/**
 * The authorization boundary for protected pages.
 *
 * `proxy.ts` only checks that a cookie is present, which is a UX redirect and
 * not a security control — it cannot validate the token. This does, in the data
 * layer, which is where authorization belongs.
 */
export async function requireSession(): Promise<AuthUser> {
  const user = await getSession();
  if (!user) redirect("/signin");
  return user;
}
