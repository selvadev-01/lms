import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ReportDateBasis, ReportMeta } from '@lms/types';

import type { AuthContext } from '../common/auth-context';

/**
 * Scope and bounds for every report in Module 15.
 *
 * # Why this exists when no other module has one
 *
 * Every other service in this codebase writes its own scope clause inline:
 * `...(actor.branchId ? { branchId: actor.branchId } : {})`. That is the right
 * shape when a service owns one entity. Module 15 has eight report categories
 * applying the identical rule across seven other modules' tables, and a single
 * forgotten spread is not a bug — it is one branch reading another branch's
 * book (Rule 2, Scenarios 2, 28, 53). Centralising it means the rule is written
 * once and tested once.
 *
 * # Scope narrows, never widens
 *
 * `resolveBranchScope` is the whole of Rule 4 and Scenario 11. A caller may ask
 * for a branch; the server decides. A branch-scoped caller asking for their own
 * branch gets it, asking for another gets a refusal, and asking for none gets
 * their own anyway. An unscoped caller — one whose `branchId` is null, which is
 * how this system represents organization-wide authority — may name any branch
 * or none. At no point does a value from the request widen what the JWT already
 * allowed.
 *
 * # Bounds are refusals, not truncations
 *
 * Rule 32 and Scenario 62: a request beyond the configured range is rejected.
 * Silently clamping it to 366 days would return a report that looks complete
 * and answers a different question than the one asked, which is worse than an
 * error — the user would act on it.
 */

/**
 * Bounds on what a single report request may ask for.
 *
 * Rule 32 requires a configured date-range limit and Rule 33 a documented
 * maximum result size, both so that one request cannot execute an unbounded
 * query (Scenario 62).
 *
 * Declared here rather than imported from `@lms/constants`, following the same
 * convention `auth/session-state.ts` and `field/gps-verification.ts` document:
 * that package ships raw ESM with no build step, so the CJS Nest build cannot
 * require it. `REPORT_LIMITS` there is the shared declaration for the web app,
 * and the two must be kept in step.
 *
 * // TODO(open-question): Questions 29, 30, 32 and 45 — the real maximum export
 * // size, date range and performance targets are unresolved. 366 days covers a
 * // full financial year including a leap year; 10,000 rows is roughly a 1-2MB
 * // CSV. Both are deliberately conservative: raising a limit is safe, lowering
 * // one breaks a report someone already relies on.
 */
export const REPORT_LIMITS = {
  /** Inclusive maximum span of `fromDate`..`toDate`, in days. */
  MAX_DATE_RANGE_DAYS: 366,
  /** Rows above this in one export are refused, never silently truncated. */
  MAX_EXPORT_ROWS: 10_000,
} as const;

/** One opaque message. A caller learns their request was refused, not the shape of what they cannot see. */
const OUT_OF_SCOPE = 'You are not authorized to report on that branch';

/**
 * The branch filter to apply, given what the caller asked for.
 *
 * Returns `null` for organization-wide, which is only reachable by a caller
 * whose own scope is organization-wide.
 */
export function resolveBranchScope(
  actor: AuthContext,
  requestedBranchId?: string,
): string | null {
  // A branch-confined caller is confined regardless of what they asked for.
  // Asking for their own branch is redundant but harmless; asking for another
  // is the attempt Scenario 11 describes, and it is refused rather than
  // silently ignored — a caller who believes they are reading Branch B should
  // not be handed Branch A's numbers under Branch B's heading.
  if (actor.branchId) {
    if (requestedBranchId && requestedBranchId !== actor.branchId) {
      throw new ForbiddenException(OUT_OF_SCOPE);
    }
    return actor.branchId;
  }

  // Organization-wide caller: honour the request, including its absence.
  return requestedBranchId ?? null;
}

/**
 * The `where` fragment every report query spreads.
 *
 * Two shapes, because the tables differ: `Loan`, `Collection` and
 * `CashHandover` carry `branchId` directly, while `JournalLine` and `Emi` reach
 * it only through a parent. Callers that need the second use
 * `branchScopeFor(...)` inside the relation filter instead.
 */
export function orgBranchWhere(
  actor: AuthContext,
  requestedBranchId?: string,
): { orgId: string; branchId?: string } {
  const branchId = resolveBranchScope(actor, requestedBranchId);
  return { orgId: actor.orgId, ...(branchId ? { branchId } : {}) };
}

