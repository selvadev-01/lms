import "server-only";

import type {
  OverdueDetail,
  OverdueListResult as OverdueListPayload,
  OverdueSummary,
  RecoveryActionRecord,
  RecoveryCaseDetail,
  RecoveryCaseListResult as RecoveryCaseListPayload,
  RecoveryCaseSummary,
} from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Overdue and recovery data layer (Module 13).
 *
 * Follows `features/collections/api/collections.ts` exactly, including the two
 * properties that matter for a surface carrying a borrower's delinquency:
 *
 * `apiGetRecord` collapses a 403 into `not-found`, so a case id cannot be
 * confirmed to exist by the shape of the refusal (Scenarios 45, 46, 47). The
 * API already returns 404 rather than 403 for out-of-scope rows; this keeps the
 * client from reintroducing the distinction.
 *
 * Nothing here filters by branch, and nothing sends an officer id as a scope
 * control. Confinement is applied server-side regardless of what is sent — a
 * Recovery Officer without assignment authority receives only their own cases
 * whatever this asks for — so an unfiltered request returns the *narrowest* set
 * the caller is entitled to.
 *
 * There is also no `asOf` parameter anywhere. The overdue position is derived
 * against the server's Asia/Kolkata business date; letting a client name the
 * date would let a wrong device clock move a borrower into or out of the
 * overdue book (Rule 14).
 */

export type OverdueListResult =
  | { status: "ok"; overdues: OverdueSummary[]; total: number }
  | FetchFailure;

export type OverdueDetailResult =
  | { status: "ok"; overdue: OverdueDetail }
  /** Out of scope, another tenant, or absent — deliberately indistinguishable. */
  | { status: "not-found" }
  | FetchFailure;

export type RecoveryCaseListResult =
  | { status: "ok"; cases: RecoveryCaseSummary[]; total: number }
  | FetchFailure;

export type RecoveryCaseDetailResult =
  | { status: "ok"; recoveryCase: RecoveryCaseDetail }
  | { status: "not-found" }
  | FetchFailure;

export type RecoveryActionDetailResult =
  | { status: "ok"; action: RecoveryActionRecord }
  | { status: "not-found" }
  | FetchFailure;

export async function fetchOverdues(params?: {
  search?: string;
  bucket?: string;
  npaStatus?: string;
  minDaysPastDue?: string;
}): Promise<OverdueListResult> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.bucket) query.set("bucket", params.bucket);
  if (params?.npaStatus) query.set("npaStatus", params.npaStatus);
  if (params?.minDaysPastDue) {
    query.set("minDaysPastDue", params.minDaysPastDue);
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const result = await apiGet<OverdueListPayload>(
    `/recovery/overdues${suffix}`,
  );

  if (result.status !== "ok") return result;
  return {
    status: "ok",
    overdues: result.data.items,
    total: result.data.total,
  };
}

/**
 * Keyed by loan, not by an overdue-case id.
 *
 * There is no overdue row to have an id — the position is derived on read. The
 * loan is the only thing here with an identity.
 */
export async function fetchOverdue(
  loanId: string,
): Promise<OverdueDetailResult> {
  const result = await apiGetRecord<OverdueDetail>(
    `/recovery/overdues/${loanId}`,
  );

  if (result.status !== "ok") return result;
  return { status: "ok", overdue: result.data };
}

export async function fetchRecoveryCases(params?: {
  search?: string;
  status?: string;
  priority?: string;
  assigneeUserId?: string;
}): Promise<RecoveryCaseListResult> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.status) query.set("status", params.status);
  if (params?.priority) query.set("priority", params.priority);
  if (params?.assigneeUserId) {
    query.set("assigneeUserId", params.assigneeUserId);
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const result = await apiGet<RecoveryCaseListPayload>(
    `/recovery/cases${suffix}`,
  );

  if (result.status !== "ok") return result;
  return { status: "ok", cases: result.data.items, total: result.data.total };
}

export async function fetchRecoveryCase(
  recoveryCaseId: string,
): Promise<RecoveryCaseDetailResult> {
  const result = await apiGetRecord<RecoveryCaseDetail>(
    `/recovery/cases/${recoveryCaseId}`,
  );

  if (result.status !== "ok") return result;
  return { status: "ok", recoveryCase: result.data };
}

export async function fetchRecoveryAction(
  recoveryActionId: string,
): Promise<RecoveryActionDetailResult> {
  const result = await apiGetRecord<RecoveryActionRecord>(
    `/recovery/actions/${recoveryActionId}`,
  );

  if (result.status !== "ok") return result;
  return { status: "ok", action: result.data };
}
