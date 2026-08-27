import { EmiCalculationError } from "./errors.js";
import type { EmiFrequency } from "./types.js";

/**
 * DATE-only arithmetic for repayment due dates (D-EMI-5).
 *
 * Due dates are calendar dates in Asia/Kolkata, not instants. That distinction
 * is the whole reason this module exists rather than using `Date` directly:
 * constructing `new Date(2026, 0, 31)` builds midnight in the *host's* zone, and
 * serializing that to UTC from an IST machine shifts it back 5h30m to
 * 2026-01-30T18:30:00Z — one day earlier. On a UTC server the same code is
 * correct. A due date that depends on where the server runs is not a due date.
 *
 * The fix is to never let a timezone into the calculation at all: dates are
 * carried as {year, month, day} integers, arithmetic is done on those integers,
 * and the result is formatted straight back to `YYYY-MM-DD`. No `Date` object,
 * no UTC offset, no host locale.
 */
interface CivilDate {
  year: number;
  /** 1-based, unlike `Date`'s 0-based months. */
  month: number;
  day: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days in a month, honouring the Gregorian leap rule. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function parseIsoDate(value: string): CivilDate {
  const match = ISO_DATE.exec(value);
  if (!match) {
    throw new EmiCalculationError(
      "INVALID_START_DATE",
      `Start date must be YYYY-MM-DD, received: ${value}`,
    );
  }
  // The regex guarantees three groups, but `noUncheckedIndexedAccess` cannot see
  // that, so read them through a checked destructure.
  const [, rawYear = "", rawMonth = "", rawDay = ""] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new EmiCalculationError(
      "INVALID_START_DATE",
      `Not a real calendar date: ${value}`,
    );
  }
  return { year, month, day };
}

export function formatIsoDate(date: CivilDate): string {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${String(date.year).padStart(4, "0")}-${month}-${day}`;
}

/** Adds whole days, rolling over month and year boundaries. */
function addDays(date: CivilDate, days: number): CivilDate {
  let { year, month, day } = date;
  day += days;
  for (;;) {
    const limit = daysInMonth(year, month);
    if (day <= limit) break;
    day -= limit;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { year, month, day };
}

/**
 * Adds whole months, clamping to the end of the target month.
 *
 * 31 Jan + 1 month is 28 Feb (29 in a leap year), not 3 March. Letting the day
 * overflow would drift the whole schedule forward and, worse, drift it by a
 * different amount depending on which months the loan happened to span.
 */
function addMonths(date: CivilDate, months: number): CivilDate {
  const zeroBased = date.month - 1 + months;
  const year = date.year + Math.floor(zeroBased / 12);
  const month = (((zeroBased % 12) + 12) % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** The due date `periods` whole periods after `start`. */
export function addPeriods(
  start: CivilDate,
  frequency: EmiFrequency,
  periods: number,
): CivilDate {
  switch (frequency) {
    case "DAILY":
      return addDays(start, periods);
    case "WEEKLY":
      return addDays(start, periods * 7);
    case "MONTHLY":
      return addMonths(start, periods);
    case "QUARTERLY":
      return addMonths(start, periods * 3);
    case "YEARLY":
      return addMonths(start, periods * 12);
    default:
      throw new EmiCalculationError(
        "INVALID_FREQUENCY",
        `Unsupported repayment frequency: ${String(frequency)}`,
      );
  }
}

/**
 * Today's calendar date in Asia/Kolkata, used when no start date is supplied.
 *
 * Reads the parts through `Intl` in that zone explicitly rather than trusting
 * the host clock's zone, so a server in UTC and a browser in IST agree — which
 * matters between 18:30 and 24:00 UTC, when the two are on different dates.
 * India has no DST, so a fixed zone name is safe here.
 */
export function todayInKolkata(now: Date = new Date()): CivilDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const part = (type: "year" | "month" | "day"): number =>
    Number(
      parts.find((candidate) => candidate.type === type)?.value ?? Number.NaN,
    );

  const date = { year: part("year"), month: part("month"), day: part("day") };
  if (
    !Number.isFinite(date.year) ||
    !Number.isFinite(date.month) ||
    !Number.isFinite(date.day)
  ) {
    throw new EmiCalculationError(
      "INVALID_START_DATE",
      "Could not resolve the current date in Asia/Kolkata.",
    );
  }
  return date;
}

export type { CivilDate };
