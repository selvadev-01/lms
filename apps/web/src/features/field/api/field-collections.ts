import "server-only";

import type { FieldCollectionDetail, FieldCollectionSummary } from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Field collection data layer (Module 12).
 *
 * Follows `features/collections/api/collections.ts` exactly, including the two
 * properties that matter for a financial surface:
 *
 * `apiGetRecord` collapses a 403 into `not-found`, so a collection id cannot be
 * confirmed to exist by the shape of the refusal (Scenarios 45, 47). The API
 * already returns 404 rather than 403 for out-of-scope rows; this keeps the
 * client from reintroducing the distinction.
 *
 * Nothing here filters by branch **or by agent**. Both confinements are applied
 * server-side regardless of what is sent — there is no `branchId` or
 * `fieldAgentId` parameter to send — so an unfiltered request returns the
 * *narrowest* set the caller is entitled to. A Field Employee asking for "all
 * field collections" gets their own (Scenario 2).
 */

export type FieldCollectionListResult =
  | { status: "ok"; collections: FieldCollectionSummary[]; total: number }
  | FetchFailure;

export type FieldCollectionDetailResult =
  | { status: "ok"; collection: FieldCollectionDetail }
  /** Out of scope, another agent's, another tenant's, or absent. */
  | { status: "not-found" }
  | FetchFailure;

export async function fetchFieldCollections(params?: {
  search?: string;
  status?: string;
  paymentMode?: string;
  gpsCaptureStatus?: string;
  awaitingHandover?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<FieldCollectionListResult> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.status) query.set("status", params.status);
  if (params?.paymentMode) query.set("paymentMode", params.paymentMode);
  if (params?.gpsCaptureStatus) {
    query.set("gpsCaptureStatus", params.gpsCaptureStatus);
  }
  // Only ever sent as the literal "true": the API compares against the string
  // rather than testing truthiness, because a query parameter is text and
  // "false" is truthy.
  if (params?.awaitingHandover === "true") {
    query.set("awaitingHandover", "true");
  }
  if (params?.fromDate) query.set("fromDate", params.fromDate);
  if (params?.toDate) query.set("toDate", params.toDate);

  const suffix = query.toString() ? `?${query.toString()}` : "";

  const result = await apiGet<{
    items: FieldCollectionSummary[];
    total: number;
  }>(`/field/collections${suffix}`);

  return result.status === "ok"
    ? {
        status: "ok",
        collections: result.data.items,
        total: result.data.total,
      }
    : result;
}

export async function fetchFieldCollection(
  collectionId: string,
): Promise<FieldCollectionDetailResult> {
  const result = await apiGetRecord<FieldCollectionDetail>(
    `/field/collections/${encodeURIComponent(collectionId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", collection: result.data }
    : result;
}
