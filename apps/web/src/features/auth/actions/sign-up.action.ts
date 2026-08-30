"use server";

import { signUpSchema } from "@lms/validation";
import { redirect } from "next/navigation";

import { env } from "@/lib/env";

export interface SignUpState {
  errors?: {
    orgName?: string[];
    orgCode?: string[];
    adminName?: string[];
    adminMobile?: string[];
    password?: string[];
    confirmPassword?: string[];
  };
  /** Non-field error shown above the form. */
  message?: string;
}

const SERVICE_UNAVAILABLE = "Signup service is temporarily unavailable";
const SIGNUP_DISABLED = "Signup is not available.";
const RATE_LIMITED =
  "Too many signup attempts. Please wait a minute and try again.";

/**
 * Handles organization signup submission.
 *
 * A Server Action for the same reason sign-in is one: the password is read from
 * `FormData` on the server, so it never becomes React state, never enters the
 * client bundle, and is never serialised into the RSC payload.
 *
 * On success this redirects to sign-in rather than establishing a session. The
 * endpoint deliberately sets no cookies — see `SignUpService` for why coupling
 * provisioning to session creation would give a successful signup a second way
 * to look like a failure.
 */
export async function signUpAction(
  _previous: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const parsed = signUpSchema.safeParse({
    orgName: formData.get("orgName"),
    orgCode: formData.get("orgCode"),
    adminName: formData.get("adminName"),
    adminMobile: formData.get("adminMobile"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    // Client-side validation is a convenience; this is the authoritative check.
    return { errors: parsed.error.flatten().fieldErrors };
  }

  let orgCode: string;

  try {
    const response = await fetch(`${env.API_BASE_URL}/api/v1/auth/sign-up`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `confirmPassword` is dropped: it is a typo-catcher for the person
      // typing, and the API has no such field.
      body: JSON.stringify({
        orgName: parsed.data.orgName,
        orgCode: parsed.data.orgCode,
        adminName: parsed.data.adminName,
        adminMobile: parsed.data.adminMobile,
        password: parsed.data.password,
      }),
      cache: "no-store",
    });

    if (response.status === 404) {
      // Public signup is switched off in this deployment. The API returns 404
      // rather than 403 so the endpoint is indistinguishable from one that was
      // never built.
      return { message: SIGNUP_DISABLED };
    }
    if (response.status === 409) {
      // Reported against the field rather than as a banner: the organization
      // code is taken, and that is fixable in one input without leaving it.
      return {
        errors: {
          orgCode: ["That organization code is already taken."],
        },
      };
    }
    if (response.status === 400) {
      // The password policy rejected it. The API returns its reasons as a
      // message array, which belong on the password field.
      const body = (await response.json().catch(() => null)) as {
        message?: string | string[];
      } | null;
      const reasons = Array.isArray(body?.message)
        ? body.message
        : body?.message
          ? [body.message]
          : ["Choose a stronger password."];
      return { errors: { password: reasons } };
    }
    if (response.status === 429) {
      // Distinguished from a service failure for the same reason sign-in
      // distinguishes it: nothing is broken, and the limit clears itself.
      return { message: RATE_LIMITED };
    }
    if (!response.ok) {
      return { message: SERVICE_UNAVAILABLE };
    }

    const body = (await response.json()) as { orgCode: string };
    orgCode = body.orgCode;
  } catch {
    return { message: SERVICE_UNAVAILABLE };
  }

  // Outside the try: redirect() signals by throwing, so a catch would swallow
  // it and the navigation would silently never happen.
  //
  // The code is canonical (uppercased by the API), so pre-filling it saves the
  // new administrator from guessing which casing was stored.
  redirect(`/signin?orgCode=${encodeURIComponent(orgCode)}`);
}
