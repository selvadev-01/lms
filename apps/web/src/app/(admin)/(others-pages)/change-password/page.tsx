import type { Metadata } from "next";

import { ChangePasswordForm, requireSession } from "@/features/auth";

export const metadata: Metadata = {
  title: "Change Password",
};

/**
 * Profile / Account Security → Change Password.
 *
 * `requireSession()` is the authorization boundary, not the proxy: the proxy
 * only checks that a session cookie is present, which is a UX redirect. This
 * validates the session against the API and sends an unauthenticated caller to
 * sign-in (Scenario 2).
 *
 * The result is intentionally not bound. The form needs nothing about the user
 * — no password value is ever pre-populated (Scenario 1) — but the call is what
 * protects the route and must not be dropped as "unused".
 */
export default async function ChangePasswordPage() {
  await requireSession();

  return <ChangePasswordForm />;
}
