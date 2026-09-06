import "server-only";

import type {
  AllocationPreview,
  CollectionDetail,
  CollectionReadiness,
  CollectionSummary,
  LedgerEntryDetail,
} from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * EMI collection data layer (Module 11).
 *
 * Follows `features/disbursements/api/disbursements.ts` exactly, including the
 * two properties that matter for a financial surface:
 *
 * `apiGetRecord` collapses a 403 into `not-found`, so a collection id cannot be
 * confirmed to exist by the shape of the refusal (Scenarios 1, 4, 38). The API
 * already returns 404 rather than 403 for out-of-scope rows; this keeps the
 * client from reintroducing the distinction.
 *
 * Nothing here filters by branch. Confinement is applied server-side regardless
 * of what is sent — there is no `branchId` parameter to send — so an unfiltered
 * request returns the *narrowest* set the caller is entitled to.
 */

export type CollectionListResult =
  | { status: "ok"; collections: CollectionSummary[]; total: number }
  | FetchFailure;

export type CollectionDetailResult =
  | { status: "ok"; collection: CollectionDetail }
  /** Out of scope, another tenant, or absent — deliberately indistinguishable. */
  | { status: "not-found" }
  | FetchFailure;

export type CollectionReadinessResult =
  | { status: "ok"; readiness: CollectionReadiness }
  | { status: "not-found" }
  | FetchFailure;

/**
 * `not-found` here means "not posted yet" as often as it means "no such
 * collection" — the endpoint 404s until a ledger entry exists. The detail page
 * treats both the same way: no panel.
 */
export type CollectionLedgerResult =
  | { status: "ok"; entry: LedgerEntryDetail }
  | { status: "not-found" }
  | FetchFailure;

export type CollectionPreviewResult =
  { status: "ok"; preview: AllocationPreview } | FetchFailure;

/**
 * The API's own default, mirrored so the page's control matches what the
 * server returned. Until `page` was forwarded, the list showed the first 20
 * rows of a larger set with no sign there were more — `total` came back and
 * was discarded.
 */
export const COLLECTIONS_PAGE_SIZE = 20;

export async function fetchCollections(params?: {
  search?: string;
  status?: string;
  loanId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}): Promise<CollectionListResult> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.status) query.set("status", params.status);
  if (params?.loanId) query.set("loanId", params.loanId);
  if (params?.fromDate) query.set("fromDate", params.fromDate);
  if (params?.toDate) query.set("toDate", params.toDate);
  if (params?.page && params.page > 1) query.set("page", String(params.page));
  if (params?.pageSize) query.set("pageSize", String(params.pageSize));

  const suffix = query.toString() ? `?${query.toString()}` : "";

  const result = await apiGet<{
    collections: CollectionSummary[];
    total: number;
  }>(`/loans/collections${suffix}`);

  return result.status === "ok"
    ? {
        status: "ok",
        collections: result.data.collections,
        total: result.data.total,
      }
    : result;
}

export async function fetchCollection(
  collectionId: string,
): Promise<CollectionDetailResult> {
  const result = await apiGetRecord<CollectionDetail>(
    `/loans/collections/${encodeURIComponent(collectionId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", collection: result.data }
    : result;
}

/**
 * What a loan owes, and whether it can be collected against.
 *
 * Advisory only. The post endpoint re-runs every one of these gates inside its
 * own transaction against a fresh read of the loan, so a blocker that appears
 * between this read and the posting is still caught (Scenarios 29, 44).
 *
 * The exact `totalOutstandingPaise` here is what a "pay in full" action must
 * tender: overpayment is refused with a 400, so a rounded rupee figure would
 * bounce.
 */
export async function fetchCollectionReadiness(
  loanId: string,
): Promise<CollectionReadinessResult> {
  const result = await apiGetRecord<CollectionReadiness>(
    `/loans/collections/readiness?loanId=${encodeURIComponent(loanId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", readiness: result.data }
    : result;
}

export async function fetchCollectionLedger(
  collectionId: string,
): Promise<CollectionLedgerResult> {
  const result = await apiGetRecord<LedgerEntryDetail>(
    `/loans/collections/${encodeURIComponent(collectionId)}/ledger`,
  );

  return result.status === "ok" ? { status: "ok", entry: result.data } : result;
}

/** Every collection taken against one loan, newest first. */
export async function fetchLoanCollections(
  loanId: string,
): Promise<CollectionListResult> {
  const result = await apiGet<{ collections: CollectionSummary[] }>(
    `/loans/${encodeURIComponent(loanId)}/collections`,
  );

  return result.status === "ok"
    ? {
        status: "ok",
        collections: result.data.collections,
        total: result.data.collections.length,
      }
    : result;
}
