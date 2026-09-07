import "server-only";

import type {
  ApplicationReport,
  CollectionReport,
  DisbursalReport,
  FieldCollectionReport,
  FinancialReport,
  OverdueReport,
  PortfolioReport,
  ReportDashboard,
} from "@lms/types";

import { apiGet, type FetchFailure } from "@/lib/api-fetch";

/**
 * Report reads (Module 15).
 *
 * Every figure these return is computed server-side — the rows, the totals, the
 * KPI values and the derived overdue and NPA status alike. None of it is summed
 * in the browser, for the reason `features/accounting/api/ledger.ts` documents
 * one module over: a total computed client-side is the client marking its own
 * homework, and a page-local total would understate every report longer than
 * one page (Rule 35).
 *
 * The filter round-trip stays on the server too. Each screen reads its filters
 * from `searchParams` and re-renders as a server component, which is also what
 * makes Scenario 58 — a stale response must not overwrite a newer one —
 * true for free: there is no client-side request whose ordering could invert.
 */

export interface ReportFilters {
  fromDate?: string;
  toDate?: string;
  dateBasis?: string;
  branchId?: string;
  /**
   * One borrower's rows, for the customer portfolio tab.
   *
   * A filter, not a scope — the API applies org and branch confinement
   * regardless, so this can only narrow what the caller already sees.
   */
  customerId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

/** A report read either succeeded or explains why it did not. Never a silent empty list. */
export type ReportResult<T> = { status: "ok"; report: T } | FetchFailure;

function queryFrom(filters: ReportFilters): string {
  const query = new URLSearchParams();

  if (filters.fromDate) query.set("fromDate", filters.fromDate);
  if (filters.toDate) query.set("toDate", filters.toDate);
  if (filters.customerId) query.set("customerId", filters.customerId);
  if (filters.dateBasis) query.set("dateBasis", filters.dateBasis);
  if (filters.branchId) query.set("branchId", filters.branchId);
  if (filters.search) query.set("search", filters.search);
  if (filters.page) query.set("page", String(filters.page));
  if (filters.pageSize) query.set("pageSize", String(filters.pageSize));

  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

/**
 * One report read.
 *
 * Shared by all eight categories because the envelope is identical; only the
 * row type differs, which the generic carries. A per-category copy of this
 * function would be seven more places for the error handling to drift.
 */
async function fetchReport<T>(
  path: string,
  filters: ReportFilters,
): Promise<ReportResult<T>> {
  const result = await apiGet<T>(`/reports/${path}${queryFrom(filters)}`);

  return result.status === "ok"
    ? { status: "ok", report: result.data }
    : result;
}

export function fetchDashboard(
  filters: ReportFilters = {},
): Promise<ReportResult<ReportDashboard>> {
  return fetchReport<ReportDashboard>("dashboard", filters);
}

export function fetchPortfolioReport(
  filters: ReportFilters = {},
): Promise<ReportResult<PortfolioReport>> {
  return fetchReport<PortfolioReport>("portfolio", filters);
}

export function fetchApplicationReport(
  filters: ReportFilters = {},
): Promise<ReportResult<ApplicationReport>> {
  return fetchReport<ApplicationReport>("applications", filters);
}

export function fetchDisbursalReport(
  filters: ReportFilters = {},
): Promise<ReportResult<DisbursalReport>> {
  return fetchReport<DisbursalReport>("disbursals", filters);
}

export function fetchCollectionReport(
  filters: ReportFilters = {},
): Promise<ReportResult<CollectionReport>> {
  return fetchReport<CollectionReport>("collections", filters);
}

export function fetchFieldCollectionReport(
  filters: ReportFilters = {},
): Promise<ReportResult<FieldCollectionReport>> {
  return fetchReport<FieldCollectionReport>("field-collections", filters);
}

export function fetchOverdueReport(
  filters: ReportFilters = {},
): Promise<ReportResult<OverdueReport>> {
  return fetchReport<OverdueReport>("overdue-recovery", filters);
}

export function fetchFinancialReport(
  filters: ReportFilters & { accountId?: string; sourceType?: string } = {},
): Promise<ReportResult<FinancialReport>> {
  const query = new URLSearchParams(queryFrom(filters).replace(/^\?/, ""));
  if (filters.accountId) query.set("accountId", filters.accountId);
  if (filters.sourceType) query.set("sourceType", filters.sourceType);

  const suffix = query.toString();
  return fetchReport<FinancialReport>(
    `financial${suffix ? `?${suffix}` : ""}`,
    {},
  );
}
