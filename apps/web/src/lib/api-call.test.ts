import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The status-code vocabulary in `api-call.ts` is the module's whole value: each
 * code means something specific to a user, and every write in the app routes
 * through it. The Playwright specs exercise the happy path but cannot
 * practically produce a 409-with-`blockedBy`, a 413, or a Nest array-`message`
 * 400 on demand — so those branches were previously unverified.
 *
 * `next/headers` and `next/navigation` are mocked because they throw outside a
 * request scope, and `server-only` because it throws outside a server bundle.
 */

vi.mock("server-only", () => ({}));

const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    // The real `redirect` signals by throwing; several callers depend on that.
    throw new Error("NEXT_REDIRECT");
  },
}));

const cookieDelete = vi.fn();
const cookieSet = vi.fn();
/**
 * `toString` reports the renewed header once `set` has been called, so a test
 * can assert that the retry carried the new cookie rather than the stale one.
 */
let cookieHeader = "session=abc";
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      toString: () => cookieHeader,
      delete: cookieDelete,
      set: (name: string, value: string) => {
        cookieSet(name, value);
        cookieHeader = "session=renewed";
      },
    }),
}));

vi.mock("@/lib/env", () => ({ env: { API_BASE_URL: "http://api.test" } }));

const refreshSession = vi.fn();
vi.mock("@/lib/auth-refresh", () => ({
  refreshSession: (header: string) => refreshSession(header) as unknown,
}));

const {
  call,
  callMultipart,
  endSession,
  NOT_PERMITTED,
  RATE_LIMITED,
  NOT_REACHABLE,
} = await import("./api-call");

/** A minimal Response stand-in; only what `call` actually reads. */
function respond(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () =>
      body === undefined
        ? Promise.reject(new Error("no body"))
        : Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  vi.clearAllMocks();
  cookieHeader = "session=abc";
  // Default: the session cannot be renewed, so a 401 stays a 401. Tests that
  // exercise renewal opt in explicitly.
  refreshSession.mockResolvedValue(null);
});

describe("call — request shape", () => {
  it("prefixes the versioned API path and forwards the cookie", async () => {
    fetchMock.mockResolvedValue(respond(200, { id: "1" }));

    await call(
      "/customers",
      { method: "POST", body: { name: "A" } },
      "Customers",
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/customers");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).cookie).toBe("session=abc");
    expect(init.cache).toBe("no-store");
  });

  it("omits Content-Type when there is no body", async () => {
    fetchMock.mockResolvedValue(respond(200, {}));

    await call("/x", { method: "DELETE" }, "Svc");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(
      (init.headers as Record<string, string>)["Content-Type"],
    ).toBeUndefined();
    expect(init.body).toBeUndefined();
  });
});

describe("call — status vocabulary", () => {
  it("maps 401 to session-ended, not a failure message", async () => {
    fetchMock.mockResolvedValue(respond(401));
    expect(await call("/x", { method: "POST" }, "Svc")).toEqual({
      kind: "session-ended",
    });
  });

  it.each([
    [403, NOT_PERMITTED],
    [404, NOT_REACHABLE],
    [429, RATE_LIMITED],
  ])("maps %i to its own message", async (status, message) => {
    fetchMock.mockResolvedValue(respond(status));
    expect(await call("/x", { method: "POST" }, "Svc")).toEqual({
      kind: "failed",
      state: { message },
    });
  });

  it("passes a 409 body through, including blockedBy", async () => {
    const blockedBy = [{ entity: "loan", label: "Loans", count: 2 }];
    fetchMock.mockResolvedValue(
      respond(409, { message: "Branch has loans", blockedBy }),
    );

    const outcome = await call("/x", { method: "DELETE" }, "Svc");

    expect(outcome).toEqual({
      kind: "failed",
      state: { message: "Branch has loans", blockedBy },
    });
  });

  it("forwards duplicateOf on a 409 even though ActionState omits it", async () => {
    fetchMock.mockResolvedValue(
      respond(409, { message: "Duplicate", duplicateOf: [{ id: "c1" }] }),
    );

    const outcome = await call("/x", { method: "POST" }, "Svc");

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect((outcome.state as { duplicateOf?: unknown[] }).duplicateOf).toEqual([
      { id: "c1" },
    ]);
  });

  /** Nest's ValidationPipe returns `message` as an array; only the first shows. */
  it("takes the first entry of a 400 array message", async () => {
    fetchMock.mockResolvedValue(
      respond(400, { message: ["name must not be empty", "code is invalid"] }),
    );

    expect(await call("/x", { method: "POST" }, "Svc")).toEqual({
      kind: "failed",
      state: { message: "name must not be empty" },
    });
  });

  it("uses a 400 string message as-is", async () => {
    fetchMock.mockResolvedValue(respond(400, { message: "Bad input" }));
    expect(await call("/x", { method: "POST" }, "Svc")).toEqual({
      kind: "failed",
      state: { message: "Bad input" },
    });
  });

  it("names the service in the fallback for an unmapped status", async () => {
    fetchMock.mockResolvedValue(respond(500));
    expect(await call("/x", { method: "POST" }, "Role Management")).toEqual({
      kind: "failed",
      state: {
        message:
          "Role Management is temporarily unavailable. Please try again shortly.",
      },
    });
  });

  it("never reports a write as succeeded when the request threw", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const outcome = await call("/x", { method: "POST" }, "Svc");
    expect(outcome.kind).toBe("failed");
  });

  it("treats an unparseable success body as ok with null", async () => {
    fetchMock.mockResolvedValue(respond(204));
    expect(await call("/x", { method: "DELETE" }, "Svc")).toEqual({
      kind: "ok",
      body: null,
    });
  });
});

