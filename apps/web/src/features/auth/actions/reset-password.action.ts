"use server";

import { resetPasswordSchema } from "@lms/validation";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/lib/env";
import { RESET_TOKEN_COOKIE } from "../api/session";

export interface ResetPasswordState {
  errors?: {
    password?: string[];
    confirmPassword?: string[];
  };
  /** Non-field error shown above the form. */
  message?: string;
}

const EXPIRED =
  "This password reset request is no longer valid. Please start again.";
const SERVICE_UNAVAILABLE =
  "Password recovery is temporarily unavailable. Please try again shortly.";

/**
 * Extracts the policy messages from a 400 response.
 *
 * Nest serialises validation failures as `message: string | string[]`, and a
 * proxy or gateway could return something else entirely, so every shape is
 * narrowed rather than trusted. An unparseable body yields no messages and the
 * caller falls back to the generic banner.
 */
async function readPolicyMessages(response: Response): Promise<string[]> {
  try {
    const body: unknown = await response.json();

    if (typeof body !== "object" || body === null) return [];
    const message = (body as { message?: unknown }).message;

    if (typeof message === "string") return [message];
    if (Array.isArray(message)) {
      return message.filter((item): item is string => typeof item === "string");
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Step 3 — establishes the new password.
 *
 * Implemented as a Server Action so the password is read from `FormData` on the
 * server: it never becomes React state, never enters the client bundle, and is
 * never serialised into the RSC payload.
 *
 * The account is identified solely by the reset cookie. Nothing the form
 * submits says whose password this is, so a tampered field cannot retarget the
 * reset at another account (Scenario 19).
 */
export async function resetPasswordAction(
  _previous: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const cookieStore = await cookies();
  const resetToken = cookieStore.get(RESET_TOKEN_COOKIE)?.value;

  if (!resetToken) {
    return { message: EXPIRED };
  }

  try {
    const response = await fetch(
      `${env.API_BASE_URL}/api/v1/auth/reset-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // confirmPassword is a UI-only guard and is deliberately not sent.
        body: JSON.stringify({ resetToken, password: parsed.data.password }),
        cache: "no-store",
      },
    );

    if (response.status === 401) {
      // Consumed, expired or unknown authorization. The cookie is useless now,
      // so clear it rather than let the user retry against a dead token.
      cookieStore.delete(RESET_TOKEN_COOKIE);
      return { message: EXPIRED };
    }

    /**
     * 400 means the authorization was fine but the password was not — it broke
     * the policy, or repeated a recent one. The reset token is deliberately
     * left in place: the API does not consume it on a policy rejection, so the
     * user can correct the password and submit again rather than restarting
     * recovery (Reset Password Scenarios 10-13).
     */
    if (response.status === 400) {
      const messages = await readPolicyMessages(response);
      return messages.length > 0
        ? { errors: { password: messages } }
        : { message: SERVICE_UNAVAILABLE };
    }

    if (!response.ok) {
      return { message: SERVICE_UNAVAILABLE };
    }

    // Single-use: dropped as soon as it has been spent (Scenario 42).
    cookieStore.delete(RESET_TOKEN_COOKIE);
  } catch {
    return { message: SERVICE_UNAVAILABLE };
  }

  /**
   * No session is issued. The API revoked every existing session when the
   * password changed, and the user must sign in again with the new credential
   * before any protected route is reachable (Scenario 28).
   */
  redirect("/reset-password/done");
}
