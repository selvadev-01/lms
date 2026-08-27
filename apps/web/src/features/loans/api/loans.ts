import "server-only";

import type {
  ApplicationCompleteness,
  ApprovalReadiness,
  CreditAssessmentHistory,
  LoanApplicationDetail,
  LoanApplicationHistoryEntry,
  LoanApplicationSummary,
  LoanProductDetail,
  LoanProductSummary,
  LoanSchemeDetail,
  LoanSchemeSummary,
  SanctionLetterDetail,
} from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Loan products, schemes and applications data layer (Modules 06-07).
 *
 * `apiGetRecord` collapses a 403 into `not-found`, which is what keeps an
 * application id from being confirmed by the shape of the refusal (Scenarios
 * 3, 4).
 *
 * Nothing here filters. Tenant and branch confinement are applied server-side
 * regardless of what is sent, so an empty query returns the *narrowest* set the
 * caller is entitled to rather than everything.
 */

export type LoanProductListResult =
  { status: "ok"; products: LoanProductSummary[] } | FetchFailure;

export type LoanProductDetailResult =
  | { status: "ok"; product: LoanProductDetail }
  | { status: "not-found" }
  | FetchFailure;

export type LoanSchemeListResult =
  { status: "ok"; schemes: LoanSchemeSummary[] } | FetchFailure;

export type LoanSchemeDetailResult =
  | { status: "ok"; scheme: LoanSchemeDetail }
  | { status: "not-found" }
  | FetchFailure;

export type ApplicationListResult =
  { status: "ok"; applications: LoanApplicationSummary[] } | FetchFailure;

export type ApplicationDetailResult =
  | { status: "ok"; application: LoanApplicationDetail }
  /** Out of scope, another tenant, or absent — deliberately indistinguishable. */
  | { status: "not-found" }
  | FetchFailure;

export type CompletenessResult =
  | { status: "ok"; completeness: ApplicationCompleteness }
  | { status: "not-found" }
  | FetchFailure;

export type HistoryResult =
  { status: "ok"; history: LoanApplicationHistoryEntry[] } | FetchFailure;

/**
 * A caller without `assessment.view` gets `not-found`, indistinguishable from
 * an application that has never been assessed. That is deliberate and matters
 * more here than elsewhere: a CIBIL score must not be confirmed to exist by the
 * shape of the refusal.
 */
export type CreditAssessmentResult =
  | { status: "ok"; assessments: CreditAssessmentHistory }
  | { status: "not-found" }
  | FetchFailure;

export type SanctionLetterResult =
  | { status: "ok"; sanction: SanctionLetterDetail }
  /** No letter issued yet, or out of scope — deliberately the same answer. */
  | { status: "not-found" }
  | FetchFailure;

export type ApprovalReadinessResult =
  | { status: "ok"; readiness: ApprovalReadiness }
  | { status: "not-found" }
  | FetchFailure;

export async function fetchLoanProducts(
  options: { status?: string; loanType?: string } = {},
): Promise<LoanProductListResult> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.loanType) params.set("loanType", options.loanType);
  const query = params.size > 0 ? `?${params.toString()}` : "";

  const result = await apiGet<{ products: LoanProductSummary[] }>(
    `/loan-products${query}`,
  );

  return result.status === "ok"
    ? { status: "ok", products: result.data.products }
    : result;
}