/** Whole days between two ISO dates, inclusive of both ends. */
export function inclusiveDaySpan(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T12:00:00Z`).getTime();
  const to = new Date(`${toDate}T12:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000) + 1;
}

/**
 * Reject a range that is inverted or wider than the configured ceiling.
 *
 * The DTOs validate each date's shape; this validates the pair. Both live
 * server-side because the zod schema in `@lms/validation` runs in the browser
 * and guards nothing — a caller hitting the API directly never sees it.
 */
export function assertDateRange(fromDate: string, toDate: string): void {
  if (fromDate > toDate) {
    throw new BadRequestException('To Date must be on or after From Date');
  }

  if (inclusiveDaySpan(fromDate, toDate) > REPORT_LIMITS.MAX_DATE_RANGE_DAYS) {
    throw new BadRequestException(
      `Date range cannot exceed ${REPORT_LIMITS.MAX_DATE_RANGE_DAYS} days`,
    );
  }
}

/**
 * Reject an export whose result set is larger than one file should carry.
 *
 * Rule 33 and Scenario 62. Refused rather than truncated, for the reason at the
 * top of this file: a truncated export is indistinguishable from a complete one
 * once it is open in a spreadsheet.
 */
export function assertExportSize(rowCount: number): void {
  if (rowCount > REPORT_LIMITS.MAX_EXPORT_ROWS) {
    throw new BadRequestException(
      `This report has ${rowCount} rows, which is more than the ${REPORT_LIMITS.MAX_EXPORT_ROWS} an export can carry. Narrow the date range or add a filter.`,
    );
  }
}

/** A `Date` at UTC noon for an ISO date string, safe against DST shifting the day. */
export function civilToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** The exclusive upper bound for a date range, so `toDate` is inclusive. */
export function civilToExclusiveEnd(iso: string): Date {
  const date = civilToDate(iso);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

/**
 * Build the `meta` block every report response carries.
 *
 * `dateBasis` is what the server applied, not what was requested, and
 * `branchId` is the scope enforced rather than the scope asked for. Echoing the
 * request back would hide exactly the two things a caller most needs to know:
 * that their branch was narrowed (Scenario 11) and which date column their
 * range actually filtered (Rule 10, Scenario 12).
 *
 * `dataFreshAt` is the moment the query ran. Nothing is cached today, so this
 * is honest rather than absent — Rule 36 forbids presenting aggregated data as
 * real-time without an indicator, and an indicator that is always "now" is
 * still the truth.
 */
export function buildMeta(input: {
  category: ReportMeta['category'];
  dateBasis: ReportDateBasis;
  fromDate: string;
  toDate: string;
  branchId: string | null;
  branchName?: string;
  piiMasked: boolean;
}): ReportMeta {
  return {
    category: input.category,
    dateBasis: input.dateBasis,
    fromDate: input.fromDate,
    toDate: input.toDate,
    branchId: input.branchId,
    branchName: input.branchName,
    dataFreshAt: new Date().toISOString(),
    piiMasked: input.piiMasked,
  };
}

export const REPORTS_EXPORT_PERMISSION = 'reports.export';
export const REPORTS_EXPORT_PII_PERMISSION = 'reports.export.pii';

/** True when the caller may see unmasked customer names and mobile numbers. */
export function canSeePii(actor: AuthContext): boolean {
  return actor.permissions.includes(REPORTS_EXPORT_PII_PERMISSION);
}

/**
 * Mask a customer name for a caller without PII permission.
 *
 * Initials and a length hint rather than a blank: Rule 49 requires a report to
 * distinguish an unavailable value from a masked one, and an empty cell reads
 * as "no customer" rather than "not shown to you".
 */
export function maskName(name: string, allowed: boolean): string {
  if (allowed) return name;
  const initial = name.trim().charAt(0).toUpperCase();
  return initial ? `${initial}••••` : '••••';
}

/** Mask a mobile number to its last two digits, the shape `AuditService` already uses. */
export function maskMobile(mobile: string, allowed: boolean): string {
  if (allowed) return mobile;
  return mobile.length > 2 ? `••••••${mobile.slice(-2)}` : '••••';
}