describe("callMultipart", () => {
  it("does not set Content-Type, so fetch can add the boundary", async () => {
    fetchMock.mockResolvedValue(respond(201, {}));

    await callMultipart("/docs", new FormData(), "Documents");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.cookie).toBe("session=abc");
  });

  /** Multer rejects before the handler, so the service message never arrives. */
  it("explains a 413 in terms of the file, not an outage", async () => {
    fetchMock.mockResolvedValue(respond(413));

    const outcome = await callMultipart("/docs", new FormData(), "Documents");

    expect(outcome).toEqual({
      kind: "failed",
      state: { message: "That file is too large. The maximum size is 5 MB." },
    });
  });

  it("maps 401 to session-ended", async () => {
    fetchMock.mockResolvedValue(respond(401));
    expect(await callMultipart("/docs", new FormData(), "Docs")).toEqual({
      kind: "session-ended",
    });
  });
});

/**
 * The 15-minute access token lapses long before the 7-day refresh token does.
 * Before this behavior existed, that gap signed working users out roughly every
 * quarter hour while a valid credential sat unused.
 */
describe("call — session renewal on 401", () => {
  const renewed = [{ name: "lms_at", value: "fresh", secure: false }];

  it("renews and retries once, returning the retry's result", async () => {
    refreshSession.mockResolvedValue(renewed);
    fetchMock
      .mockResolvedValueOnce(respond(401))
      .mockResolvedValueOnce(respond(200, { id: "1" }));

    const outcome = await call("/x", { method: "POST" }, "Svc");

    expect(outcome).toEqual({ kind: "ok", body: { id: "1" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("sends the renewed cookie on the retry, not the stale one", async () => {
    refreshSession.mockResolvedValue(renewed);
    fetchMock
      .mockResolvedValueOnce(respond(401))
      .mockResolvedValueOnce(respond(200, {}));

    await call("/x", { method: "POST" }, "Svc");

    const [, first] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, second] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((first.headers as Record<string, string>).cookie).toBe(
      "session=abc",
    );
    expect((second.headers as Record<string, string>).cookie).toBe(
      "session=renewed",
    );
  });

  it("persists every renewed cookie", async () => {
    refreshSession.mockResolvedValue([
      { name: "lms_at", value: "fresh", secure: false },
      { name: "lms_rt", value: "rotated", secure: false },
    ]);
    fetchMock
      .mockResolvedValueOnce(respond(401))
      .mockResolvedValueOnce(respond(200, {}));

    await call("/x", { method: "POST" }, "Svc");

    expect(cookieSet).toHaveBeenCalledWith("lms_at", "fresh");
    expect(cookieSet).toHaveBeenCalledWith("lms_rt", "rotated");
  });

  it("ends the session when renewal is refused", async () => {
    refreshSession.mockResolvedValue(null);
    fetchMock.mockResolvedValue(respond(401));

    expect(await call("/x", { method: "POST" }, "Svc")).toEqual({
      kind: "session-ended",
    });
    // No retry: the request is not re-sent with a token known to be dead.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The second 401 is authoritative. Retrying again would chase a token that
   * rotation has already revoked, and could loop indefinitely.
   */
  it("retries exactly once, never twice", async () => {
    refreshSession.mockResolvedValue(renewed);
    fetchMock.mockResolvedValue(respond(401));

    expect(await call("/x", { method: "POST" }, "Svc")).toEqual({
      kind: "session-ended",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("does not renew for any status other than 401", async () => {
    fetchMock.mockResolvedValue(respond(403));

    await call("/x", { method: "POST" }, "Svc");

    expect(refreshSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renews for an upload too, re-sending the same FormData", async () => {
    refreshSession.mockResolvedValue(renewed);
    fetchMock
      .mockResolvedValueOnce(respond(401))
      .mockResolvedValueOnce(respond(201, { id: "d1" }));
    const body = new FormData();
    body.append("file", "bytes");

    const outcome = await callMultipart("/docs", body, "Documents");

    expect(outcome).toEqual({ kind: "ok", body: { id: "d1" } });
    const [, first] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, second] = fetchMock.mock.calls[1] as [string, RequestInit];
    // The same object, so the user is never asked to pick their file again.
    expect(first.body).toBe(body);
    expect(second.body).toBe(body);
  });
});

describe("endSession", () => {
  it("clears both cookies before redirecting to sign in", async () => {
    await expect(endSession()).rejects.toThrow("NEXT_REDIRECT");

    expect(cookieDelete).toHaveBeenCalledTimes(2);
    expect(redirect).toHaveBeenCalledWith("/signin");
  });
});
