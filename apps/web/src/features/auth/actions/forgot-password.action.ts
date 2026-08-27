"use server";

import { forgotPasswordSchema } from "@lms/validation";
import { redirect } from "next/navigation";

import { env } from "@/lib/env";

export interface ForgotPasswordState {
  errors?: {
    orgCode?: string[];
    mobile?: string[];
  };
  /** Non-field error shown above the form. */
  message?: string;
}

const SERVICE_UNAVAILABLE =
  "Password recovery is temporarily unavailable. Please try again shortly.";

/**
 * Step 1 — requests a password-recovery code.
 *
 * On success this always advances to the verify screen, whatever the API found.
 * That is the point: the API answers 202 for an unknown mobile number exactly as
 * it does for a real one, and if this action branched on the outcome the UI
 * would reintroduce the account-enumeration oracle the API was careful to avoid
 * (Forgot Password Scenarios 8, 22).
 *
 * The mobile and organization code travel on to the next step in the URL. They
 * are not secrets — the user just typed them — and the OTP itself never appears
 * in a query string.
 */
export async function forgotPasswordAction(
  _previous: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = forgotPasswordSchema.safeParse({
    orgCode: formData.get("orgCode"),
    mobile: formData.get("mobile"),
  });

  if (!parsed.success) {
    // Client-side validation is a convenience; this is the authoritative check.
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const response = await fetch(
      `${env.API_BASE_URL}/api/v1/auth/forgot-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      },
    );

    // 429 is the one case worth surfacing: silently advancing would leave the
    // user waiting for a code that was deliberately not sent (Scenario 21).
    if (response.status === 429) {
      return {
        message:
          "Too many recovery requests. Please wait a minute and try again.",
      };
    }

    if (!response.ok) {
      return { message: SERVICE_UNAVAILABLE };
    }
  } catch {
    // Network failure or API down (Scenario 31) — never claim a code was sent.
    return { message: SERVICE_UNAVAILABLE };
  }

  const query = new URLSearchParams({
    orgCode: parsed.data.orgCode,
    mobile: parsed.data.mobile,
  });

  // Outside the try: redirect() signals by throwing, so a catch would swallow
  // it and the navigation would silently never happen.
  redirect(`/forgot-password/verify?${query.toString()}`);
}
