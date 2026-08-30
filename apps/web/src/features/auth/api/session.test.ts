import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { API_BASE_URL: "http://api.test" } }));

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined,
    toString: () =>
      [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; "),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

// React's `cache` memoizes per render pass. There is no render pass in a unit
// test, so it must be a pass-through — otherwise every call in a single test
// would share one result and the cache under test could not be observed.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));

const { getSession, forgetCachedSession, ACCESS_COOKIE } =
  await import("./session");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const USER = { id: "u1", name: "Selva", permissions: ["loans.view"] };

/**
 * A JWT with the given expiry, assembled by hand.
 *
 * Deliberately unsigned-in-substance: the signature segment is a placeholder,
 * because the code under test only ever *decodes* the token to read `exp` and
 * must never verify it — the API holds the signing secret and re-verifies every
 * request. A test that signed properly would imply a guarantee this layer does
 * not make.
 */
let tokenSeq = 0;

function tokenExpiringIn(seconds: number): string {
  const b64 = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const header = b64({ alg: "HS256", typ: "JWT" });
  const claims = b64({
    sub: "u1",
    // `jti` makes every minted token distinct. The profile cache is module
    // scoped and outlives an individual test, so two tokens built in the same
    // second would otherwise be byte-identical and the second test would be
    // served the first one's cache entry.
    jti: `t${++tokenSeq}`,
    exp: Math.floor(Date.now() / 1000) + seconds,
  });
  return `${header}.${claims}.placeholder-signature`;
}

function respondOk() {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ user: USER }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
});

describe("getSession", () => {
  it("returns null without an access cookie, and does not call the API", async () => {
    expect(await getSession()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * The bug this whole cache exists for. Every guarded page render called
   * /auth/me, so ordinary navigation spent the per-IP rate-limit budget and the
   * resulting 429 rendered as "unavailable".
   */
  it("fetches the profile once per token, not once per navigation", async () => {
    cookieJar.set(ACCESS_COOKIE, tokenExpiringIn(900));
    respondOk();

    for (let i = 0; i < 5; i++) expect(await getSession()).toEqual(USER);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches again when the token changes", async () => {
    cookieJar.set(ACCESS_COOKIE, tokenExpiringIn(900));
    respondOk();
    await getSession();

    // A refresh rotates the token; the new one must not be served the old
    // profile from cache.
    cookieJar.set(ACCESS_COOKIE, tokenExpiringIn(900));
    await getSession();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a token that has already expired", async () => {
    cookieJar.set(ACCESS_COOKIE, tokenExpiringIn(-10));
    respondOk();

    await getSession();
    await getSession();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forgets a cached profile on sign-out", async () => {
    const token = tokenExpiringIn(900);
    cookieJar.set(ACCESS_COOKIE, token);
    respondOk();
    await getSession();

    forgetCachedSession(token);
    await getSession();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a rejected token as signed out", async () => {
    cookieJar.set(ACCESS_COOKIE, tokenExpiringIn(900));
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    expect(await getSession()).toBeNull();
  });

  /**
   * A rate limit is not a statement about who the caller is. Returning null
   * here signed a working user out; throwing reaches an error boundary that
   * offers a retry.
   */
  it("throws rather than signing the user out when rate limited", async () => {
    cookieJar.set(ACCESS_COOKIE, tokenExpiringIn(900));
    fetchMock.mockResolvedValue({ ok: false, status: 429 });

    await expect(getSession()).rejects.toThrow(/429/);
  });

  it("throws rather than signing the user out when the API errors", async () => {
    cookieJar.set(ACCESS_COOKIE, tokenExpiringIn(900));
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await expect(getSession()).rejects.toThrow(/503/);
  });

  /**
   * An outage is the same class of fault as the two above — the API has said
   * nothing about who the caller is — and must get the same answer. This
   * returned null before, so a restart of the API signed everyone out while
   * `auth-refresh.ts` answered `"retry"` for the identical condition.
   */
  it("throws rather than signing the user out when the API is unreachable", async () => {
    cookieJar.set(ACCESS_COOKIE, tokenExpiringIn(900));
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(getSession()).rejects.toThrow(/unreachable/);
  });

  /** A malformed body is not an authentication answer either. */
  it("throws rather than signing the user out when the body cannot be read", async () => {
    cookieJar.set(ACCESS_COOKIE, tokenExpiringIn(900));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected end of JSON input");
      },
    });

    await expect(getSession()).rejects.toThrow(/unreachable/);
  });

  /**
   * The cost of caching, pinned deliberately rather than left implicit.
   *
   * A session revoked elsewhere — by an administrator, say — keeps resolving
   * from this cache until its entry lapses, because the cache is consulted
   * before the API is asked. That window is bounded by MAX_PROFILE_AGE_MS and
   * grants nothing: the API re-validates every request it serves, so the stale
   * profile can render a page shell and nothing behind it will load.
   *
   * Sign-out is not subject to this at all — it clears the entry directly, as
   * the test above covers. If this window ever needs to be zero, the cache has
   * to go, and /auth/me returns to costing one request per navigation.
   */
  it("serves a revoked session from cache only until the entry lapses", async () => {
    const token = tokenExpiringIn(900);
    cookieJar.set(ACCESS_COOKIE, token);
    respondOk();
    await getSession();

    // Revoked server-side while the token itself is still unexpired.
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    expect(await getSession()).toEqual(USER);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Once the entry lapses the API is asked again, and its refusal stands.
    forgetCachedSession(token);
    expect(await getSession()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
