import "server-only";

import type {
  AgentCashBalance,
  CashHandoverDetail,
  CashHandoverReadiness,
  CashHandoverSummary,
  CashReconciliationDetail,
  CashReconciliationSummary,
} from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Cash custody data layer (Module 12).
 *
 * Two reads here return figures the server *derives* rather than stores — the
 * agent balances and the handover readiness. Neither is cached: an expected
 * cash balance read from a stale page and acted on is exactly the stale figure
 * the handover transaction re-derives to protect against. `apiGet` already
 * sends `cache: "no-store"`, so this is inherited rather than restated, but it
 * is the reason not to add caching here later.
 */

export type CashHandoverListResult =
  | { status: "ok"; handovers: CashHandoverSummary[]; total: number }
  | FetchFailure;

export type CashHandoverDetailResult =
  | { status: "ok"; handover: CashHandoverDetail }
  | { status: "not-found" }
  | FetchFailure;

export type CashHandoverReadinessResult =
  | { status: "ok"; readiness: CashHandoverReadiness }
  | { status: "not-found" }
  | FetchFailure;

export type AgentCashBalancesResult =
  { status: "ok"; agents: AgentCashBalance[] } | FetchFailure;

export type CashReconciliationListResult =
  | {
      status: "ok";
      reconciliations: CashReconciliationSummary[];
      total: number;
    }
  | FetchFailure;

export type CashReconciliationDetailResult =
  | { status: "ok"; reconciliation: CashReconciliationDetail }
  | { status: "not-found" }
  | FetchFailure;

export async function fetchCashHandovers(params?: {
  search?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<CashHandoverListResult> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.status) query.set("status", params.status);
  if (params?.fromDate) query.set("fromDate", params.fromDate);
  if (params?.toDate) query.set("toDate", params.toDate);

  const suffix = query.toString() ? `?${query.toString()}` : "";

  const result = await apiGet<{
    items: CashHandoverSummary[];
    total: number;
  }>(`/field/cash-handovers${suffix}`);

  return result.status === "ok"
    ? { status: "ok", handovers: result.data.items, total: result.data.total }
    : result;
}

export async function fetchCashHandover(
  handoverId: string,
): Promise<CashHandoverDetailResult> {
  const result = await apiGetRecord<CashHandoverDetail>(
    `/field/cash-handovers/${encodeURIComponent(handoverId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", handover: result.data }
    : result;
}

/**
 * What the calling agent can hand over right now.
 *
 * Advisory: the same checks run authoritatively inside the create and receive
 * transactions against a re-derived balance. This exists so the form can refuse
 * early and explain why, not so a mutation can trust it.
 */
export async function fetchCashHandoverReadiness(): Promise<CashHandoverReadinessResult> {
  const result = await apiGetRecord<CashHandoverReadiness>(
    "/field/cash-handovers/readiness",
  );

  return result.status === "ok"
    ? { status: "ok", readiness: result.data }
    : result;
}

/**
 * Every agent in scope holding cash — the branch's work list.
 *
 * Gated on the receive permission at the API, so an agent calling this is
 * refused: what a colleague is carrying is none of their business.
 */
export async function fetchAgentCashBalances(): Promise<AgentCashBalancesResult> {
  const result = await apiGet<AgentCashBalance[]>(
    "/field/cash-handovers/agents",
  );

  return result.status === "ok"
    ? { status: "ok", agents: result.data }
    : result;
}

export async function fetchCashReconciliations(params?: {
  search?: string;
  status?: string;
  discrepancyType?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<CashReconciliationListResult> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.status) query.set("status", params.status);
  if (params?.discrepancyType) {
    query.set("discrepancyType", params.discrepancyType);
  }
  if (params?.fromDate) query.set("fromDate", params.fromDate);
  if (params?.toDate) query.set("toDate", params.toDate);

  const suffix = query.toString() ? `?${query.toString()}` : "";

  const result = await apiGet<{
    items: CashReconciliationSummary[];
    total: number;
  }>(`/field/cash-reconciliations${suffix}`);

  return result.status === "ok"
    ? {
        status: "ok",
        reconciliations: result.data.items,
        total: result.data.total,
      }
    : result;
}

export async function fetchCashReconciliation(
  reconciliationId: string,
): Promise<CashReconciliationDetailResult> {
  const result = await apiGetRecord<CashReconciliationDetail>(
    `/field/cash-reconciliations/${encodeURIComponent(reconciliationId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", reconciliation: result.data }
    : result;
}
