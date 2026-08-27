import "server-only";

import type { SavedReportDetail, SavedReportListResult } from "@lms/types";

import {
  apiGet,
  apiGetRecord,
  type FetchFailure,
  type RecordResult,
} from "@/lib/api-fetch";

/**
 * Saved report definition reads (Module 15).
 *
 * A saved report is a stored filter set, not a stored result — running one
 * re-resolves the caller's scope against their live authorization, so a
 * definition saved by an organization-wide user and opened by a branch user
 * yields that branch's rows (Rules 4, 27; Scenario 43).
 */

export type SavedReportListing =
  { status: "ok"; result: SavedReportListResult } | FetchFailure;

export type SavedReportRecord = RecordResult<SavedReportDetail>;

export async function fetchSavedReports(params: {
  status?: string;
  search?: string;
  page?: number;
}): Promise<SavedReportListing> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  if (params.page) query.set("page", String(params.page));

  const suffix = query.toString();
  const result = await apiGet<SavedReportListResult>(
    `/reports/saved${suffix ? `?${suffix}` : ""}`,
  );

  return result.status === "ok"
    ? { status: "ok", result: result.data }
    : result;
}

/**
 * One saved definition.
 *
 * `apiGetRecord` collapses 403 and 404 into the same `not-found`, which is what
 * keeps another user's private definition unenumerable by id — the same
 * property the API's own opaque `NOT_REACHABLE` message provides.
 */
export function fetchSavedReport(
  reportDefinitionId: string,
): Promise<SavedReportRecord> {
  return apiGetRecord<SavedReportDetail>(
    `/reports/saved/${reportDefinitionId}`,
  );
}
