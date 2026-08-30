import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/lib/env";
import { refreshSession } from "@/lib/auth-refresh";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/features/auth/api/session";

/**
 * The server-side write layer every feature's `actions/` module is built on.
 *
 * Extracted from `features/organizations/actions/branch-actions.ts` when Module
 * 03 became the third feature to need it. The status-code vocabulary here is the
 * whole value: each code means something specific to a user, and a second copy is
 * where the meanings would drift apart.
 */

/**
 * Headers the API's CSRF guard requires on every mutating request.
 *
 * `Origin` is stated explicitly because this call originates from the Next.js
 * server, not a browser, so nothing sets one for us — and the guard blocks a
 * mutation that arrives without it.
 *
 * `X-LMS-Request` is the custom header half of the guard: a browser cannot set
 * it on a cross-origin request without a preflight the API refuses, so a forged
 * request cannot carry it. Its value is never read.
 *
 * Exported so any future mutating call site can spread it rather than
 * rediscovering the requirement from a 403.
 */
export const CSRF_HEADERS: Record<string, string> = {
  Origin: env.NEXT_PUBLIC_APP_URL,
  "X-LMS-Request": "1",
};

export const NOT_PERMITTED =
  "You do not have permission to perform that action.";
export const RATE_LIMITED =
  "Too many attempts. Please wait a moment and try again.";
export const NOT_REACHABLE = "That record is not available.";

/** The shape every form action returns to `useActionState`. */
export interface ActionState {
  message?: string;
  success?: string;
  errors?: Record<string, string[] | undefined>;
  /** Populated only when a delete was refused and the API named what blocks it. */
  blockedBy?: Array<{ entity: string; label: string; count: number }>;
  /**
   * `duplicateOf` is deliberately absent from this interface even though the
   * 409 handler forwards it. Customers and guarantors each report a different
   * shape, so each feature's own state type declares the one it renders and
   * casts `outcome.state` to it — see `CustomerFormState`. Declaring a union
   * here would force every consumer to handle fields that cannot occur on their
   * surface.
   */
}

export type ApiOutcome =
  | { kind: "ok"; body: unknown }
  | { kind: "session-ended" }
  | { kind: "failed"; state: ActionState };

/**
 * One request, with the status-code vocabulary applied once.
 *
 * A 409 is passed through with its body rather than flattened to a generic
 * message: it is how the API reports a duplicate code, a blocked deletion, a
 * protected system role and a last-administrator refusal, and in every case the
 * body says something the user needs to read.
 *
 * @param serviceName names the feature in the fallback message, so an outage
 *   reads as "Role Management is temporarily unavailable" rather than something
 *   generic the user cannot act on.
 */
/**
 * Renews the session in place, returning the cookie header to retry with.
 *
 * Returns null when the session cannot be renewed, which is the caller's signal
 * to end it. Safe to call from here — and only from here on the write path —
 * because a Server Action is a single request, so two of these never race for
 * the same rotated token.
 *
 * The read layer cannot use this: it runs during render, where `cookies().set`
 * throws. Reads are renewed in `proxy.ts` instead.
 */
async function renewSession(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
): Promise<string | null> {
  const fresh = await refreshSession(cookieStore.toString());
  // `"retry"` — the API could not answer — is handled the same as a refusal on
  // the write path. A Server Action cannot usefully continue without a token:
  // it would submit the write and be rejected. Ending here surfaces that as a
  // sign-out rather than a silently dropped mutation.
  if (fresh === null || fresh === "retry") return null;

  for (const cookie of fresh) {
    cookieStore.set(cookie.name, cookie.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookie.secure,
      // "/" on this origin, matching sign-in: the API scopes the refresh cookie
      // to its own auth path, but the browser must return it to any Next route.
      path: "/",
    });
  }

  return cookieStore.toString();
}

