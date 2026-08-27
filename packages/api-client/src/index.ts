import type { Paginated } from "@lms/types";

/**
 * Minimal typed fetch wrapper for apps/api.
 *
 * Transport concerns only — auth token injection, JSON handling, error
 * normalisation. Business rules belong in features (web) or modules (api).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Called per request so a rotated token is always picked up. */
  getToken?: () => string | undefined | Promise<string | undefined>;
  /**
   * Extra headers resolved per request. The Next server uses this to forward
   * the inbound `Cookie` header on server-to-server calls, since httpOnly
   * session cookies are not attached automatically on that hop.
   */
  getHeaders?: () =>
    Record<string, string> | Promise<Record<string, string>> | undefined;
}

export function createApiClient({
  baseUrl,
  getToken,
  getHeaders,
}: ApiClientOptions) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken?.();
    const extraHeaders = await getHeaders?.();

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      // Session auth is cookie-based, so cookies must ride along on every call.
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extraHeaders,
        ...init.headers,
      },
    });

    if (!response.ok) {
      // Error bodies are not guaranteed to be JSON (proxies, gateways).
      const body = await response.json().catch(() => undefined);
      throw new ApiError(
        response.status,
        `${init.method ?? "GET"} ${path} failed with ${response.status}`,
        body,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    getPaginated: <T>(path: string) => request<Paginated<T>>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "POST", body: JSON.stringify(body) }),
    patch: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
    delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
