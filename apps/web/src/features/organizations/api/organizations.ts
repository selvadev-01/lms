import "server-only";

import type {
  BranchDetail,
  BranchSummary,
  OrganizationDetail,
} from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Organizations & Branches data layer.
 *
 * The fetch mechanics live in `@/lib/api-fetch`, shared with every other
 * feature; what remains here is this module's own vocabulary — which paths it
 * reads and what it calls the results.
 */

export type OrganizationResult =
  { status: "ok"; organization: OrganizationDetail } | FetchFailure;

/** Company Settings — the caller's own organization, resolved from their token. */
export async function fetchOrganization(): Promise<OrganizationResult> {
  const result = await apiGet<OrganizationDetail>("/organizations/me");

  return result.status === "ok"
    ? { status: "ok", organization: result.data }
    : result;
}

export type BranchListResult =
  { status: "ok"; branches: BranchSummary[] } | FetchFailure;

/**
 * Branches within the caller's scope.
 *
 * `activeOnly` serves an operational selector, which must not offer an
 * inactive branch. Branch Management itself passes nothing, because an
 * administrator needs to see the inactive branches in order to reactivate one.
 */
export async function fetchBranches(
  options: { activeOnly?: boolean } = {},
): Promise<BranchListResult> {
  const query = options.activeOnly ? "?activeOnly=true" : "";
  const result = await apiGet<{ branches: BranchSummary[] }>(
    `/branches${query}`,
  );

  return result.status === "ok"
    ? { status: "ok", branches: result.data.branches }
    : result;
}

export type BranchResult =
  | { status: "ok"; branch: BranchDetail }
  /** Out of scope, another tenant, or simply absent — the API does not say which. */
  | { status: "not-found" }
  | FetchFailure;

export async function fetchBranch(branchId: string): Promise<BranchResult> {
  const result = await apiGetRecord<BranchDetail>(
    `/branches/${encodeURIComponent(branchId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", branch: result.data }
    : result;
}
