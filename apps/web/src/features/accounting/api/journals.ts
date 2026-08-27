import "server-only";

import type { JournalDetail, JournalSummary } from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Journal data layer (Module 14).
 *
 * Nothing here filters by branch. Confinement is applied server-side regardless
 * of what is sent — there is no `branchId` parameter to send — so an unfiltered
 * request returns the *narrowest* set the caller is entitled to rather than the
 * widest.
 */

export type JournalListResult =
  { status: "ok"; journals: JournalSummary[]; total: number } | FetchFailure;

export type JournalDetailResult =
  | { status: "ok"; journal: JournalDetail }
  | { status: "not-found" }
  | FetchFailure;

export async function fetchJournals(params?: {
  search?: string;
  status?: string;
  entryType?: string;
  sourceType?: string;
  accountId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<JournalListResult> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.status) query.set("status", params.status);
  if (params?.entryType) query.set("entryType", params.entryType);
  if (params?.sourceType) query.set("sourceType", params.sourceType);
  if (params?.accountId) query.set("accountId", params.accountId);
  if (params?.fromDate) query.set("fromDate", params.fromDate);
  if (params?.toDate) query.set("toDate", params.toDate);

  const suffix = query.toString() ? `?${query.toString()}` : "";

  const result = await apiGet<{ journals: JournalSummary[]; total: number }>(
    `/accounting/journals${suffix}`,
  );

  return result.status === "ok"
    ? { status: "ok", journals: result.data.journals, total: result.data.total }
    : result;
}

export async function fetchJournal(
  journalEntryId: string,
): Promise<JournalDetailResult> {
  const result = await apiGetRecord<{ journal: JournalDetail }>(
    `/accounting/journals/${encodeURIComponent(journalEntryId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", journal: result.data.journal }
    : result;
}
