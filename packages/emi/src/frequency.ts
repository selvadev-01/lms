import { EmiCalculationError } from "./errors.js";
import type { EmiFrequency } from "./types.js";

/**
 * Periods per year, used to turn an annual rate into a periodic one (D-EMI-4).
 *
 * DAILY is 365 with no leap-year adjustment and WEEKLY is 52 (not 52.1775).
 * Both are conventional for this loan book's daily and weekly products, and both
 * are deliberately integers: a fractional period count would force the periodic
 * rate's denominator to become fractional too, and the whole calculator's
 * exactness rests on that denominator staying an integer.
 */
const PERIODS_PER_YEAR: Readonly<Record<EmiFrequency, bigint>> = Object.freeze({
  DAILY: 365n,
  WEEKLY: 52n,
  MONTHLY: 12n,
  QUARTERLY: 4n,
  YEARLY: 1n,
});

export function periodsPerYear(frequency: EmiFrequency): bigint {
  const periods = PERIODS_PER_YEAR[frequency];
  if (periods === undefined) {
    throw new EmiCalculationError(
      "INVALID_FREQUENCY",
      `Unsupported repayment frequency: ${String(frequency)}`,
    );
  }
  return periods;
}

/**
 * The periodic interest rate as an exact rational `numerator / denominator`.
 *
 * Returned as a pair rather than a computed value because the rate is almost
 * never exactly representable — 12% annual monthly is 1/100 exactly, but 10%
 * annual daily is 1/36500, and evaluating that to a float here would push a
 * rounding error into every subsequent installment. Callers divide once, at the
 * last possible moment, in integer arithmetic.
 */
export function periodicRate(
  annualRateBps: bigint,
  frequency: EmiFrequency,
): { numerator: bigint; denominator: bigint } {
  return {
    numerator: annualRateBps,
    // 10_000 converts basis points to a plain ratio.
    denominator: 10_000n * periodsPerYear(frequency),
  };
}
