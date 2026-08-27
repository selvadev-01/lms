import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RESET_TOKEN_COOKIE, ResetPasswordForm } from "@/features/auth";

export const metadata: Metadata = {
  title: "Reset Password",
};

/**
 * Step 3 route.
 *
 * Reaching this page without a reset authorization means the user arrived
 * directly, or their token expired, so they are sent back to start recovery
 * rather than shown a form whose every submission would be rejected.
 *
 * This is a UX guard, not the security boundary: the token is validated
 * server-side on submit, which is what actually enforces Scenarios 16-19.
 */
export default async function ResetPassword() {
  const cookieStore = await cookies();
  if (!cookieStore.get(RESET_TOKEN_COOKIE)) redirect("/forgot-password");

  return <ResetPasswordForm />;
}