export async function fetchLoanProduct(
  productId: string,
): Promise<LoanProductDetailResult> {
  const result = await apiGetRecord<LoanProductDetail>(
    `/loan-products/${encodeURIComponent(productId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", product: result.data }
    : result;
}

/**
 * Scheme list.
 *
 * `selectable` is what the wizard's step 3 picker uses: it returns only schemes
 * an application may actually be created against — ACTIVE, under an ACTIVE
 * product, with at least one active duration option (Rule 7, Scenario 10).
 *
 * It is a convenience, not a security control. Submit re-checks all three
 * conditions inside its own transaction, so a scheme deactivated between the
 * picker and the submit is still refused (Rule 72).
 */
export async function fetchLoanSchemes(
  options: { productId?: string; status?: string; selectable?: boolean } = {},
): Promise<LoanSchemeListResult> {
  const params = new URLSearchParams();
  if (options.productId) params.set("productId", options.productId);
  if (options.status) params.set("status", options.status);
  if (options.selectable) params.set("selectable", "true");
  const query = params.size > 0 ? `?${params.toString()}` : "";

  const result = await apiGet<{ schemes: LoanSchemeSummary[] }>(
    `/loan-schemes${query}`,
  );

  return result.status === "ok"
    ? { status: "ok", schemes: result.data.schemes }
    : result;
}

export async function fetchLoanScheme(
  schemeId: string,
): Promise<LoanSchemeDetailResult> {
  const result = await apiGetRecord<LoanSchemeDetail>(
    `/loan-schemes/${encodeURIComponent(schemeId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", scheme: result.data }
    : result;
}

export interface ApplicationSearch {
  search?: string;
  status?: string;
  customerId?: string;
  fromDate?: string;
  toDate?: string;
}

export async function fetchLoanApplications(
  options: ApplicationSearch = {},
): Promise<ApplicationListResult> {
  const params = new URLSearchParams();
  if (options.search) params.set("search", options.search);
  if (options.status) params.set("status", options.status);
  if (options.customerId) params.set("customerId", options.customerId);
  if (options.fromDate) params.set("fromDate", options.fromDate);
  if (options.toDate) params.set("toDate", options.toDate);
  const query = params.size > 0 ? `?${params.toString()}` : "";

  const result = await apiGet<{ applications: LoanApplicationSummary[] }>(
    `/loan-applications${query}`,
  );

  return result.status === "ok"
    ? { status: "ok", applications: result.data.applications }
    : result;
}

/** The detail screen's read — terms, documents and the recomputed EMI. */
export async function fetchLoanApplication(
  applicationId: string,
): Promise<ApplicationDetailResult> {
  const result = await apiGetRecord<LoanApplicationDetail>(
    `/loan-applications/${encodeURIComponent(applicationId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", application: result.data }
    : result;
}

/**
 * Wizard step 6's validation summary.
 *
 * Advisory only. `submittable: true` here does not guarantee the submit will
 * succeed — the server re-runs every check inside the submitting transaction.
 */
export async function fetchCompleteness(
  applicationId: string,
): Promise<CompletenessResult> {
  const result = await apiGetRecord<ApplicationCompleteness>(
    `/loan-applications/${encodeURIComponent(applicationId)}/completeness`,
  );

  return result.status === "ok"
    ? { status: "ok", completeness: result.data }
    : result;
}

/** The append-only review and terms-change history, oldest first (Scenario 60). */
export async function fetchApplicationHistory(
  applicationId: string,
): Promise<HistoryResult> {
  const result = await apiGet<{ history: LoanApplicationHistoryEntry[] }>(
    `/loan-applications/${encodeURIComponent(applicationId)}/history`,
  );

  return result.status === "ok"
    ? { status: "ok", history: result.data.history }
    : result;
}

/** The current credit assessment and every superseded one (Scenario 7). */
export async function fetchCreditAssessment(
  applicationId: string,
): Promise<CreditAssessmentResult> {
  const result = await apiGetRecord<CreditAssessmentHistory>(
    `/loan-applications/${encodeURIComponent(applicationId)}/credit-assessment`,
  );

  return result.status === "ok"
    ? { status: "ok", assessments: result.data }
    : result;
}

/** The issued sanction letter, or `not-found` when none has been issued. */
export async function fetchSanctionLetter(
  applicationId: string,
): Promise<SanctionLetterResult> {
  const result = await apiGetRecord<SanctionLetterDetail>(
    `/loan-applications/${encodeURIComponent(applicationId)}/sanction`,
  );

  return result.status === "ok"
    ? { status: "ok", sanction: result.data }
    : result;
}

/**
 * What is still standing between an application and approval (Scenarios 6, 13).
 *
 * Advisory, like `fetchCompleteness`: `approvable: true` here does not
 * guarantee the approval will succeed, because the server re-runs every gate
 * inside the approving transaction — twice.
 */
export async function fetchApprovalReadiness(
  applicationId: string,
): Promise<ApprovalReadinessResult> {
  const result = await apiGetRecord<ApprovalReadiness>(
    `/loan-applications/${encodeURIComponent(applicationId)}/approval-readiness`,
  );

  return result.status === "ok"
    ? { status: "ok", readiness: result.data }
    : result;
}
