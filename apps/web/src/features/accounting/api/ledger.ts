import "server-only";

import type {
  GeneralLedgerPage,
  ReconciliationReport,
  TrialBalance,
} from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * General ledger, trial balance and reconciliation reads (Module 14).
 *
 * Every figure these return is computed server-side, including the running
 * balance on each ledger row and the totals on the trial balance. Summing them
 * in the browser would produce numbers that look like the same assertion but
 * are really the client marking its own homework — and a running balance
 * computed client-side would be wrong on any page but the first, because a page
 * of rows does not know what came before it.
 */

export type GeneralLedgerResult =
  | { status: "ok"; ledger: GeneralLedgerPage }
  /** The account is out of scope or does not exist. */
  | { status: "not-found" }
  | FetchFailure;

export type TrialBalanceResult =
  { status: "ok"; trialBalance: TrialBalance } | FetchFailure;

export type ReconciliationResult =
  { status: "ok"; report: ReconciliationReport } | FetchFailure;

export async function fetchGeneralLedger(params: {
  accountId: string;
  fromDate?: string;
  toDate?: string;
  sourceType?: string;
  page?: number;
}): Promise<GeneralLedgerResult> {
  const query = new URLSearchParams({ accountId: params.accountId });
  if (params.fromDate) query.set("fromDate", params.fromDate);
  if (params.toDate) query.set("toDate", params.toDate);
  if (params.sourceType) query.set("sourceType", params.sourceType);
  if (params.page) query.set("page", String(params.page));

  const result = await apiGetRecord<{ ledger: GeneralLedgerPage }>(
    `/accounting/ledger?${query.toString()}`,
  );

  return result.status === "ok"
    ? { status: "ok", ledger: result.data.ledger }
    : result;
}

export async function fetchTrialBalance(params?: {
  asOfDate?: string;
  fromDate?: string;
  includeZero?: boolean;
}): Promise<TrialBalanceResult> {
  const query = new URLSearchParams();
  if (params?.asOfDate) query.set("asOfDate", params.asOfDate);
  if (params?.fromDate) query.set("fromDate", params.fromDate);
  if (params?.includeZero) query.set("includeZero", "true");

  const suffix = query.toString() ? `?${query.toString()}` : "";

  const result = await apiGet<{ trialBalance: TrialBalance }>(
    `/accounting/ledger/trial-balance${suffix}`,
  );

  return result.status === "ok"
    ? { status: "ok", trialBalance: result.data.trialBalance }
    : result;
}

/**
 * Source-to-journal reconciliation.
 *
 * Both dates are required by the API: an unbounded run would scan the two
 * largest tables in the system, and "reconcile everything since inception" is
 * not a question anyone asks by accident.
 */
export async function fetchReconciliation(params: {
  fromDate: string;
  toDate: string;
  sourceType?: string;
}): Promise<ReconciliationResult> {
  const query = new URLSearchParams({
    fromDate: params.fromDate,
    toDate: params.toDate,
  });
  if (params.sourceType) query.set("sourceType", params.sourceType);

  const result = await apiGet<{ report: ReconciliationReport }>(
    `/accounting/ledger/reconciliation?${query.toString()}`,
  );

  return result.status === "ok"
    ? { status: "ok", report: result.data.report }
    : result;
}
