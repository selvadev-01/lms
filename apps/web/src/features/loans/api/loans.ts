import "server-only";

import type {
  ApplicationCompleteness,
  ApprovalReadiness,
  CreditAssessmentHistory,
  LoanApplicationDetail,
  LoanApplicationDocumentSummary,
  LoanApplicationHistoryEntry,
  LoanApplicationSummary,
  LoanProductDetail,
  LoanProductSummary,
  LoanSchemeDetail,
  LoanSchemeSummary,
  LoanSummaryView,
  RepaymentScheduleView,
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

/**
 * The loans in scope, optionally for one customer.
 *
 * Returns `[]` on failure rather than an error shape: the caller is a panel
 * beside other panels on the customer screen, and a failed loan read must not
 * take down a page whose main subject is the customer.
 */
export async function fetchLoans(
  options: { customerId?: string } = {},
): Promise<LoanSummaryView[]> {
  const params = new URLSearchParams();
  if (options.customerId) params.set("customerId", options.customerId);
  const query = params.size > 0 ? `?${params.toString()}` : "";

  const result = await apiGet<{ loans: LoanSummaryView[] }>(`/loans${query}`);

  return result.status === "ok" ? result.data.loans : [];
}

/**
 * One loan, or null.
 *
 * There is no `GET /loans/:loanId` — `LoanService` exposes `findInScope` to
 * other modules and a list to the portfolio. This asks the list for the single
 * row, which is already scoped and already mapped.
 *
 * **`customerId` is not enough to find it.** The list is capped at the newest
 * 100 rows, so filtering only by customer silently misses an older loan — a bug
 * I shipped and caught in the browser, where the page 404'd on a loan that
 * plainly existed. The loan number filter narrows to the one row instead.
 */
export async function fetchLoan(
  loanId: string,
): Promise<LoanSummaryView | null> {
  const result = await apiGet<{ loans: LoanSummaryView[] }>(
    `/loans?loanId=${encodeURIComponent(loanId)}`,
  );

  if (result.status !== "ok") return null;

  // Defended rather than trusted: if the filter were ever dropped server-side
  // this would still return the right loan instead of an arbitrary one.
  return result.data.loans.find((loan) => loan.loanId === loanId) ?? null;
}

/**
 * A loan's active repayment schedule.
 *
 * Distinct from `fetchRepaymentSchedule` in the disbursements feature, which is
 * keyed by `disbursementId` and answers "what did this disbursal generate". This
 * is keyed by the loan and answers "what does this loan owe now" — the same
 * question from the other side, and the one a loan page asks.
 */
export async function fetchLoanSchedule(
  loanId: string,
): Promise<RepaymentScheduleView | null> {
  // `apiGetRecord`, not `apiGet`: a loan that has not been disbursed has no
  // schedule, and the API says so with a 404. That is an ordinary answer here,
  // not a failure — `apiGet` logs every non-2xx, so a customer with undisbursed
  // loans filled the console with errors describing normal state.
  const result = await apiGetRecord<RepaymentScheduleView>(
    `/loans/${encodeURIComponent(loanId)}/repayment-schedule`,
  );

  // Null rather than an error shape: this is one panel among several on the loan
  // page, and a caller without `loans.schedules.view` should see the rest of the
  // loan rather than a broken screen.
  return result.status === "ok" ? result.data : null;
}

/**
 * Documents this customer filed on their *other* applications.
 *
 * Empty for a first-time borrower, which is the common case — the caller renders
 * nothing rather than an empty panel.
 */
export async function fetchReusableDocuments(
  applicationId: string,
): Promise<LoanApplicationDocumentSummary[]> {
  const result = await apiGet<{ documents: LoanApplicationDocumentSummary[] }>(
    `/loan-applications/${encodeURIComponent(applicationId)}/documents/reusable`,
  );

  // A failed read means "offer nothing to reuse", never a broken screen: this is
  // a convenience beside a working file picker, so it must not be able to take
  // the page down with it.
  return result.status === "ok" ? result.data.documents : [];
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
