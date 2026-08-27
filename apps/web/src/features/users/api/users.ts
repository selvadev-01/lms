import "server-only";

import type { UserDetail, UserSummary } from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Users & Employees data layer.
 *
 * Two surfaces over one API resource pair, mirroring the server: `/users` reads
 * administrator accounts and `/employees` reads records carrying an employee
 * code. They are kept as separate functions rather than one with a flag, because
 * they are guarded by different permissions and a caller holding only
 * `employees.view` must never accidentally be routed at `/users`.
 */

export type UserListResult =
  { status: "ok"; users: UserSummary[] } | FetchFailure;

export type UserResult =
  | { status: "ok"; user: UserDetail }
  /** Out of scope, another tenant, the wrong surface, or absent — indistinguishable. */
  | { status: "not-found" }
  | FetchFailure;

/** Admin Management — accounts with no employee code. */
export async function fetchUsers(): Promise<UserListResult> {
  const result = await apiGet<{ users: UserSummary[] }>("/users");

  return result.status === "ok"
    ? { status: "ok", users: result.data.users }
    : result;
}

export async function fetchUser(userId: string): Promise<UserResult> {
  const result = await apiGetRecord<UserDetail>(
    `/users/${encodeURIComponent(userId)}`,
  );

  return result.status === "ok" ? { status: "ok", user: result.data } : result;
}

/**
 * Employee Management — records carrying an employee code.
 *
 * `activeOnly` and `roleCode` serve the field-collection selector, which must not
 * offer a deactivated employee for new work. Employee Management itself passes
 * neither: an administrator needs to see inactive employees in order to
 * reactivate one.
 */
export async function fetchEmployees(
  options: { activeOnly?: boolean; roleCode?: string } = {},
): Promise<UserListResult> {
  const params = new URLSearchParams();
  if (options.activeOnly) params.set("activeOnly", "true");
  if (options.roleCode) params.set("roleCode", options.roleCode);
  const query = params.size > 0 ? `?${params.toString()}` : "";

  const result = await apiGet<{ users: UserSummary[] }>(`/employees${query}`);

  return result.status === "ok"
    ? { status: "ok", users: result.data.users }
    : result;
}

export async function fetchEmployee(userId: string): Promise<UserResult> {
  const result = await apiGetRecord<UserDetail>(
    `/employees/${encodeURIComponent(userId)}`,
  );

  return result.status === "ok" ? { status: "ok", user: result.data } : result;
}
