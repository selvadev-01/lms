import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { VerifyOtpForm, forgotPasswordSchema } from "@/features/auth";

export const metadata: Metadata = {
  title: "Verify Code",
};

/**
 * Step 2 route.
 *
 * The identifiers arrive as query params, so they are re-validated here rather
 * than trusted: a hand-typed or tampered URL must land back at step 1 instead
 * of rendering a form that can only fail.
 */
export default async function VerifyCode({
  searchParams,
}: {
  searchParams: Promise<{ orgCode?: string; mobile?: string }>;
}) {
  const params = await searchParams;
  const parsed = forgotPasswordSchema.safeParse({
    orgCode: params.orgCode,
    mobile: params.mobile,
  });

  if (!parsed.success) redirect("/forgot-password");

  return (
    <VerifyOtpForm orgCode={parsed.data.orgCode} mobile={parsed.data.mobile} />
  );
}
