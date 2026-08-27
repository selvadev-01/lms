/**
 * Money and rate formatting for exported files.
 *
 * Every function here takes a **string** and returns a string. That is the
 * whole point: an amount above ~90,000 crore exceeds `Number.MAX_SAFE_INTEGER`
 * once expressed in paise, so routing a figure through `number` on its way to a
 * spreadsheet would silently round the largest loans in the book. The system's
 * exactness rests on never crossing that line, and an export is the last place
 * it would be noticed if it were crossed.
 *
 * Lifted out of Module 10's `repayment-schedule-export.ts` when Module 15
 * needed the same formatting in seven report categories. One copy, so the
 * grouping rules cannot drift between the schedule a borrower reads and the
 * portfolio report the branch reads.
 */

/** `12345678` paise as `1,23,456.78`. Indian digit grouping, no float. */
export function formatPaise(paise: string): string {
  const negative = paise.startsWith('-');
  const digits = (negative ? paise.slice(1) : paise).padStart(3, '0');

  const rupees = digits.slice(0, -2);
  const fraction = digits.slice(-2);

  // Indian grouping: the last three digits, then pairs. `12345678` → `1,23,456`.
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest
    ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`
    : last3;

  return `${negative ? '-' : ''}${grouped}.${fraction}`;
}

/** Basis points as a percentage: `1250` → `12.50`. */
export function formatBps(bps: string): string {
  const negative = bps.startsWith('-');
  const digits = (negative ? bps.slice(1) : bps).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
