import "server-only";

import type {
  DisbursalQueueItem,
  DisbursalReadiness,
  DisbursementDetail,
  DisbursementSummary,
  LedgerEntryDetail,
  RepaymentScheduleDetail,
} from "@lms/types";
import type { SelectOption } from "@lms/validation";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Disbursal data layer (Module 09).
 *
 * Follows `features/loans/api/loans.ts` exactly, including the two properties
 * that matter for a financial surface:
 *
 * `apiGetRecord` collapses a 403 into `not-found`, so a disbursement id cannot
 * be confirmed to exist by the shape of the refusal (Scenarios 3, 4). The API
 * already returns 404 rather than 403 for out-of-scope rows; this keeps the
 * client from reintroducing the distinction.
 *
 * Nothing here filters by branch. Confinement is applied server-side regardless
 * of what is sent — there is no `branchId` parameter to send — so an unfiltered
 * request returns the *narrowest* set the caller is entitled to.
 */

export type DisbursalQueueResult =
  { status: "ok"; loans: DisbursalQueueItem[] } | FetchFailure;

export type DisbursementListResult =
  | { status: "ok"; disbursements: DisbursementSummary[]; total: number }
  | FetchFailure;

export type DisbursementDetailResult =
  | { status: "ok"; disbursement: DisbursementDetail }
  /** Out of scope, another tenant, or absent — deliberately indistinguishable. */
  | { status: "not-found" }
  | FetchFailure;

export type DisbursalReadinessResult =
  | { status: "ok"; readiness: DisbursalReadiness }
  | { status: "not-found" }
  | FetchFailure;

/**
 * `not-found` here means "not confirmed yet" as often as it means "no such
 * disbursement" — the endpoint 404s until a ledger entry exists. The detail
 * page treats both the same way: no panel.
 */
export type LedgerEntryResult =
  | { status: "ok"; entry: LedgerEntryDetail }
  | { status: "not-found" }
  | FetchFailure;

export type RepaymentScheduleResult =
  | { status: "ok"; schedule: RepaymentScheduleDetail }
  | { status: "not-found" }
  | FetchFailure;

export type FundingAccountsResult =
  { status: "ok"; accounts: SelectOption[] } | FetchFailure;

/**
 * The funding accounts a disbursement may be scheduled against.
 *
 * Returns `SelectOption[]`, the same shape master data and the compiled-in enum
 * registries carry, so `<SelectField>` consumes it without knowing these came
 * from the chart of accounts.
 *
 * The failure case is deliberately not collapsed to an empty array: "this
 * organization has no funding account configured" and "we could not load the
 * list" must stay distinguishable, or the schedule form renders an empty
 * dropdown as though nothing had been set up.
 */
export async function fetchFundingAccounts(): Promise<FundingAccountsResult> {
  const result = await apiGet<{ accounts: SelectOption[] }>(
    "/loans/disbursements/accounts",
  );

  return result.status === "ok"
    ? { status: "ok", accounts: result.data.accounts }
    : result;
}

/** Loans whose agreement is signed and which are not yet disbursed (Scenario 1). */
export async function fetchDisbursalQueue(): Promise<DisbursalQueueResult> {
  const result = await apiGet<{ loans: DisbursalQueueItem[] }>(
    "/loans/disbursements/eligible",
  );

  return result.status === "ok"
    ? { status: "ok", loans: result.data.loans }
    : result;
}

export async function fetchDisbursements(params?: {
  search?: string;
  status?: string;
}): Promise<DisbursementListResult> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.status) query.set("status", params.status);

  const suffix = query.toString() ? `?${query.toString()}` : "";

  const result = await apiGet<{
    disbursements: DisbursementSummary[];
    total: number;
  }>(`/loans/disbursements${suffix}`);

  return result.status === "ok"
    ? {
        status: "ok",
        disbursements: result.data.disbursements,
        total: result.data.total,
      }
    : result;
}

export async function fetchDisbursement(
  disbursementId: string,
): Promise<DisbursementDetailResult> {
  const result = await apiGetRecord<DisbursementDetail>(
    `/loans/disbursements/${encodeURIComponent(disbursementId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", disbursement: result.data }
    : result;
}

/**
 * Advisory only. The confirm endpoint re-runs every one of these gates inside
 * its own transaction, so a blocker that appears between this read and the
 * confirm is still caught (Rules 47, 53, 54).
 */
export async function fetchDisbursalReadiness(
  disbursementId: string,
): Promise<DisbursalReadinessResult> {
  const result = await apiGetRecord<DisbursalReadiness>(
    `/loans/disbursements/${encodeURIComponent(disbursementId)}/readiness`,
  );

  return result.status === "ok"
    ? { status: "ok", readiness: result.data }
    : result;
}

export async function fetchDisbursementLedger(
  disbursementId: string,
): Promise<LedgerEntryResult> {
  const result = await apiGetRecord<LedgerEntryDetail>(
    `/loans/disbursements/${encodeURIComponent(disbursementId)}/ledger`,
  );

  return result.status === "ok" ? { status: "ok", entry: result.data } : result;
}

export async function fetchRepaymentSchedule(
  disbursementId: string,
): Promise<RepaymentScheduleResult> {
  const result = await apiGetRecord<RepaymentScheduleDetail>(
    `/loans/disbursements/${encodeURIComponent(disbursementId)}/schedule`,
  );

  return result.status === "ok"
    ? { status: "ok", schedule: result.data }
    : result;
}
