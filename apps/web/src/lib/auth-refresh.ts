import "server-only";

import { env } from "@/lib/env";

/**
 * Silent session renewal.
 *
 * The API issues a 15-minute access token alongside a 7-day refresh token, and
 * enforces a 30-minute idle window on top of both. Without this module the web
 * used only the access token, so a working user was signed out every 15 minutes
 * while a valid 7-day credential sat unused in their cookie jar — the three
 * settings disagreed, and the shortest one won by accident.
 *
 * # Why this returns cookies instead of setting them
 *
 * The two callers cannot write cookies the same way, and neither way works in
 * the other's context:
 *
 * - `lib/api-call.ts` runs inside Server Actions, where `cookies().set` is legal.
 * - The read layer (`lib/api-fetch.ts`) runs during *render*, where the same
 *   call throws "Cookies can only be modified in a Server Action or Route
 *   Handler". Renewal for reads therefore happens in `proxy.ts`, which writes
 *   through `NextResponse.cookies`.
 *
 * Returning the parsed cookies lets one implementation serve both. A helper
 * that wrote them itself would work on writes and fail on every read.
 *
 * # Rotation
 *
 * The API rotates on every refresh: the presented token is revoked and replaced,
 * so a token that refreshes twice is refused the second time. That is deliberate
 * replay protection, but it means concurrent refreshes race — one wins and the
 * losers are left holding a revoked token. Callers must refresh at most once per
 * navigation, never once per API call.
 */

export interface CookieToSet {
  name: string;
  value: string;
  secure: boolean;
}

/**
 * Reads `Set-Cookie` headers into the parts Next needs to re-emit them.
 *
 * Only the name, value and `Secure` flag are carried over. `httpOnly`,
 * `sameSite` and `path` are set by the caller rather than copied, because the
 * API's own values are wrong for this origin: it scopes the refresh cookie to
 * `/api/v1/auth`, whereas the browser must send it back to any Next route.
 */
export function parseSetCookies(headers: Headers): CookieToSet[] {
  const parsed: CookieToSet[] = [];

  for (const raw of headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const separator = pair.indexOf("=");
    if (separator === -1) continue;

    parsed.push({
      name: pair.slice(0, separator).trim(),
      value: pair.slice(separator + 1).trim(),
      /**
       * In production `Secure` is asserted, not inherited.
       *
       * Copying the API's flag means a misconfigured API — one not setting
       * `Secure` because it believes it is behind plain HTTP — silently makes
       * the web tier emit a session cookie that will travel unencrypted. The
       * API's belief about its own transport is not evidence about ours.
       *
       * Outside production the API's value still decides, so local development
       * over http://localhost keeps working.
       */
      secure:
        process.env.NODE_ENV === "production" ||
        raw.toLowerCase().includes("secure"),
    });
  }

  return parsed;
}

/**
 * What a renewal attempt concluded.
 *
 * The three arms are deliberately distinct. Collapsing `"retry"` into `null` is
 * what let a rate limit sign a working user out.
 */
export type RefreshOutcome =
  /** Renewed. Set these cookies. */
  | CookieToSet[]
  /** The API refused the session. End it. */
  | null
  /** The API could not answer. Leave the cookies alone and carry on. */
  | "retry";

/**
 * Exchanges the refresh cookie for a new session, without persisting anything.
 *
 * Returns the cookies to set, `null` when the API refused the session — revoked,
 * idle-expired, or past its absolute lifetime — and `"retry"` when the API could
 * not answer at all. Only `null` means the caller must end the session.
 *
 * The decision is entirely the API's. This cannot extend a session the server
 * considers over, which is what keeps the idle and absolute policies intact.
 */
export async function refreshSession(
  cookieHeader: string,
): Promise<RefreshOutcome> {
  if (!cookieHeader) return null;

  try {
    const response = await fetch(`${env.API_BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });

    /**
     * A rate-limited or broken API has not said the session is over.
     *
     * Returning null here signed the user out on a 429, which `proxy.ts` then
     * turned into a redirect to sign-in while a valid refresh token sat in the
     * cookie jar. Only the API's own refusal — 401 or 403 — ends a session;
     * anything else leaves the cookies alone so the next navigation can retry.
     */
    if (!response.ok && response.status !== 401 && response.status !== 403) {
      return "retry";
    }
    if (!response.ok) return null;

    const cookies = parseSetCookies(response.headers);
    // A 200 that carried no cookies would leave the caller believing the session
    // was renewed while the browser still holds the expired one.
    return cookies.length > 0 ? cookies : null;
  } catch {
    // API unreachable. Not a statement about the session, so the cookies are
    // left alone — the caller carries on and the next navigation retries.
    // Nothing is granted by this: the access token is still absent, so every
    // read still fails closed until the API answers again.
    return "retry";
  }
}
