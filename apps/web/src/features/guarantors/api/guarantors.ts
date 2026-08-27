import "server-only";

import type {
  GuarantorProfileResponse,
  GuarantorReadiness,
  GuarantorSummary,
} from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Guarantor directory data layer (Module 05, GUA-001/GUA-002).
 *
 * Reads only. Every guarantor mutation stays on the customer-nested routes in
 * `features/customers/actions/guarantor-actions.ts`, because a guarantor's
 * customer relationship is what defines its scope — see the API's
 * `GuarantorDirectoryService` for why a top-level write would weaken that.
 *
 * `apiGetRecord` collapses a 403 into `not-found`, which is what keeps a
 * guarantor id from being confirmed by the shape of the refusal (Scenario 5).
 */

export type GuarantorListResult =
  { status: "ok"; guarantors: GuarantorSummary[] } | FetchFailure;

export type GuarantorProfileResult =
  | { status: "ok"; profile: GuarantorProfileResponse }
  /** Out of scope, another tenant, or absent — deliberately indistinguishable. */
  | { status: "not-found" }
  | FetchFailure;

export type GuarantorReadinessResult =
  { status: "ok"; readiness: GuarantorReadiness } | FetchFailure;

export interface GuarantorSearch {
  search?: string;
  status?: "ACTIVE" | "INACTIVE";
  kycStatus?:
    | "NOT_REQUIRED"
    | "PENDING"
    | "SUBMITTED"
    | "REVISION_REQUIRED"
    | "APPROVED"
    | "REJECTED";
  consentStatus?: "PENDING" | "GIVEN" | "REJECTED";
  customerId?: string;
}

/**
 * Guarantor search (Scenario 1).
 *
 * The filters are passed through as given. None of them widens anything: tenant
 * and branch confinement are applied server-side regardless of what is sent, so
 * an empty query is the *narrowest* the caller is entitled to see rather than
 * everything.
 */
export async function fetchGuarantors(
  options: GuarantorSearch = {},
): Promise<GuarantorListResult> {
  const params = new URLSearchParams();
  if (options.search) params.set("search", options.search);
  if (options.status) params.set("status", options.status);
  if (options.kycStatus) params.set("kycStatus", options.kycStatus);
  if (options.consentStatus) params.set("consentStatus", options.consentStatus);
  if (options.customerId) params.set("customerId", options.customerId);
  const query = params.size > 0 ? `?${params.toString()}` : "";

  const result = await apiGet<{ guarantors: GuarantorSummary[] }>(
    `/guarantors${query}`,
  );

  return result.status === "ok"
    ? { status: "ok", guarantors: result.data.guarantors }
    : result;
}

/** The detail screen's aggregate read — guarantor, customer and documents. */
export async function fetchGuarantorProfile(
  guarantorId: string,
): Promise<GuarantorProfileResult> {
  const result = await apiGetRecord<GuarantorProfileResponse>(
    `/guarantors/${encodeURIComponent(guarantorId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", profile: result.data }
    : result;
}

/**
 * The loan-application guarantor gate (Scenarios 41-43).
 *
 * `readiness.required` is always null — whether a guarantor is needed at all is
 * a loan-product rule that does not exist yet. This answers only whether the
 * guarantors that *do* exist are usable.
 */
export async function fetchGuarantorReadiness(
  customerId: string,
): Promise<GuarantorReadinessResult> {
  const result = await apiGet<GuarantorReadiness>(
    `/customers/${encodeURIComponent(customerId)}/guarantors/readiness`,
  );

  return result.status === "ok"
    ? { status: "ok", readiness: result.data }
    : result;
}
