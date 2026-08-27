"use server";

import { verifyOtpSchema } from "@lms/validation";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/lib/env";
import { RESET_TOKEN_COOKIE } from "../api/session";

export interface VerifyOtpState {
  errors?: {
    otp?: string[];
    orgCode?: string[];
    mobile?: string[];
  };
  /** Non-field error shown above the form. */
  message?: string;
}

const INVALID_CODE = "Invalid or expired verification code";
const SERVICE_UNAVAILABLE =
  "Password recovery is temporarily unavailable. Please try again shortly.";

/** Matches AUTH_RECOVERY_TOKEN_TTL_MINUTES; the API rejects it after that anyway. */
const RESET_TOKEN_MAX_AGE_SECONDS = 15 * 60;

/**
 * Step 2 — exchanges the recovery code for a single-use reset authorization.
 *
 * The token is stored in an httpOnly cookie rather than passed through the URL
 * or a hidden field: it authorizes a password change, so it must never be
 * readable by client JavaScript, land in browser history, or leak through a
 * Referer header.
 */
export async function verifyOtpAction(
  _previous: VerifyOtpState,
  formData: FormData,
): Promise<VerifyOtpState> {
  const parsed = verifyOtpSchema.safeParse({
    orgCode: formData.get("orgCode"),
    mobile: formData.get("mobile"),
    otp: formData.get("otp"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const response = await fetch(`${env.API_BASE_URL}/api/v1/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    });

    if (response.status === 401) {
      // Deliberately undifferentiated: a wrong code, an expired code, an
      // exhausted attempt count and an unknown account all land here, so the
      // response cannot be used to enumerate accounts (Scenarios 9, 10, 26).
      return { message: INVALID_CODE };
    }

    if (response.status === 429) {
      return {
        message: "Too many attempts. Please wait a minute and try again.",
      };
    }

    if (!response.ok) {
      return { message: SERVICE_UNAVAILABLE };
    }

    const body = (await response.json()) as { resetToken: string };

    const cookieStore = await cookies();
    cookieStore.set(RESET_TOKEN_COOKIE, body.resetToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: RESET_TOKEN_MAX_AGE_SECONDS,
    });
  } catch {
    return { message: SERVICE_UNAVAILABLE };
  }

  redirect("/reset-password");
}
