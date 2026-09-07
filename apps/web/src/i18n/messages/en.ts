/**
 * English instruction copy. The source of truth for the key set.
 *
 * Flat dotted keys rather than nested objects, for two reasons that both bite
 * immediately if reversed:
 *
 *  - `keyof typeof en` gives the exhaustive key union in one line. Nesting
 *    needs a recursive mapped type to flatten, and the errors it produces on a
 *    missing translation are unreadable.
 *  - Keys built at runtime — `loans.completeness.label.${check.key}` — check
 *    against a flat string union. Against a nested type they do not.
 *
 * Placeholders are named (`{count}`), never positional. Tamil is subject-object-
 * verb where English is subject-verb-object, so a translated sentence routinely
 * puts its arguments in a different order. Positional slots cannot express that.
 *
 * Key naming mirrors the source tree, and for enum-keyed copy the enum value is
 * the last segment — which lets a lookup table like CHECK_LABEL disappear into
 * a template-literal key.
 */
export const en = {
  // features/loans/components/CompletenessSummary.tsx — check names
  "loans.completeness.label.CUSTOMER_ACTIVE": "Customer is active",
  "loans.completeness.label.SCHEME_ACTIVE": "Loan scheme is available",
  "loans.completeness.label.DURATION_SUPPORTED": "Scheme offers this duration",
  "loans.completeness.label.AMOUNT_VALID": "Loan amount is valid",
  "loans.completeness.label.PURPOSE_PRESENT": "Purpose is recorded",
  "loans.completeness.label.RATE_VALID": "Interest rate is permitted",
  "loans.completeness.label.GUARANTORS_READY": "Guarantors are ready",
  "loans.completeness.label.DOCUMENTS_COMPLETE": "Required documents attached",
  "loans.completeness.label.EMI_COMPUTES": "Repayment schedule calculates",

  // ...and why each one failed, phrased as something the reader can act on.
  "loans.completeness.reason.CUSTOMER_NOT_ACTIVE":
    "This customer is not active. Reactivate them before continuing.",
  "loans.completeness.reason.SCHEME_NOT_FOUND":
    "The selected scheme no longer exists. Choose another.",
  "loans.completeness.reason.PRODUCT_INACTIVE":
    "The loan product has been withdrawn. Choose a scheme under an active product.",
  "loans.completeness.reason.SCHEME_INACTIVE":
    "This scheme has been withdrawn and cannot be used for new applications.",
  "loans.completeness.reason.TERM_NOT_OFFERED":
    "The scheme does not offer {count} {frequency} periods. Choose a different duration.",
  "loans.completeness.reason.TERM_NOT_OFFERED_GENERIC":
    "The scheme does not offer the selected duration.",
  "loans.completeness.reason.AMOUNT_NOT_POSITIVE":
    "Enter a loan amount greater than zero.",
  "loans.completeness.reason.PURPOSE_MISSING": "Record what the loan is for.",
  "loans.completeness.reason.RATE_NEGATIVE":
    "The interest rate cannot be negative.",
  "loans.completeness.reason.RATE_DIFFERS_FROM_SCHEME":
    "The rate differs from the scheme's. Use the Custom Rate interest type, which requires additional permission.",
  "loans.completeness.reason.GUARANTOR_NOT_READY":
    "A guarantor is inactive, has not consented, or has incomplete KYC.",
  "loans.completeness.reason.DOCUMENTS_MISSING": "Still needed: {missing}.",
  "loans.completeness.reason.DOCUMENTS_MISSING_GENERIC":
    "Required documents are missing.",
  "loans.completeness.reason.UNKNOWN_WITH_CODE":
    "This check did not pass ({reason}).",
  "loans.completeness.reason.UNKNOWN": "This check did not pass.",

  "loans.completeness.notReady": "Not ready",
  "loans.completeness.readyToSubmit": "Ready to submit",
  "loans.completeness.blocked":
    "Submission is blocked until every check passes. The server re-runs all of them when you submit, so a scheme withdrawn in the meantime is still caught.",
  // Carries pass/fail for anyone who cannot see the colour or the glyph.
  "loans.completeness.sr.passed": " — passed",
  "loans.completeness.sr.notPassed": " — not passed",

  // features/loans/components/ApplicationDetail.tsx — sanction flow
  "loans.sanction.termsFixed":
    "The letter carries the approved terms exactly. They cannot be changed here.",
  "loans.sanction.declineIsFinal":
    "Recording a decline rejects the application. The reason is kept as its rejection reason.",
  "loans.sanction.responsePrompt":
    "The sanction letter has been issued. Record what the customer said about it: accepting moves them on to signing the agreement, declining rejects the application for good.",
  "loans.sanction.agreementIsARecord":
    "Record this only once the customer has signed the paper agreement. Nothing is generated or signed here — you are recording that it happened. This is the last step before the loan can be disbursed.",
  "loans.sanction.validUntilHint":
    "Optional. Recorded on the letter; not enforced.",
  "loans.sanction.signedDateHint": "Optional. Defaults to today.",
  "loans.sanction.agreementReferenceHint":
    "Optional. Your own filing number for the signed paper agreement — e.g. AGR-000001 or a stamp paper number.",
} as const;

export type MessageKey = keyof typeof en;

/**
 * Every locale must supply every key. A missing key is a compile error
 * ("Property … is missing"), an unknown one is too ("Object literal may only
 * specify known properties"), so `pnpm typecheck` is the translation-coverage
 * gate and no separate audit script is needed.
 */
export type Messages = Record<MessageKey, string>;
