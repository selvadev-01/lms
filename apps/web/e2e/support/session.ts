import {
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

/**
 * Shared test-session plumbing for the Module 03 specs.
 *
 * Browser sessions come from `auth.setup.ts`, which signs in once per role and
 * writes a `storageState` file that Playwright loads before a page ever
 * navigates. Two constraints forced that design and are worth stating, because
 * both look like flakiness if you meet them without knowing:
 *
 * - Refresh-token rotation revokes the previous session on every refresh, so a
 *   set of cookies genuinely cannot be shared between browser contexts. That is
 *   the behaviour that makes a stolen refresh token useless, and a test helper
 *   must not assume it is off.
 *
 * - Sign-in is rate limited per IP, so authenticating per test does not scale to
 *   a suite of this size.
 *
 * What remains here is the API-side half: a cached client for the direct-call
 * assertions and the fixture setup and teardown, which do not need a browser.
 */

export const SEED_PASSWORD = "Kestrel7Vault";
export const ORG_CODE = "DEMO";
export const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3001";

/**
 * The origin the API's CSRF guard accepts, and the custom header it requires.
 *
 * Every direct-to-API mutation in the suite must carry both — the guard refuses
 * a mutating request without them, and it does so with 403 before the handler
 * runs, which a test asserting some *other* refusal will happily mistake for
 * the rule it meant to exercise.
 *
 * Exported so a spec that builds its own request rather than using `apiAs` can
 * spread it instead of rediscovering the requirement from a puzzling 403.
 */
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

export const CSRF_HEADERS: Record<string, string> = {
  Origin: WEB_ORIGIN,
  "X-LMS-Request": "1",
};

/** Where `auth.setup.ts` writes each role's signed-in browser state. */
export const STORAGE_STATE = {
  superAdmin: "e2e/.auth/super-admin.json",
  branchAdmin: "e2e/.auth/branch-admin.json",
  target: "e2e/.auth/target-user.json",
} as const;

/** Cookies per mobile, minted once and replayed for the rest of the run. */
const sessions = new Map<string, Array<{ name: string; value: string }>>();

interface SignInResult {
  ok: boolean;
  status: number;
  cookies: Array<{ name: string; value: string }>;
}

/**
 * Authenticates against the API directly, waiting out a 429 once.
 *
 * Used to mint a session rather than to test the login form — `auth.spec.ts`
 * owns that. Going through the API avoids a page load per sign-in and keeps the
 * cookie extraction in one place.
 */
async function authenticate(
  request: APIRequestContext,
  mobile: string,
): Promise<SignInResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request.post(`${API_BASE}/api/v1/auth/sign-in`, {
      data: { orgCode: ORG_CODE, mobile, password: SEED_PASSWORD },
    });

    if (response.ok()) {
      const cookies = response
        .headersArray()
        .filter((header) => header.name.toLowerCase() === "set-cookie")
        .map((header) => {
          const [pair] = header.value.split(";");
          const separator = pair.indexOf("=");
          return {
            name: pair.slice(0, separator).trim(),
            value: pair.slice(separator + 1).trim(),
          };
        })
        .filter((cookie) => cookie.name.startsWith("lms_"));

      return { ok: true, status: response.status(), cookies };
    }

    if (response.status() !== 429) {
      return { ok: false, status: response.status(), cookies: [] };
    }

    await new Promise((resolve) => setTimeout(resolve, 61_000));
  }

  return { ok: false, status: 429, cookies: [] };
}

/**
 * The cookies for an account, minted on first use and cached thereafter.
 *
 * Cached across tests within a worker, which is what keeps the whole suite
 * inside the rate limit.
 *
 * The cache is re-minted rather than held forever, for two reasons that both
 * showed up in practice: an access token lives 15 minutes, and the users spec
 * deactivates an account mid-run, which revokes its sessions. A stale entry does
 * not fail loudly — the page simply redirects to /signin and the test times out
 * looking for a control that is no longer on screen — so `refreshSession` exists
 * to make the recovery explicit rather than mysterious.
 */
