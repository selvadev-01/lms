import "server-only";

import { redirect } from "next/navigation";

import { requireSession } from "../api/session";
import type { AuthUser } from "@lms/types";

/**
 * Requires the caller to hold every listed permission, or sends them away.
 *
 * The web mirror of the API's `@RequirePermissions()` decorator, and — like the
 * sidebar's link-hiding — a UX measure rather than the security boundary. The
 * API re-checks every permission on every request, because a page guard only
 * governs what the browser is shown, not what the server will do. This exists
 * so a user without the permission gets their dashboard instead of a screen
 * that renders and then fails on every action.
 *
 * Redirects to `/` rather than `/signin`: the caller is authenticated, just not
 * authorized, and bouncing them to a sign-in form they have already completed
 * would suggest their credentials were the problem.
 */
export async function requirePermissions(
  ...codes: string[]
): Promise<AuthUser> {
  const user = await requireSession();

  const missing = codes.filter((code) => !user.permissions.includes(code));

  if (missing.length > 0) {
    redirect("/");
  }

  return user;
}

/**
 * Whether the caller holds every listed permission.
 *
 * For deciding what to render inside a page the caller may legitimately open —
 * a Branch Admin reaches Branch Management but must not be shown a Delete
 * button. Returns a boolean rather than redirecting, because the answer here is
 * "hide the control", not "you should not be here".
 */
export function hasPermissions(
  user: Pick<AuthUser, "permissions">,
  ...codes: string[]
): boolean {
  return codes.every((code) => user.permissions.includes(code));
}
