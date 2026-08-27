import { periodicRate } from "./frequency.js";
import type { EmiFrequency } from "./types.js";

/**
 * Fixed-point scale for the compounding factor (D-EMI-11).
 *
 * 1e12 gives twelve fractional digits, which keeps the relative error in
 * `(1+r)^n` far below one paisa for any term this loan book supports (the error
 * compounds roughly as `n / SCALE`, so even a 3650-period daily loan stays
 * around 1e-9 relative). Raising it costs nothing but wider intermediates;
 * lowering it starts to show up in the installment.
 */
const SCALE = 1_000_000_000_000n;

/**
 * `(1 + r)^n` in fixed point, computed by binary exponentiation.
 *
 * `Math.pow` is unavailable here on purpose: it takes and returns `number`, and
 * routing an exact rational rate through a float would put a rounding error
 * underneath every installment in the schedule. Squaring in `bigint` and
 * dividing back to scale after each multiply keeps the whole computation in
 * integers.
 *
 * Binary exponentiation rather than a naive n-times loop: it turns a 3650-period
 * daily loan from 3650 multiplications into 12, and — because each division back
 * to scale discards a little precision — it also means far fewer roundings.
 */
export function onePlusRatePow(
  rateNumerator: bigint,
  rateDenominator: bigint,
  exponent: number,
): bigint {
  // (1 + num/den) scaled == (den + num) * SCALE / den.
  let base = ((rateDenominator + rateNumerator) * SCALE) / rateDenominator;
  let result = SCALE;
  let remaining = exponent;

  while (remaining > 0) {
    if (remaining % 2 === 1) {
      result = (result * base) / SCALE;
    }
    remaining = Math.floor(remaining / 2);
    // Skip the final squaring; it would be multiplied into nothing.
    if (remaining > 0) {
      base = (base * base) / SCALE;
    }
  }
  return result;
}

/**
 * The level installment for a reducing-balance loan:
 *
 *     EMI = P x r x (1+r)^n / ((1+r)^n - 1)
 *
 * Floored to whole paise. Because it is floored, the level installments
 * collectively fall a little short of the true payoff; `buildSchedule` closes
 * that gap on the final installment rather than spreading it (D-EMI-3).
 *
 * Callers must handle a zero rate before reaching here — at `r = 0` the factor
 * is exactly 1 and the denominator `(1+r)^n - 1` is zero.
 */
export function reducingInstallment(
  principalPaise: bigint,
  annualRateBps: bigint,
  frequency: EmiFrequency,
  durationCount: number,
): bigint {
  const { numerator, denominator } = periodicRate(annualRateBps, frequency);
  const factor = onePlusRatePow(numerator, denominator, durationCount);

  // EMI = P * (num/den) * factor / (factor - SCALE), kept as one fraction so
  // there is a single floor at the end rather than one per operation.
  const emiNumerator = principalPaise * numerator * factor;
  const emiDenominator = denominator * (factor - SCALE);
  return emiNumerator / emiDenominator;
}

/** Interest accrued on an outstanding balance over one period, floored. */
export function periodInterest(
  balancePaise: bigint,
  annualRateBps: bigint,
  frequency: EmiFrequency,
): bigint {
  const { numerator, denominator } = periodicRate(annualRateBps, frequency);
  return (balancePaise * numerator) / denominator;
}

export { SCALE };
