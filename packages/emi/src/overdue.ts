/**
 * Delinquency arithmetic — days past due, ageing buckets and asset
 * classification (Module 13).
 *
 * # Why this lives beside `computeSchedule` and `allocate`
 *
 * The third part of the same money story: one decides what is owed, the second
 * decides what a payment settles, this one decides how late it is. All three
 * are pure and deterministic for the same reason — Scenario 8 requires that the
 * same schedule, payments and business date always produce the same overdue
 * result, and that the result be replayable from authoritative data long
 * afterwards. Nothing here does I/O, reads a clock, or caches.
 *
 * # Why nothing here is stored
 *
 * Days past due, the bucket and the classification are **derived on every
 * read**, never written to a column. A stored copy would be a second reading of
 * "how late is this borrower" that drifts from the schedule screen the moment a
 * payment lands, and Rule 4 requires overdue status be derived from
 * authoritative repayment obligations rather than fabricated.
 *
 * That is the same decision `deriveEmiStatus` already makes one level down, and
 * this module is deliberately built on `CivilDate` integers for the same reason
 * it is: a `Date` subtraction crossing a DST boundary or a host-zone midnight
 * would move a borrower between buckets depending on where the server runs.
 * India has no DST, but the server need not be in India.
 */

import type { CivilDate } from "./dates.js";

/**
 * Ageing buckets, matching the `delinquency_bucket` database enum.
 *
 * Fixed rather than configurable (the source's Open Question 3). Because a
 * bucket is derived rather than stored, making the ranges editable would
 * silently reclassify every historical report the moment someone changed them —
 * last quarter's 60-day bucket would stop meaning what it meant when it was
 * published. A future module that genuinely needs per-organization ranges must
 * add the configuration and a snapshot of it together.
 */
export type DelinquencyBucket =
  | "CURRENT"
  | "DPD_1_30"
  | "DPD_31_60"
  | "DPD_61_90"
  | "DPD_91_180"
  | "DPD_180_PLUS";

/**
 * Asset classification, matching the `npa_status` database enum.
 *
 * The Indian prudential norms this follows: an account is Standard until it is
 * 90 days overdue, Sub-standard for the first year thereafter, Doubtful beyond
 * that, and Loss when it is judged unrecoverable. `SPECIAL_MENTION` covers the
 * 1-90 day window that is late but not yet non-performing.
 *
 * `LOSS` is deliberately unreachable from days past due alone — it is a
 * judgment, not a calculation, and `classifyNpa` never returns it. Reaching it
 * requires the authorized action Rule 29 describes.
 */
export type NpaStatus =
  | "STANDARD"
  | "SPECIAL_MENTION"
  | "SUB_STANDARD"
  | "DOUBTFUL"
  | "LOSS";

/**
 * The days-past-due threshold at which a loan becomes non-performing.
 *
 * Exported so a caller can render the rule rather than restate it, and so a
 * test can assert against the same constant the classifier walks.
 */
export const NPA_THRESHOLD_DAYS = 90;

/**
 * A civil date as a day number, counting from an arbitrary fixed epoch.
 *
 * The standard "days from civil" algorithm (Howard Hinnant's), which is exact
 * for every Gregorian date and uses only integer arithmetic — no `Date`, no
 * timezone, no floating point. Two dates converted this way can be subtracted
 * to get an exact whole-day difference, which is what `daysPastDue` needs and
 * what a `Date` millisecond subtraction cannot safely give.
 *
 * Not exported: it is an implementation detail, and a day number that escaped
 * into a column would be a date nobody could read.
 */
