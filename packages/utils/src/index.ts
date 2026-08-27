/** Framework-agnostic helpers shared by web and api. */

/**
 * Formats minor units (paise) as currency.
 *
 * Money is stored in minor units everywhere to avoid floating-point drift on
 * interest and EMI calculations — divide only at the display boundary.
 */
export function formatCurrency(
  minorUnits: number,
  currency = "INR",
  locale = "en-IN",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(minorUnits / 100);
}

export function formatDate(value: Date | string, locale = "en-IN"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

/** Whole days from `from` until `to`; negative when `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

export function isOverdue(dueDate: Date, asOf: Date = new Date()): boolean {
  return daysBetween(dueDate, asOf) > 0;
}
