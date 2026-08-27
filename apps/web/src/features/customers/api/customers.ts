import "server-only";

import type { CustomerProfileResponse, CustomerSummary } from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Customers & KYC data layer (Module 04).
 *
 * One aggregate read for the profile rather than four, mirroring the API: the
 * profile is a single screen with tabs, and four round trips would make them
 * load raggedly. The server still applies its scope check to each part.
 *
 * `apiGetRecord` collapses a 403 into `not-found`, which is what keeps a
 * customer id from being confirmed by the shape of the refusal (Scenarios 19,
 * 21, 30).
 */

export type CustomerListResult =
  { status: "ok"; customers: CustomerSummary[] } | FetchFailure;

export type CustomerProfileResult =
  | { status: "ok"; profile: CustomerProfileResponse }
  /** Out of scope, another tenant, or absent — deliberately indistinguishable. */
  | { status: "not-found" }
  | FetchFailure;

export interface CustomerSearch {
  search?: string;
  customerType?: "KYC" | "LOCAL";
  status?: "PENDING" | "ACTIVE" | "INACTIVE" | "BLOCKED";
  kycStatus?:
    "PENDING" | "SUBMITTED" | "REVISION_REQUIRED" | "APPROVED" | "REJECTED";
}

/**
 * Customer search (Scenarios 18-20).
 *
 * The filters are passed through as given. None of them widens anything: tenant
 * and branch confinement are applied server-side regardless of what is sent, so
 * an empty query is the *narrowest* the caller is entitled to see rather than
 * everything.
 */
export async function fetchCustomers(
  options: CustomerSearch = {},
): Promise<CustomerListResult> {
  const params = new URLSearchParams();
  if (options.search) params.set("search", options.search);
  if (options.customerType) params.set("customerType", options.customerType);
  if (options.status) params.set("status", options.status);
  if (options.kycStatus) params.set("kycStatus", options.kycStatus);
  const query = params.size > 0 ? `?${params.toString()}` : "";

  const result = await apiGet<{ customers: CustomerSummary[] }>(
    `/customers${query}`,
  );

  return result.status === "ok"
    ? { status: "ok", customers: result.data.customers }
    : result;
}

/** The profile screen's aggregate read — customer, KYC, documents, guarantors. */
export async function fetchCustomerProfile(
  customerId: string,
): Promise<CustomerProfileResult> {
  const result = await apiGetRecord<CustomerProfileResponse>(
    `/customers/${encodeURIComponent(customerId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", profile: result.data }
    : result;
}
