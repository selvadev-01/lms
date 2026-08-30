import "server-only";

import type { AuthUser } from "@lms/types";
import { decodeJwt } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { env } from "@/lib/env";

export const ACCESS_COOKIE = "lms_at";
export const REFRESH_COOKIE = "lms_rt";

/**
 * Holds the single-use password-reset authorization between the verify step and
 * the reset form.
 *
 * httpOnly, so the token never reaches the client bundle or the RSC payload —
 * the same reasoning that keeps the password itself in FormData only. It is not
 * a session: it authorizes exactly one operation and is deleted the moment that
 * operation is attempted.
 */
export const RESET_TOKEN_COOKIE = "lms_rst";

/**
 * The API answered, but not about who the caller is — a 429 or a 5xx.
 *
 * Distinct from "signed out" on purpose: this must reach an error boundary so
 * the user can retry, never the sign-out path, which would end a valid session
 * over a rate limit.
 */
class TransientAuthError extends Error {
  /** `status` is 0 when the request never got an answer at all. */
  constructor(readonly status: number) {
    super(
      status === 0 ? "auth/me was unreachable" : `auth/me responded ${status}`,
    );
    this.name = "TransientAuthError";
  }
}

/**
 * Profiles already fetched, keyed by the exact access token they describe.
 *
 * # Why this cache exists
 *
 * `/auth/me` used to run on every render of every guarded page. React's
 * `cache()` deduplicates within a single render pass, but a *navigation* is a
 * new pass, so ordinary clicking spent one request per page — on top of the
 * nine the dashboard already spends — and hit the per-IP rate limit. The 429
 * then surfaced as "Loan Applications unavailable" or, before that, as a
 * redirect to sign-in.
 *
 * Next.js recommends verifying the session locally rather than calling an
 * endpoint per render. We cannot verify the signature here — the API's signing
 * secret must not be shared with the web tier — but we do not need to: the
 * token's own `exp` bounds how long its profile can be trusted, and the API
 * re-verifies the signature on every request it actually serves. So the profile
 * is fetched once per token and reused until that token changes or expires.
 *
 * # Why keying on the token is what makes it safe
 *
 * A cache keyed on the token cannot serve one user's profile to another: a
 * different session presents a different token and misses. Sign-out, refresh
 * rotation, and a permission change that reissues the token all produce a new
 * key, so none of them can be served stale.
 *
 * Module-scoped, so it is per server instance and never shared with the client.
 */
const profileCache = new Map<string, { user: AuthUser; expiresAt: number }>();

/** Bounds the map on a long-lived server; sessions rotate constantly. */
const MAX_CACHED_PROFILES = 500;

/**
 * When a token's cached profile stops being trusted.
 *
 * The earlier of the token's own expiry and a short ceiling. The ceiling is what
 * keeps a *permission change* from taking a full token lifetime to appear: the
 * API can revoke a permission without reissuing the token, and nothing would
 * otherwise tell us. Sixty seconds is the same order as the rate-limit window,
 * so it removes the per-render cost without letting authorization drift.
 *
 * This value is also the window in which a session revoked *elsewhere* — an
 * administrator ending it, a permission withdrawn — can still be served from
 * here, which is the real cost of caching at all. Sign-out is exempt: it clears
 * the entry directly via `forgetCachedSession`. The window grants nothing
 * either way, because the API re-validates every request it serves, so a
 * revoked session can see a stale page shell and load nothing behind it.
 */
const MAX_PROFILE_AGE_MS = 60_000;

function trustedUntil(token: string): number {
  const ceiling = Date.now() + MAX_PROFILE_AGE_MS;

  try {
    // `decodeJwt` reads the claims WITHOUT verifying the signature, which is
    // correct here and must stay that way: this value is only used to expire a
    // cache entry early. Nothing is authorized on the strength of it — the API
    // verifies the signature on every request it serves.
    const { exp } = decodeJwt(token);
    if (typeof exp !== "number") return ceiling;
    return Math.min(exp * 1000, ceiling);
  } catch {
    // Unparseable token. Cache nothing, and let the API reject it.
    return 0;
  }
}

/**
 * Resolves the current user from the session cookie.
 *
 * Wrapped in React `cache` so a page render that asks several times still makes
 * one request per render pass, and backed by `profileCache` so consecutive
 * *navigations* on the same token do not each cost a request. Returns null
 * rather than throwing so callers can decide between redirecting and rendering
 * a signed-out view.
 */
export const getSession = cache(async (): Promise<AuthUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value;
  if (!token) return null;

  const cached = profileCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  // Expired rather than absent: drop it so the map does not accumulate.
  if (cached) profileCache.delete(token);

  try {
    const response = await fetch(`${env.API_BASE_URL}/api/v1/auth/me`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });

    /**
     * Only an authentication failure means "signed out".
     *
     * This used to return null for every non-OK status, which made a 429 —
     * or any 5xx — indistinguishable from a rejected token, and
     * `requireSession` redirected the user to sign-in while their cookies
     * were present and perfectly valid.
     *
     * A throttled or broken API is not a statement about who the caller is,
     * so it must not be answered by ending their session. Throwing sends it
     * to the nearest error boundary, where a retry is possible; only 401 and
     * 403 fall through to the sign-out path below.
     */
    if (!response.ok && response.status !== 401 && response.status !== 403) {
      // Rethrown below rather than returned, so it cannot be mistaken for a
      // signed-out answer by the `catch`.
      throw new TransientAuthError(response.status);
    }
    if (!response.ok) {
      // The API refused this token. Make sure no earlier profile for it can be
      // served, then report the session as over.
      profileCache.delete(token);
      return null;
    }

    const body = (await response.json()) as { user: AuthUser };

    const expiresAt = trustedUntil(token);
    if (expiresAt > Date.now()) {
      // Cheapest eviction that keeps the map bounded: Map preserves insertion
      // order, so the first key is the oldest.
      if (profileCache.size >= MAX_CACHED_PROFILES) {
        const oldest = profileCache.keys().next().value;
        if (oldest !== undefined) profileCache.delete(oldest);
      }
      profileCache.set(token, { user: body.user, expiresAt });
    }

    return body.user;
  } catch (error) {
    if (error instanceof TransientAuthError) throw error;

    /**
     * The API is unreachable. That is the same class of fault as the 429 and
     * 5xx handled above — the API has said nothing about who the caller is —
     * so it gets the same answer, and for the same reason: signing a user out
     * over a restart of the API, and making them retype a password to recover,
     * is a worse outcome than an error page with a retry.
     *
     * This used to `return null`, which meant an outage signed everyone out
     * while `auth-refresh.ts` answered `"retry"` for the identical condition.
     */
    throw new TransientAuthError(0);
  }
});

/**
 * Drops a token's cached profile.
 *
 * Called wherever this server knows a session has ended — sign-out, and the two
 * revoke actions when the caller ended their *own* session.
 *
 * It cannot cover the case that matters most: an administrator revoking someone
 * else's session has no access to that person's token, which is this cache's
 * key, so their entry survives until it lapses. `MAX_PROFILE_AGE_MS` is what
 * bounds that, and the API refusing every request behind it is what makes the
 * window harmless.
 */
export function forgetCachedSession(token: string | undefined): void {
  if (token) profileCache.delete(token);
}

/**
 * The authorization boundary for protected pages.
 *
 * `proxy.ts` only checks that a cookie is present, which is a UX redirect and
 * not a security control — it cannot validate the token. This does, in the data
 * layer, which is where authorization belongs.
 */
export async function requireSession(): Promise<AuthUser> {
  const user = await getSession();
  if (!user) redirect("/signin");
  return user;
}