export async function call(
  path: string,
  init: {
    method: string;
    body?: unknown;
    /**
     * Sent as an `Idempotency-Key` header.
     *
     * A header rather than a body field because the operations that need one —
     * posting and reversing a journal (Module 14) — act on an entity that
     * already exists, so the key belongs to the *attempt* rather than to the
     * thing being created. Where the key belongs to the created record, as in a
     * collection, it stays a body field and this option is not used.
     *
     * The key must be minted once by the form and reused across retries. One
     * generated per request would defeat the mechanism it exists to serve.
     */
    idempotencyKey?: string;
  },
  serviceName: string,
): Promise<ApiOutcome> {
  const unavailable = `${serviceName} is temporarily unavailable. Please try again shortly.`;
  const cookieStore = await cookies();

  const send = (cookie: string) =>
    fetch(`${env.API_BASE_URL}/api/v1${path}`, {
      method: init.method,
      headers: {
        ...CSRF_HEADERS,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.idempotencyKey
          ? { "Idempotency-Key": init.idempotencyKey }
          : {}),
        cookie,
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      cache: "no-store",
    });

  try {
    let response = await send(cookieStore.toString());

    /**
     * A 401 usually means the 15-minute access token lapsed while the 7-day
     * refresh token is still good, so the session is renewed and the request
     * retried once. Only a refusal to renew ends the session.
     *
     * Exactly one retry, never a loop: the second 401 is authoritative, and
     * rotation means a retry storm would revoke the very token it is chasing.
     */
    if (response.status === 401) {
      const renewed = await renewSession(cookieStore);
      if (!renewed) return { kind: "session-ended" };

      response = await send(renewed);
      if (response.status === 401) return { kind: "session-ended" };
    }

    if (response.status === 403) {
      return { kind: "failed", state: { message: NOT_PERMITTED } };
    }
    if (response.status === 404) {
      return { kind: "failed", state: { message: NOT_REACHABLE } };
    }
    if (response.status === 429) {
      return { kind: "failed", state: { message: RATE_LIMITED } };
    }

    if (response.status === 409) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        blockedBy?: ActionState["blockedBy"];
        duplicateOf?: unknown[];
      } | null;

      return {
        kind: "failed",
        state: {
          message: body?.message ?? unavailable,
          blockedBy: body?.blockedBy,
          // Forwarded but not declared on `ActionState` — see the note there.
          ...(body?.duplicateOf ? { duplicateOf: body.duplicateOf } : {}),
        },
      };
    }

    if (response.status === 400) {
      // Nest's ValidationPipe returns `message` as an array of strings. The
      // client schema should have caught these already; surfacing the server's
      // wording is what makes a rule the client does not model still legible.
      const body = (await response.json().catch(() => null)) as {
        message?: string | string[];
        problems?: unknown[];
      } | null;
      const message = Array.isArray(body?.message)
        ? body.message[0]
        : body?.message;

      return {
        kind: "failed",
        state: {
          message: message ?? unavailable,
          // Forwarded but not declared on `ActionState`, like `duplicateOf`
          // above. The configuration import returns a per-entry list of what
          // cannot be applied; collapsing it to `message` would leave the
          // operator to find the bad entries by bisection.
          ...(body?.problems ? { problems: body.problems } : {}),
        },
      };
    }

    if (!response.ok) {
      return { kind: "failed", state: { message: unavailable } };
    }

    return { kind: "ok", body: await response.json().catch(() => null) };
  } catch {
    return { kind: "failed", state: { message: unavailable } };
  }
}

/**
 * The same request, carrying a file.
 *
 * A sibling of {@link call} rather than an option on it, because the two differ
 * in exactly one place — the body and its `Content-Type` — and bending `call` to
 * cover both would mean every JSON caller carries a branch it never takes.
 *
 * The `Content-Type` header is **deliberately not set**: `fetch` derives it from
 * the `FormData`, including the multipart boundary, and setting it by hand
 * produces a header with no boundary that the server cannot parse.
 *
 * Introduced for Module 04's KYC document upload, the first thing in the app
 * that sends bytes rather than JSON.
 */
export async function callMultipart(
  path: string,
  body: FormData,
  serviceName: string,
): Promise<ApiOutcome> {
  const unavailable = `${serviceName} is temporarily unavailable. Please try again shortly.`;
  const cookieStore = await cookies();

  const send = (cookie: string) =>
    fetch(`${env.API_BASE_URL}/api/v1${path}`, {
      method: "POST",
      // No Content-Type: `fetch` sets it with the multipart boundary itself.
      headers: { ...CSRF_HEADERS, cookie },
      body,
      cache: "no-store",
    });

  try {
    let response = await send(cookieStore.toString());

    /**
     * Renew and retry once, as `call` does.
     *
     * The same `FormData` is re-sent rather than rebuilt: `fetch` serialises it
     * per request, so the object stays readable after the first attempt. An
     * upload is also the case where this matters most — the alternative is
     * telling someone their file failed and asking them to pick it again.
     */
    if (response.status === 401) {
      const renewed = await renewSession(cookieStore);
      if (!renewed) return { kind: "session-ended" };

      response = await send(renewed);
      if (response.status === 401) return { kind: "session-ended" };
    }

    if (response.status === 403) {
      return { kind: "failed", state: { message: NOT_PERMITTED } };
    }
    if (response.status === 404) {
      return { kind: "failed", state: { message: NOT_REACHABLE } };
    }
    if (response.status === 429) {
      return { kind: "failed", state: { message: RATE_LIMITED } };
    }

    /**
     * 413 is specific to this path: Multer rejects an oversized upload before
     * the handler runs, so the service's own message never reaches the client.
     * Without this branch it would read as a generic outage, and the user would
     * retry the same too-large file.
     */
    if (response.status === 413) {
      return {
        kind: "failed",
        state: { message: "That file is too large. The maximum size is 5 MB." },
      };
    }

    if (response.status === 400 || response.status === 409) {
      const parsed = (await response.json().catch(() => null)) as {
        message?: string | string[];
      } | null;
      const message = Array.isArray(parsed?.message)
        ? parsed.message[0]
        : parsed?.message;

      return { kind: "failed", state: { message: message ?? unavailable } };
    }

    if (!response.ok) {
      return { kind: "failed", state: { message: unavailable } };
    }

    return { kind: "ok", body: await response.json().catch(() => null) };
  } catch {
    return { kind: "failed", state: { message: unavailable } };
  }
}

/**
 * Clears the session cookies and sends the caller to sign in.
 *
 * Called on a 401, which since Module 03 also covers an account deactivated
 * mid-session: authorization is re-resolved per request, so the very next action
 * after a deactivation lands here rather than continuing on a stale token.
 */
export async function endSession(): Promise<never> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_COOKIE);
  cookieStore.delete(REFRESH_COOKIE);
  redirect("/signin");
}
