import { periodicRate } from "./frequency.js";
import type { EmiFrequency } from "./types.js";

/**
 * FLAT interest: charged on the original principal for the whole term,
 * regardless of what has been repaid (D-EMI-1).
 *
 *     totalInterest = floor(P x annualRateBps x n / (10_000 x periodsPerYear))
 *
 * Every division floors (D-EMI-2). `bigint` division truncates toward zero, and
 * both operands are non-negative here, so truncation and floor coincide — but
 * the guard against negative inputs lives in `validate()`, not in an assumption
 * made here.
 *
 * Note the single division at the end: multiplying the numerator out in full
 * before dividing once is what keeps the result exact. Dividing early — say,
 * computing a per-period interest and multiplying by `n` — would floor `n`
 * separate times and lose up to `n` paise.
 */
export function flatTotalInterest(
  principalPaise: bigint,
  annualRateBps: bigint,
  frequency: EmiFrequency,
  durationCount: number,
): bigint {
  const { numerator, denominator } = periodicRate(annualRateBps, frequency);
  return (principalPaise * numerator * BigInt(durationCount)) / denominator;
}
