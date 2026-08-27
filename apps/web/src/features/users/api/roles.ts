import "server-only";

import type { PermissionSummary, RoleDetail, RoleSummary } from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Roles & Permissions data layer.
 */

export type RoleListResult =
  { status: "ok"; roles: RoleSummary[] } | FetchFailure;

export type RoleResult =
  { status: "ok"; role: RoleDetail } | { status: "not-found" } | FetchFailure;

export type PermissionCatalogResult =
  { status: "ok"; permissions: PermissionSummary[] } | FetchFailure;

/**
 * Roles within the caller's organization.
 *
 * `activeOnly` serves the role pickers on the user and employee forms: only an
 * ACTIVE role may be assigned as live authorization, so offering a DRAFT or
 * INACTIVE one there invites a submission the server will refuse. Role
 * Management itself passes nothing — an administrator has to see a DRAFT role in
 * order to activate it.
 */
export async function fetchRoles(
  options: { activeOnly?: boolean } = {},
): Promise<RoleListResult> {
  const query = options.activeOnly ? "?activeOnly=true" : "";
  const result = await apiGet<{ roles: RoleSummary[] }>(`/roles${query}`);

  return result.status === "ok"
    ? { status: "ok", roles: result.data.roles }
    : result;
}

export async function fetchRole(roleId: string): Promise<RoleResult> {
  const result = await apiGetRecord<RoleDetail>(
    `/roles/${encodeURIComponent(roleId)}`,
  );

  return result.status === "ok" ? { status: "ok", role: result.data } : result;
}

/**
 * The permission catalog the role editor renders.
 *
 * Each entry carries `delegable`, which is false for a permission the caller
 * does not hold themselves. That is the delegation subset rule made visible
 * before a submit rather than only in its rejection — the editor disables those
 * checkboxes instead of letting an administrator compose a role the server will
 * refuse.
 */
export async function fetchPermissionCatalog(): Promise<PermissionCatalogResult> {
  const result = await apiGet<{ permissions: PermissionSummary[] }>(
    "/permissions",
  );

  return result.status === "ok"
    ? { status: "ok", permissions: result.data.permissions }
    : result;
}
