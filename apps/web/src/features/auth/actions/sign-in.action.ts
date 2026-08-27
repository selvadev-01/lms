"use server";

import type { AuthUser } from "@lms/types";
import { signInSchema } from "@lms/validation";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { parseSetCookies } from "@/lib/auth-refresh";
import { env } from "@/lib/env";
import { dashboardPathFor } from "../utils/dashboard-path";

export interface SignInState {
  errors?: {
    orgCode?: string[];
    mobile?: string[];
    password?: string[];
  };
  /** Non-field error shown above the form. */
  message?: string;
}

const GENERIC_FAILURE = "Invalid credentials";
const SERVICE_UNAVAILABLE = "Authentication service is temporarily unavailable";
const RATE_LIMITED =
  "Too many sign-in attempts. Please wait a minute and try again.";

/**
 * Handles sign-in submission.
 *
 * Implemented as a Server Action so the password is read from `FormData` on the
 * server: it never becomes React state, never enters the client bundle, and is
 * never serialised into the RSC payload (story rule 18 / Scenario 20).
 */
export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    orgCode: formData.get("orgCode"),
    mobile: formData.get("mobile"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    // Client-side validation is a convenience; this is the authoritative check.
    return { errors: parsed.error.flatten().fieldErrors };
  }

  let user: AuthUser;

  try {
    const response = await fetch(`${env.API_BASE_URL}/api/v1/auth/sign-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    });

    if (response.status === 401) {
      // Deliberately undifferentiated: invalid, inactive and locked accounts
      // all land here so the response cannot be used to enumerate accounts.
      return { message: GENERIC_FAILURE };
    }
    if (response.status === 429) {
      // Distinguished from a service failure because it is the one case the
      // user can act on: nothing is broken and their credentials are not in
      // question, they simply have to wait. Reporting it as "temporarily
      // unavailable" sends someone to check a status page over a limit that
      // clears itself in under a minute.
      //
      // Saying only that attempts were too frequent leaks nothing: the limit is
      // per IP rather than per account, so this says nothing about whether the
      // submitted mobile number exists.
      return { message: RATE_LIMITED };
    }
    if (!response.ok) {
      return { message: SERVICE_UNAVAILABLE };
    }

    // Re-emit the API's session cookies on this origin, so the browser holds
    // same-site httpOnly cookies and never talks to the API directly.
    const cookieStore = await cookies();
    for (const cookie of parseSetCookies(response.headers)) {
      // Path is deliberately "/" on this origin: the API scopes the refresh
      // cookie to its own /api/v1/auth path, but here the browser must send it
      // back to any Next route that may need to refresh the session.
      cookieStore.set(cookie.name, cookie.value, {
        httpOnly: true,
        sameSite: "lax",
        secure: cookie.secure,
        path: "/",
      });
    }

    const body = (await response.json()) as { user: AuthUser };
    user = body.user;
  } catch {
    // Network failure or API down (Scenarios 29 and 31) — fail safe, no session.
    return { message: SERVICE_UNAVAILABLE };
  }

  // Outside the try: redirect() signals by throwing, so a catch would swallow
  // it and the navigation would silently never happen.
  redirect(dashboardPathFor(user.roles));
}