function toDayNumber(date: CivilDate): number {
  // Shift so the year starts in March, which puts the leap day at the end of
  // the year and makes the month-length pattern regular.
  const year = date.month <= 2 ? date.year - 1 : date.year;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear =
    Math.floor((153 * (date.month + (date.month > 2 ? -3 : 9)) + 2) / 5) +
    date.day -
    1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * Whole days between two civil dates, negative when `to` precedes `from`.
 *
 * Exported because penalty accrual counts days over the same calendar and must
 * agree with delinquency ageing exactly: a penalty charged for 31 days against
 * a loan reported as 30 days past due is a discrepancy nobody can explain.
 */
export function daysBetween(from: CivilDate, to: CivilDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/**
 * Days past due for an obligation, given today's business date.
 *
 * Answers the source's Open Question 2. The count starts the day *after* the
 * due date: an installment due today is not late, and one due yesterday is one
 * day past due. That is the same boundary `deriveEmiStatus` draws when it
 * returns `DUE` for a same-day comparison and `OVERDUE` only once the due date
 * is in the past, and the two must agree — a loan the schedule screen calls due
 * must not appear in the overdue book with a DPD of zero.
 *
 * Never negative: an installment not yet due is zero days past due, not
 * negatively so. A caller wanting "days until due" is asking a different
 * question and should use `daysBetween`.
 */
export function daysPastDue(dueDate: CivilDate, today: CivilDate): number {
  const elapsed = daysBetween(dueDate, today);
  return elapsed > 0 ? elapsed : 0;
}

/**
 * The ageing bucket for a given days-past-due count.
 *
 * Boundaries are inclusive at the top of each range, so 30 is `DPD_1_30` and 31
 * opens the next bucket. Written as ordered comparisons rather than a lookup so
 * the ranges read the way the policy is written.
 */
export function delinquencyBucket(dpd: number): DelinquencyBucket {
  if (dpd <= 0) return "CURRENT";
  if (dpd <= 30) return "DPD_1_30";
  if (dpd <= 60) return "DPD_31_60";
  if (dpd <= 90) return "DPD_61_90";
  if (dpd <= 180) return "DPD_91_180";
  return "DPD_180_PLUS";
}

/**
 * The asset classification a given days-past-due count makes a loan *eligible*
 * for.
 *
 * Answers Open Questions 4 and 5, and the wording matters: this returns what
 * the arithmetic supports, not what the loan *is*. Rule 29 requires NPA
 * classification be authorized, so the system derives and surfaces the
 * eligibility and an authorized action commits it. A caller that wrote this
 * return value straight onto `loans.status` would be doing exactly what Rule 29
 * forbids.
 *
 * `LOSS` is never returned. It is a judgment about recoverability that no day
 * count can make, and inferring it from ageing alone would write off loans the
 * business had not decided to write off.
 */
export function classifyNpa(dpd: number): NpaStatus {
  if (dpd <= 0) return "STANDARD";
  if (dpd < NPA_THRESHOLD_DAYS) return "SPECIAL_MENTION";
  // Non-performing from here. The first twelve months as sub-standard, doubtful
  // thereafter — the standard prudential progression.
  if (dpd < NPA_THRESHOLD_DAYS + 365) return "SUB_STANDARD";
  return "DOUBTFUL";
}

/** One unpaid obligation, as the overdue roll-up sees it. */
export interface OverdueObligation {
  dueDate: CivilDate;
  principalOutstandingPaise: bigint;
  interestOutstandingPaise: bigint;
  penaltyOutstandingPaise: bigint;
  feesOutstandingPaise: bigint;
}

/** The derived overdue position of one loan. */
export interface OverduePosition {
  /** The earliest unpaid due date, or null when nothing is overdue. */
  oldestDueDate: CivilDate | null;
  daysPastDue: number;
  bucket: DelinquencyBucket;
  /** What the ageing supports. Committing it is an authorized act (Rule 29). */
  npaEligibility: NpaStatus;
  overduePrincipalPaise: bigint;
  overdueInterestPaise: bigint;
  overduePenaltyPaise: bigint;
  overdueFeesPaise: bigint;
  /** The sum of the four components above — the source's money identity. */
  totalOverduePaise: bigint;
}

/**
 * Rolls a loan's unpaid obligations up into its overdue position.
 *
 * # What counts as overdue
 *
 * Only obligations whose due date has **passed** and which still owe something.
 * An installment due today is not overdue however much it owes, and a future
 * installment is not overdue however large. That is the same boundary
 * `daysPastDue` draws, and drawing it here rather than at the call site is what
 * stops two callers disagreeing about whether today counts.
 *
 * # Why days past due comes from the oldest obligation
 *
 * A borrower is as late as their oldest unpaid debt, not their average or their
 * most recent. Scenario 2 shows the oldest unpaid due date and the DPD side by
 * side, and deriving the second from anything but the first would make the pair
 * inconsistent on screen.
 *
 * # Determinism
 *
 * The input is never mutated and never sorted — the oldest date is found by a
 * single scan, so the caller's row order cannot influence the result. Every
 * total is accumulated in `bigint`; there is no point at which a paisa passes
 * through a `number`.
 */
export function summarizeOverdue(
  obligations: readonly OverdueObligation[],
  today: CivilDate,
): OverduePosition {
  let oldestDueDate: CivilDate | null = null;
  let principal = 0n;
  let interest = 0n;
  let penalty = 0n;
  let fees = 0n;

  for (const obligation of obligations) {
    const outstanding =
      obligation.principalOutstandingPaise +
      obligation.interestOutstandingPaise +
      obligation.penaltyOutstandingPaise +
      obligation.feesOutstandingPaise;

    // Settled obligations contribute nothing whatever the calendar says, which
    // is Scenario 7: a fully paid EMI is excluded from the overdue totals.
    if (outstanding <= 0n) continue;
    if (daysBetween(obligation.dueDate, today) <= 0) continue;

    principal += obligation.principalOutstandingPaise;
    interest += obligation.interestOutstandingPaise;
    penalty += obligation.penaltyOutstandingPaise;
    fees += obligation.feesOutstandingPaise;

    if (
      oldestDueDate === null ||
      toDayNumber(obligation.dueDate) < toDayNumber(oldestDueDate)
    ) {
      oldestDueDate = obligation.dueDate;
    }
  }

  const dpd = oldestDueDate === null ? 0 : daysPastDue(oldestDueDate, today);

  return {
    oldestDueDate,
    daysPastDue: dpd,
    bucket: delinquencyBucket(dpd),
    npaEligibility: classifyNpa(dpd),
    overduePrincipalPaise: principal,
    overdueInterestPaise: interest,
    overduePenaltyPaise: penalty,
    overdueFeesPaise: fees,
    totalOverduePaise: principal + interest + penalty + fees,
  };
}
