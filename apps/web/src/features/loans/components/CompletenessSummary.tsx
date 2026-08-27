import type { ApplicationCompleteness, CompletenessCheck } from "@lms/types";

/**
 * Wizard step 6's validation summary.
 *
 * Every check is rendered, satisfied or not, because the API always returns all
 * nine in a fixed order. A list that showed only failures would change shape as
 * problems were fixed, and a clerk working down it would lose their place.
 *
 * The copy lives here rather than on the server. The API returns machine-
 * readable reasons (`DOCUMENTS_MISSING`, `TERM_NOT_OFFERED`) so that its
 * contract does not change every time the wording is improved.
 */

const CHECK_LABEL: Record<string, string> = {
  CUSTOMER_ACTIVE: "Customer is active",
  SCHEME_ACTIVE: "Loan scheme is available",
  DURATION_SUPPORTED: "Scheme offers this duration",
  AMOUNT_VALID: "Loan amount is valid",
  PURPOSE_PRESENT: "Purpose is recorded",
  RATE_VALID: "Interest rate is permitted",
  GUARANTORS_READY: "Guarantors are ready",
  DOCUMENTS_COMPLETE: "Required documents attached",
  EMI_COMPUTES: "Repayment schedule calculates",
};

/** Why a check failed, phrased as something the reader can act on. */
function explain(check: CompletenessCheck): string {
  switch (check.reason) {
    case "CUSTOMER_NOT_ACTIVE":
      return "This customer is not active. Reactivate them before continuing.";
    case "SCHEME_NOT_FOUND":
      return "The selected scheme no longer exists. Choose another.";
    case "PRODUCT_INACTIVE":
      return "The loan product has been withdrawn. Choose a scheme under an active product.";
    case "SCHEME_INACTIVE":
      return "This scheme has been withdrawn and cannot be used for new applications.";
    case "TERM_NOT_OFFERED": {
      const details = check.details as
        { frequency?: string; durationCount?: number } | undefined;
      return details
        ? `The scheme does not offer ${details.durationCount} ${String(details.frequency ?? "").toLowerCase()} periods. Choose a different duration.`
        : "The scheme does not offer the selected duration.";
    }
    case "AMOUNT_NOT_POSITIVE":
      return "Enter a loan amount greater than zero.";
    case "PURPOSE_MISSING":
      return "Record what the loan is for.";
    case "RATE_NEGATIVE":
      return "The interest rate cannot be negative.";
    case "RATE_DIFFERS_FROM_SCHEME":
      return "The rate differs from the scheme's. Use the Custom Rate interest type, which requires additional permission.";
    case "GUARANTOR_NOT_READY":
      return "A guarantor is inactive, has not consented, or has incomplete KYC.";
    case "DOCUMENTS_MISSING": {
      const details = check.details as { missing?: string[] } | undefined;
      return details?.missing?.length
        ? `Still needed: ${details.missing.join(", ")}.`
        : "Required documents are missing.";
    }
    default:
      // An unrecognised reason still says something true rather than nothing.
      // The API may add reasons this build has never seen.
      return check.reason
        ? `This check did not pass (${check.reason}).`
        : "This check did not pass.";
  }
}

export default function CompletenessSummary({
  completeness,
}: {
  completeness: ApplicationCompleteness;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
          Validation Summary
        </h3>
        <span
          className={
            completeness.submittable
              ? "text-success-600 dark:text-success-500 text-sm font-medium"
              : "text-warning-600 dark:text-warning-500 text-sm font-medium"
          }
        >
          {completeness.submittable ? "Ready to submit" : "Not ready"}
        </span>
      </div>

      <ul className="divide-y divide-gray-200 rounded-2xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {completeness.checks.map((check) => (
          <li key={check.key} className="flex gap-3 px-4 py-3">
            <span
              aria-hidden="true"
              className={
                check.satisfied
                  ? "text-success-500 mt-0.5 shrink-0"
                  : "text-error-500 mt-0.5 shrink-0"
              }
            >
              {check.satisfied ? "✓" : "✕"}
            </span>
            <div className="min-w-0">
              <p className="text-sm text-gray-800 dark:text-white/90">
                {CHECK_LABEL[check.key] ?? check.key}
                {/* The icon is aria-hidden, so the state is carried in text for
                    anyone who cannot see the colour or the glyph. */}
                <span className="sr-only">
                  {check.satisfied ? " — passed" : " — not passed"}
                </span>
              </p>
              {!check.satisfied && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {explain(check)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!completeness.submittable && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Submission is blocked until every check passes. The server re-runs all
          of them when you submit, so a scheme withdrawn in the meantime is
          still caught.
        </p>
      )}
    </section>
  );
}
