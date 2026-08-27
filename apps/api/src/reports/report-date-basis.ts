import { BadRequestException } from '@nestjs/common';
import type { ReportCategory, ReportDateBasis } from '@lms/types';

/**
 * Which date column each report category may be filtered by.
 *
 * Rule 10 requires every report to declare its date basis; Rule 11 forbids one
 * report from silently mixing two. This registry is how both become
 * enforceable rather than aspirational: a category names the bases it permits,
 * the service asks this file, and a request naming anything else is refused
 * (Scenario 10) rather than quietly filtered on whatever column the query
 * happened to reach for.
 *
 * The restrictions are not arbitrary. An application report filtered by
 * disbursal date would silently exclude every application that was never
 * disbursed — which is most of the interesting ones, and the omission would be
 * invisible in the output. A collection report filtered by due date would
 * report a payment against the month it was owed rather than the month it
 * arrived, and the two differ for exactly the borrowers a collection report
 * exists to find.
 *
 * // TODO(open-question): Questions 6 and 7 — whether a user may choose a basis
 * // per report, or whether each report is fixed to one, is unresolved. The
 * // conservative reading is applied: each category declares what it permits
 * // and refuses the rest, so widening later is additive while narrowing later
 * // would break a saved report someone already relies on.
 */
export const PERMITTED_DATE_BASES: Record<
  ReportCategory,
  readonly ReportDateBasis[]
> = {
  // The dashboard's collection KPIs are range-bounded by when money arrived;
  // its portfolio KPIs are as-of-now positions and take no range at all.
  DASHBOARD: ['COLLECTION_DATE', 'DISBURSAL_DATE'],
  PORTFOLIO: ['DISBURSAL_DATE'],
  APPLICATIONS: ['APPLICATION_DATE'],
  DISBURSALS: ['DISBURSAL_DATE'],
  COLLECTIONS: ['COLLECTION_DATE'],
  FIELD_COLLECTIONS: ['BUSINESS_DATE'],
  // Overdue is derived against the business date, and the range filters the
  // oldest unpaid EMI's due date — the story's own wording for this report.
  OVERDUE_RECOVERY: ['DUE_DATE'],
  FINANCIAL: ['ACCOUNTING_DATE'],
};

/** The basis a category uses when the caller names none. */
export const DEFAULT_DATE_BASIS: Record<ReportCategory, ReportDateBasis> = {
  DASHBOARD: 'COLLECTION_DATE',
  PORTFOLIO: 'DISBURSAL_DATE',
  APPLICATIONS: 'APPLICATION_DATE',
  DISBURSALS: 'DISBURSAL_DATE',
  COLLECTIONS: 'COLLECTION_DATE',
  FIELD_COLLECTIONS: 'BUSINESS_DATE',
  OVERDUE_RECOVERY: 'DUE_DATE',
  FINANCIAL: 'ACCOUNTING_DATE',
};

/**
 * Resolve and validate the basis for one request.
 *
 * Returns the basis actually applied, which the caller puts in `meta` so the
 * response says which column it filtered rather than leaving the reader to
 * assume (Scenario 12).
 */
export function resolveDateBasis(
  category: ReportCategory,
  requested?: ReportDateBasis,
): ReportDateBasis {
  if (!requested) return DEFAULT_DATE_BASIS[category];

  if (!PERMITTED_DATE_BASES[category].includes(requested)) {
    throw new BadRequestException(
      'This report cannot be filtered by that date basis',
    );
  }

  return requested;
}