async function sessionCookies(
  request: APIRequestContext,
  mobile: string,
): Promise<Array<{ name: string; value: string }>> {
  const cached = sessions.get(mobile);
  if (cached) return cached;

  const result = await authenticate(request, mobile);
  expect(
    result.ok,
    `could not sign in as ${mobile} (HTTP ${result.status})`,
  ).toBe(true);

  sessions.set(mobile, result.cookies);
  return result.cookies;
}

/**
 * The cached session as a `Cookie` header, for direct API calls.
 *
 * Sent explicitly rather than relying on the `request` fixture's own jar:
 * Playwright hands each test a fresh fixture with an empty jar, so authenticating
 * through it would sign in once per test and put the suite straight back over the
 * rate limit — the exact problem this module exists to solve. `storageState` does
 * not help either, since the fixture is created before the test body runs.
 *
 * Usage: `request.get(url, { headers: { cookie: await cookieHeader(...) } })`.
 */
export async function cookieHeader(
  request: APIRequestContext,
  mobile: string,
): Promise<string> {
  const cookies = await sessionCookies(request, mobile);
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/** A thin authenticated client over the API, carrying the replayed session. */
export interface ApiClient {
  get(path: string): Promise<APIResponse>;
  /**
   * `headers` was added for Module 14, whose journal post and reverse endpoints
   * take their `Idempotency-Key` as a header rather than a body field — the key
   * there belongs to the *attempt* against an entity that already exists, not
   * to a record being created. Modules 09 and 11 keep passing theirs in the
   * body, where it belongs to the row.
   */
  post(
    path: string,
    data?: unknown,
    headers?: Record<string, string>,
  ): Promise<APIResponse>;
  put(path: string, data?: unknown): Promise<APIResponse>;
  /** Partial edit. Added for Module 04, whose customer update is a PATCH. */
  patch(path: string, data?: unknown): Promise<APIResponse>;
  delete(path: string): Promise<APIResponse>;
}

/**
 * An API client signed in as `mobile`, for the assertions that must bypass the
 * UI — direct-call refusals, and the fixture setup and teardown.
 *
 * Paths are relative to `/api/v1`, so a caller writes `/roles` rather than
 * repeating the base URL on every line.
 */
export async function apiAs(
  request: APIRequestContext,
  mobile: string,
): Promise<ApiClient> {
  const cookie = await cookieHeader(request, mobile);
  const url = (path: string) => `${API_BASE}/api/v1${path}`;

  /**
   * What the API's CSRF guard requires on a mutating request.
   *
   * This client speaks to the API directly rather than through the web tier, so
   * nothing sets these for it — and without them every mutation here is refused
   * with 403 before it reaches the handler, which reads as the endpoint
   * rejecting the payload rather than as the request never arriving.
   *
   * A test asserting a *refusal* is the trap: `expect(status).toBe(400)` sees
   * 403 and reports a validation rule that was never actually exercised.
   */
  const csrf = CSRF_HEADERS;

  return {
    get: (path) => request.get(url(path), { headers: { cookie } }),
    post: (path, data, headers) =>
      request.post(url(path), {
        headers: { cookie, ...csrf, ...headers },
        data: data ?? {},
      }),
    put: (path, data) =>
      request.put(url(path), {
        headers: { cookie, ...csrf },
        data: data ?? {},
      }),
    patch: (path, data) =>
      request.patch(url(path), {
        headers: { cookie, ...csrf },
        data: data ?? {},
      }),
    delete: (path) =>
      request.delete(url(path), { headers: { cookie, ...csrf } }),
  };
}

/** A real PNG header — the upload endpoint sniffs content, not the filename. */
export function pngBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(256, 9),
  ]);
}

