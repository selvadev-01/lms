import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { API_BASE_URL: "http://api.test" } }));

const { parseSetCookies, refreshSession } = await import("./auth-refresh");

/** A Headers stand-in whose getSetCookie returns the given raw headers. */
function headersWith(setCookie: string[]): Headers {
  return { getSetCookie: () => setCookie } as unknown as Headers;
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseSetCookies", () => {
  it("reads name and value, discarding the API's own attributes", () => {
    const parsed = parseSetCookies(
      headersWith([
        "lms_at=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=900",
        "lms_rt=def456; Path=/api/v1/auth; HttpOnly; SameSite=Lax",
      ]),
    );

    expect(parsed).toEqual([
      { name: "lms_at", value: "abc123", secure: false },
      { name: "lms_rt", value: "def456", secure: false },
    ]);
  });

  it("carries the Secure flag through, case-insensitively", () => {
    expect(
      parseSetCookies(headersWith(["lms_at=x; Path=/; Secure; HttpOnly"])),
    ).toEqual([{ name: "lms_at", value: "x", secure: true }]);
    expect(parseSetCookies(headersWith(["lms_at=x; path=/; secure"]))).toEqual([
      { name: "lms_at", value: "x", secure: true },
    ]);
  });

  it("keeps a base64url value containing '=' padding intact", () => {
    // Refresh tokens are base64url and can end in '='; splitting on the LAST
    // separator instead of the first would truncate them.
    expect(parseSetCookies(headersWith(["lms_rt=YWJjZGVm==; Path=/"]))).toEqual(
      [{ name: "lms_rt", value: "YWJjZGVm==", secure: false }],
    );
  });

  it("skips a malformed header rather than emitting a nameless cookie", () => {
    expect(parseSetCookies(headersWith(["garbage; Path=/"]))).toEqual([]);
  });

  it("returns nothing when the response set no cookies", () => {
    expect(parseSetCookies(headersWith([]))).toEqual([]);
  });
});

describe("refreshSession", () => {
  it("posts to the refresh endpoint with the caller's cookies", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: headersWith(["lms_at=new; Path=/"]),
    });

    await refreshSession("lms_rt=abc");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/auth/refresh");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).cookie).toBe("lms_rt=abc");
    expect(init.cache).toBe("no-store");
  });

  it("returns the renewed cookies on success", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: headersWith([
        "lms_at=fresh; Path=/; Secure",
        "lms_rt=rotated; Path=/api/v1/auth",
      ]),
    });

    expect(await refreshSession("lms_rt=old")).toEqual([
      { name: "lms_at", value: "fresh", secure: true },
      { name: "lms_rt", value: "rotated", secure: false },
    ]);
  });

  /** Revoked, idled out, or past its absolute lifetime — all answer 401. */
  it("returns null when the API refuses to renew", async () => {
    // The status matters: only 401 and 403 end a session. Anything else is a
    // transient fault, so a mock without one would not exercise this path.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      headers: headersWith([]),
    });
    expect(await refreshSession("lms_rt=revoked")).toBeNull();
  });

  /**
   * A rate limit is not a statement about the session.
   *
   * Returning null here signed a working user out mid-navigation: `proxy.ts`
   * read it as a refusal and redirected to sign-in while a valid refresh token
   * sat in the cookie jar. The dashboard alone spends nine requests per view,
   * so the budget is reachable by ordinary clicking.
   */
  it("asks the caller to retry when the API is rate limited", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      headers: headersWith([]),
    });
    expect(await refreshSession("lms_rt=abc")).toBe("retry");
  });

  it("asks the caller to retry when the API errors", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      headers: headersWith([]),
    });
    expect(await refreshSession("lms_rt=abc")).toBe("retry");
  });

  /**
   * A 200 carrying no cookies would otherwise read as success, and the caller
   * would retry with the same expired token it started with.
   */
  it("returns null when a success response carried no cookies", async () => {
    fetchMock.mockResolvedValue({ ok: true, headers: headersWith([]) });
    expect(await refreshSession("lms_rt=abc")).toBeNull();
  });

  /**
   * An unreachable API is not a revoked session either.
   *
   * This asserted null — "fail closed" — but ending the session was never what
   * made it closed: the access token is still absent afterwards, so every read
   * is refused regardless. All the null bought was signing the user out over a
   * restart of the API, and making them retype a password to recover from it.
   * `"retry"` keeps the cookies and lets the next navigation succeed.
   */
  it("asks the caller to retry when the API is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await refreshSession("lms_rt=abc")).toBe("retry");
  });

  it("does not call the API without a cookie to present", async () => {
    expect(await refreshSession("")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
