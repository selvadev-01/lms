"use server";

import { changePasswordSchema } from "@lms/validation";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CSRF_HEADERS } from "@/lib/api-call";
import { env } from "@/lib/env";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../api/session";

export interface ChangePasswordState {
  errors?: {
    currentPassword?: string[];
    newPassword?: string[];
    confirmNewPassword?: string[];
  };
  /** Non-field error shown above the form. */
  message?: string;
}

const INCORRECT_CURRENT = "Your current password is incorrect";
const RATE_LIMITED = "Too many attempts. Please wait a moment and try again.";
const SERVICE_UNAVAILABLE =
  "Password change is temporarily unavailable. Please try again shortly.";

/**
 * Extracts the policy messages from a 400 response.
 *
 * Nest serialises validation failures as `message: string | string[]`, and a
 * proxy or gateway could return something else entirely, so every shape is
 * narrowed rather than trusted. An unparseable body yields no messages and the
 * caller falls back to the generic banner.
 *
 * Duplicated from reset-password.action.ts rather than shared: at two call
 * sites each copy stays readable on its own. Hoist it if a third appears.
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
 * Changes the signed-in user's password.
 *
 * A Server Action so all three passwords are read from `FormData` on the
 * server: they never become React state, never enter the client bundle, and are
 * never serialised into the RSC payload.
 *
 * Nothing the form submits says whose password this is. The API identifies the
 * account from the session cookie forwarded below, so a tampered field cannot
 * retarget the change at someone else (Scenario 29).
 */
export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmNewPassword: formData.get("confirmNewPassword"),
  });

  /**
   * Scenarios 4, 5, 6 and 11 end here, with no request made at all — which is
   * precisely what "no password verification is completed" means in Scenario 4.
   * Scenario 15 is also caught here, and again server-side as password reuse.
   */
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const cookieStore = await cookies();

  try {
    const response = await fetch(
      `${env.API_BASE_URL}/api/v1/auth/change-password`,
      {
        method: "POST",
        headers: {
          ...CSRF_HEADERS,
          "Content-Type": "application/json",
          // Forwarding the session cookie IS the authentication: the API's
          // JwtAuthGuard reads the access token from it.
          cookie: cookieStore.toString(),
        },
        // confirmNewPassword is a UI-only guard and is deliberately not sent —
        // the DTO does not accept it, and the API rejects unknown fields.
        body: JSON.stringify({
          currentPassword: parsed.data.currentPassword,
          newPassword: parsed.data.newPassword,
        }),
        cache: "no-store",
      },
    );

    /**
     * 401 covers a wrong current password (Scenario 8), an account that was
     * deactivated or locked mid-session (Scenarios 21, 22), and a session that
     * has since died. They are not distinguishable from the response, so the
     * message names the overwhelmingly common cause and attaches it to the
     * field the user would have to fix. In the other two cases the next
     * navigation redirects to sign-in anyway, via requireSession.
     */
    if (response.status === 401) {
      return { errors: { currentPassword: [INCORRECT_CURRENT] } };
    }

    /**
     * 400 means the session was fine but the new password was not — it broke
     * the policy, repeated a recent one, or matched the current one
     * (Scenarios 12-16). Nothing has changed, so the user corrects the field
     * and submits again.
     */
    if (response.status === 400) {
      const messages = await readPolicyMessages(response);
      return messages.length > 0
        ? { errors: { newPassword: messages } }
        : { message: SERVICE_UNAVAILABLE };
    }

    // Scenario 9: the configured rate-limiting policy has engaged.
    if (response.status === 429) {
      return { message: RATE_LIMITED };
    }

    // Scenarios 32 and 33 as the user experiences them: a controlled failure,
    // with the existing password left untouched.
    if (!response.ok) {
      return { message: SERVICE_UNAVAILABLE };
    }

    /**
     * The change committed and the API revoked every session, including this
     * one. The API also cleared its cookies, but that response was addressed to
     * this Server Action rather than to the browser and nothing re-emits it
     * (unlike sign-in, which forwards Set-Cookie deliberately) — so the local
     * copies are dropped here, as sign-out does. Without this the browser would
     * keep an access cookie whose session row is revoked: the proxy would admit
     * the request, requireSession would then reject it, and the user would take
     * a confusing double hop to sign-in.
     */
    cookieStore.delete(ACCESS_COOKIE);
    cookieStore.delete(REFRESH_COOKIE);
  } catch {
    return { message: SERVICE_UNAVAILABLE };
  }

  /**
   * Outside the try: redirect() signals by throwing, so catching it here would
   * swallow the navigation and surface it as a generic failure banner instead.
   */
  redirect("/change-password-done");
}