/**
 * Runs a request, waiting out the rate limiter if it trips.
 *
 * The same reasoning as `attachRequiredDocuments` below, generalized. The specs
 * in the `rbac` group share one serial group and therefore one rate limiter,
 * and between them they drive more than twenty full application lifecycles —
 * every step of which re-reads the application for its current version. Reads
 * are capped at 60 a minute and the mutating routes at 10-20, so a full run
 * brushes those ceilings and which spec happens to hit one depends only on
 * ordering.
 *
 * Adding Module 09's spec to the group is what made this shared rather than
 * local: `approval-workflow.spec.ts` and `loan-applications.spec.ts` each began
 * failing on a bare `expect(response.ok()).toBe(true)` whose message was just
 * `false`, with no indication that a 429 was the cause.
 *
 * # Why two windows rather than one
 *
 * This waited out exactly one window until Module 15 joined the group. That was
 * calibrated when three loan specs shared the budget; with a fourth spec
 * drawing on it, a request could trip the limiter, wait its window, and arrive
 * in a *second* saturated window — so the single retry returned the 429 to the
 * caller and the assertion failed on a status nobody was asserting about.
 *
 * The symptom was three tests failing once per full run and passing in
 * isolation, in whichever specs happened to be running when the ceiling was
 * reached: `accounting.spec.ts`, `loan-applications.spec.ts` and
 * `overdue-recovery.spec.ts`.
 *
 * Two attempts, not a loop. A loop would turn a genuine stall — an API that has
 * stopped answering — into a slow green, which is the failure mode this helper
 * must not have. Two bounds the wait at ~122s and still surfaces a real stall
 * as a failure. Callers must raise their own test timeout above that.
 */
export async function throttled<T extends { status(): number }>(
  send: () => Promise<T>,
): Promise<T> {
  const WINDOW_MS = 61_000;
  const MAX_WAITS = 2;

  let response = await send();

  for (let wait = 0; wait < MAX_WAITS; wait += 1) {
    if (response.status() !== 429) return response;

    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS));
    response = await send();
  }

  // Returned rather than thrown: the caller's own assertion reports the status
  // it expected against the 429 it got, which names the endpoint. Throwing here
  // would replace that with a stack trace pointing at this helper.
  return response;
}

/**
 * Attaches the two documents an unsecured application's gate requires.
 *
 * Shared by the Module 07 and Module 08 specs, which run in the same serial
 * group and therefore against the same rate limiter. The multipart request is
 * made directly rather than through `apiAs`, whose client only speaks JSON.
 *
 * # Why a 429 is waited out rather than failed on
 *
 * Uploads are throttled to 20 a minute. Between them the two specs drive well
 * over ten full application lifecycles, two uploads each, so a full run brushes
 * that ceiling — and which spec happens to hit it depends only on ordering.
 * The throttle is real behaviour of the endpoint; a suite that could pass only
 * with it disabled would be testing a system nobody runs. One window, one
 * retry: a loop would turn a genuine stall into a slow green.
 *
 * Callers must raise their own test timeout above the 60s wait.
 */
export async function attachRequiredDocuments(
  request: APIRequestContext,
  mobile: string,
  applicationId: string,
): Promise<void> {
  const cookie = await cookieHeader(request, mobile);

  for (const documentType of ["ID", "INCOME"]) {
    const send = () =>
      request.post(
        `${API_BASE}/api/v1/loan-applications/${applicationId}/documents`,
        {
          // A multipart upload is a mutation like any other, so the CSRF guard
          // requires these too. Without them the upload is refused with 403 and
          // reported here as an upload failure, which points at the endpoint
          // rather than at the missing headers.
          headers: { cookie, ...CSRF_HEADERS },
          multipart: {
            documentType,
            file: {
              name: `${documentType.toLowerCase()}.png`,
              mimeType: "image/png",
              buffer: pngBytes(),
            },
          },
        },
      );

    let response = await send();

    if (response.status() === 429) {
      await new Promise((resolve) => setTimeout(resolve, 61_000));
      response = await send();
    }

    if (response.status() !== 201) {
      throw new Error(
        `document upload failed (${response.status()}): ${await response.text()}`,
      );
    }
  }
}
