/**
 * Money, rate and date formatting for display.
 *
 * These live in `lib/` rather than in a feature because they carry no domain
 * semantics — they are string formatting over integer values, and three
 * features (loans, disbursements, and the schedule surfaces) render the same
 * amounts. They were extracted verbatim from
 * `features/loans/components/LoanBadges.tsx`, which re-exports them so the
 * loans barrel's public surface is unchanged.
 *
 * Nothing here imports `server-only`, which is the point: the client components
 * that render amounts cannot reach a feature barrel, because every barrel
 * re-exports its `server-only` `api/` module.
 */

/**
 * Integer paise as rupees.
 *
 * Parsed with `BigInt`, never `Number`: a loan amount large enough to matter
 * exceeds `Number.MAX_SAFE_INTEGER` in paise, and the whole reason these values
 * cross the wire as strings is to survive that. The rupee and paise halves are
 * split with integer arithmetic and only joined as text.
 */
export function formatPaise(paise: string): string {
  let value: bigint;

  try {
    value = BigInt(paise);
  } catch {
    // A malformed value is shown as-is rather than as a plausible-looking
    // number: silently rendering "0.00" for an unparseable amount would be the
    // one outcome a reader cannot detect.
    return paise;
  }

  // `BigInt(0)` rather than `0n`: this app targets ES2017, where the literal
  // form is a syntax error. The call is equivalent and compiles everywhere.
  const zero = BigInt(0);
  const hundred = BigInt(100);
  const negative = value < zero;
  const absolute = negative ? -value : value;
  const rupees = absolute / hundred;
  const remainder = absolute % hundred;

  // Indian digit grouping: the last three digits, then pairs.
  const digits = rupees.toString();
  const head = digits.length > 3 ? digits.slice(0, -3) : "";
  const tail = digits.slice(-3);
  const grouped = head
    ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${tail}`
    : tail;

  return `${negative ? "-" : ""}₹${grouped}.${remainder.toString().padStart(2, "0")}`;
}

/** Integer basis points as a percentage. 1250 bps renders as "12.5%". */
export function formatBps(bps: string): string {
  let value: bigint;

  try {
    value = BigInt(bps);
  } catch {
    return bps;
  }

  const hundred = BigInt(100);
  const whole = value / hundred;
  const fraction = value % hundred;

  if (fraction === BigInt(0)) return `${whole.toString()}%`;

  // Trailing zero trimmed so 1250 reads "12.5%" rather than "12.50%".
  const decimals = fraction.toString().padStart(2, "0").replace(/0$/, "");

  return `${whole.toString()}.${decimals}%`;
}

/** A `YYYY-MM-DD` or ISO timestamp as a readable date. Never shifts the day. */
export function formatDate(value: string | undefined): string {
  if (!value) return "—";

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;

  const [, year, month, day] = match;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const index = Number(month) - 1;

  // Formatted from the string's own parts rather than through `new Date`, which
  // would parse a DATE-only value as UTC midnight and render the previous day
  // for any viewer west of Greenwich.
  return `${day} ${months[index] ?? month} ${year}`;
}
