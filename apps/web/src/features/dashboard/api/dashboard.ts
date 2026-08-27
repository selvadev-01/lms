import "server-only";

import type { DashboardLayout, DashboardWidget } from "@lms/types";

import { apiGet, type FetchFailure } from "@/lib/api-fetch";

/**
 * Dashboard reads (Module 18).
 *
 * # One request per widget, deliberately
 *
 * The home screen fetches its layout, then one request per widget it was
 * offered. That is what makes Rule 33 real on this side too: the page fans out
 * with `Promise.allSettled`, so a widget whose request fails renders one error
 * card while its neighbours render normally.
 *
 * The obvious alternative — one request returning everything — would be fewer
 * round trips and would make per-widget Retry impossible, because there would
 * be nothing smaller than the whole screen to retry.
 *
 * # Nothing is computed here
 *
 * Every figure arrives formatted as integer paise or basis points and is only
 * ever *rendered*. No total is summed in the browser, for the reason the
 * reports feature documents: a total computed client-side is the client marking
 * its own homework.
 *
 * # Failure is never an empty payload
 *
 * `apiGet` returns a discriminated result, so a 403 or a network fault reaches
 * the page as a failure it must handle rather than as an empty object that
 * renders as zero. That is Scenario 36 enforced one layer further out.
 */

export interface DashboardFilters {
  periodType?: string;
  fromDate?: string;
  toDate?: string;
  branchId?: string;
}

/** A dashboard read either succeeded or explains why it did not. */
export type DashboardResult<T> = { status: "ok"; data: T } | FetchFailure;

function queryFrom(filters: DashboardFilters): string {
  const query = new URLSearchParams();

  if (filters.periodType) query.set("periodType", filters.periodType);
  if (filters.fromDate) query.set("fromDate", filters.fromDate);
  if (filters.toDate) query.set("toDate", filters.toDate);
  if (filters.branchId) query.set("branchId", filters.branchId);

  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

/**
 * What this user may see, and which branches they may look at.
 *
 * Fetched first so the page knows which widgets to request. It is a shopping
 * list, not an authorization: each widget re-checks its own permission when it
 * is actually requested, so a tampered layout gains nothing.
 */
export async function fetchDashboardLayout(
  filters: DashboardFilters = {},
): Promise<DashboardResult<DashboardLayout>> {
  const result = await apiGet<DashboardLayout>(
    `/dashboard/layout${queryFrom(filters)}`,
  );

  return result.status === "ok" ? { status: "ok", data: result.data } : result;
}

/** One widget's data. */
export async function fetchDashboardWidget<T>(
  widgetCode: string,
  filters: DashboardFilters = {},
): Promise<DashboardResult<DashboardWidget<T>>> {
  const result = await apiGet<DashboardWidget<T>>(
    `/dashboard/widgets/${widgetCode}${queryFrom(filters)}`,
  );

  return result.status === "ok" ? { status: "ok", data: result.data } : result;
}
