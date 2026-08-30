import "server-only";

import { cookies } from "next/headers";

import { env } from "@/lib/env";

/**
 * The server-side read layer every feature's `api/` module is built on.
 *
 * Server-only and cookie-forwarding: the browser never calls the API directly,
 * so session cookies stay same-site and the access token is never exposed to
 * client JavaScript.
 *
 * Extracted from `features/organizations/api/organizations.ts` when Module 03
 * became the third feature to need it. Three copies of a status-code mapping is
 * three places for it to drift, and the mapping is not incidental — the
 * difference between "unauthenticated", "forbidden" and "error" decides whether
 * the user is redirected, told they lack permission, or shown a retry.
 */

export type FetchFailure =
  { status: "unauthenticated" } | { status: "forbidden" } | { status: "error" };

export type FetchResult<T> = { status: "ok"; data: T } | FetchFailure;

/**
 * A GET returning a discriminated result rather than throwing or defaulting.
 *
 * Deliberately never returns an empty list on failure. An empty list and an
 * unreachable API look identical once both render as "no rows", but "this
 * organization has no branches" is a different claim from "we could not load
 * your branches" — and only one of them is ever true.
 */
export async function apiGet<T>(path: string): Promise<FetchResult<T>> {
  const cookieStore = await cookies();

  try {
    const response = await fetch(`${env.API_BASE_URL}/api/v1${path}`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });

    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status === 403) return { status: "forbidden" };
    if (!response.ok) {
      // Logged because the caller cannot: `FetchFailure` deliberately carries
      // no status, so every read failure reaches the screen as one
      // indistinguishable "could not load" message. Without this line a 429 and
      // a 500 look identical from the outside, and the only way to tell them
      // apart is to reproduce the request by hand.
      logFailure(path, String(response.status));
      return { status: "error" };
    }

    return { status: "ok", data: (await response.json()) as T };
  } catch (error) {
    logFailure(path, error instanceof Error ? error.message : "unknown");
    return { status: "error" };
  }
}

/**
 * Records why a read failed, on the server only.
 *
 * The message is never returned to the caller: which upstream status a read hit
 * is operational detail, and letting it reach the screen would describe this
 * system's internals to whoever triggered the fault.
 */
function logFailure(path: string, reason: string): void {
  console.error(`[api-fetch] GET ${path} failed: ${reason}`);
}

/**
 * A single-record GET, where "out of scope" and "absent" must be indistinguishable.
 *
 * The API answers 403 for a record outside the caller's scope and 404 for one
 * that does not exist, and this collapses both to `not-found`. That is not
 * information loss — it is the point. Rendering them differently would let a
 * Branch Admin enumerate the organization's records by watching which ids say
 * "forbidden" rather than "not found", which is exactly what the API's own
 * single opaque message prevents on its side.
 */
export type RecordResult<T> =
  { status: "ok"; data: T } | { status: "not-found" } | FetchFailure;

export async function apiGetRecord<T>(path: string): Promise<RecordResult<T>> {
  const cookieStore = await cookies();

  try {
    const response = await fetch(`${env.API_BASE_URL}/api/v1${path}`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });

    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status === 404) return { status: "not-found" };
    if (response.status === 403) return { status: "not-found" };
    if (!response.ok) {
      // As in `apiGet`. Note this one also collapses 403 into "not-found" on
      // purpose, to deny enumeration — so the log is the only place that
      // distinction survives at all.
      logFailure(path, String(response.status));
      return { status: "error" };
    }

    return { status: "ok", data: (await response.json()) as T };
  } catch (error) {
    logFailure(path, error instanceof Error ? error.message : "unknown");
    return { status: "error" };
  }
}
