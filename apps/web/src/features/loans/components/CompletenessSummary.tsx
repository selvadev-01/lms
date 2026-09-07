"use client";

import type { ApplicationCompleteness, CompletenessCheck } from "@lms/types";

import { useT } from "@/context/LanguageContext";
import type { MessageKey } from "@/i18n/messages/en";
import { isMessageKey, type TParams } from "@/i18n/translate";

/**
 * Wizard step 6's validation summary.
 *
 * Every check is rendered, satisfied or not, because the API always returns all
 * nine in a fixed order. A list that showed only failures would change shape as
 * problems were fixed, and a clerk working down it would lose their place.
 *
 * The copy lives in the message catalogue rather than on the server. The API
 * returns machine-readable reasons (`DOCUMENTS_MISSING`, `TERM_NOT_OFFERED`) so
 * that its contract does not change every time the wording is improved — and so
 * that the same reason can be phrased in either instruction language.
 *
 * `"use client"` is explicit even though the only importer (ApplicationDetail)
 * is already a client component: this reads the language context, so it must
 * never be pulled into a server tree by a future caller.
 */

/**
 * Resolves a failed check to a message key and its interpolation arguments.
 *
 * Split from rendering so that whole sentences live in the catalogue. Tamil
 * places the count and the noun differently from English, so a sentence
 * assembled here from fragments could not be translated correctly.
 */
function explainKey(check: CompletenessCheck): {
  key: MessageKey;
  params?: TParams;
} {
  switch (check.reason) {
    case "CUSTOMER_NOT_ACTIVE":
      return { key: "loans.completeness.reason.CUSTOMER_NOT_ACTIVE" };
    case "SCHEME_NOT_FOUND":
      return { key: "loans.completeness.reason.SCHEME_NOT_FOUND" };
    case "PRODUCT_INACTIVE":
      return { key: "loans.completeness.reason.PRODUCT_INACTIVE" };
    case "SCHEME_INACTIVE":
      return { key: "loans.completeness.reason.SCHEME_INACTIVE" };
    case "TERM_NOT_OFFERED": {
      const details = check.details as
        { frequency?: string; durationCount?: number } | undefined;
      return details
        ? {
            key: "loans.completeness.reason.TERM_NOT_OFFERED",
            params: {
              count: details.durationCount ?? 0,
              frequency: String(details.frequency ?? "").toLowerCase(),
            },
          }
        : { key: "loans.completeness.reason.TERM_NOT_OFFERED_GENERIC" };
    }
    case "AMOUNT_NOT_POSITIVE":
      return { key: "loans.completeness.reason.AMOUNT_NOT_POSITIVE" };
    case "PURPOSE_MISSING":
      return { key: "loans.completeness.reason.PURPOSE_MISSING" };
    case "RATE_NEGATIVE":
      return { key: "loans.completeness.reason.RATE_NEGATIVE" };
    case "RATE_DIFFERS_FROM_SCHEME":
      return { key: "loans.completeness.reason.RATE_DIFFERS_FROM_SCHEME" };
    case "GUARANTOR_NOT_READY":
      return { key: "loans.completeness.reason.GUARANTOR_NOT_READY" };
    case "DOCUMENTS_MISSING": {
      const details = check.details as { missing?: string[] } | undefined;
      return details?.missing?.length
        ? {
            key: "loans.completeness.reason.DOCUMENTS_MISSING",
            params: { missing: details.missing.join(", ") },
          }
        : { key: "loans.completeness.reason.DOCUMENTS_MISSING_GENERIC" };
    }
    default:
      // An unrecognised reason still says something true rather than nothing.
      // The API may add reasons this build has never seen.
      return check.reason
        ? {
            key: "loans.completeness.reason.UNKNOWN_WITH_CODE",
            params: { reason: check.reason },
          }
        : { key: "loans.completeness.reason.UNKNOWN" };
  }
}

export default function CompletenessSummary({
  completeness,
}: {
  completeness: ApplicationCompleteness;
}) {
  const t = useT();

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
          {completeness.submittable
            ? t("loans.completeness.readyToSubmit")
            : t("loans.completeness.notReady")}
        </span>
      </div>

      <ul className="divide-y divide-gray-200 rounded-2xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {completeness.checks.map((check) => {
          /**
           * The check key *is* the last segment of the label key, so no lookup
           * table is needed. The guard is not ceremony: a reason this build has
           * never seen produces a key in neither catalogue, and without it the
           * raw key string would render as the label.
           */
          const labelKey = `loans.completeness.label.${check.key}`;
          const label = isMessageKey(labelKey) ? t(labelKey) : check.key;

          return (
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
                  {label}
                  {/* The icon is aria-hidden, so the state is carried in text
                      for anyone who cannot see the colour or the glyph. It
                      follows the instruction language because the reader's
                      screen-reader voice follows `<html lang>`. */}
                  <span className="sr-only">
                    {check.satisfied
                      ? t("loans.completeness.sr.passed")
                      : t("loans.completeness.sr.notPassed")}
                  </span>
                </p>
                {!check.satisfied &&
                  (() => {
                    const { key, params } = explainKey(check);
                    return (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {t(key, params)}
                      </p>
                    );
                  })()}
              </div>
            </li>
          );
        })}
      </ul>

      {!completeness.submittable && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("loans.completeness.blocked")}
        </p>
      )}
    </section>
  );
}
