/**
 * Shared shapes for EMI calculation.
 *
 * Every money value in this package is `bigint` integer paise. Nothing here may
 * convert a money value to `number` — a rupee amount above ~90,000 crore exceeds
 * `Number.MAX_SAFE_INTEGER` in paise, and long before that the intermediate
 * products in the amortization formula lose precision silently. The rule is
 * simpler to hold than the exception: paise never touch `number`.
 */

/** Repayment frequency. Mirrors the Prisma `RepaymentFrequency` enum. */
export type EmiFrequency =
  "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

/**
 * Interest type. Mirrors the Prisma `InterestType` enum.
 *
 * `CUSTOM_RATE` is deliberately not a third formula — it amortizes exactly as
 * `REDUCING`. What differs is provenance, not mathematics: a `CUSTOM_RATE`
 * application may carry a rate differing from its scheme's, gated on a separate
 * permission. The source names Flat / Reducing / Custom as *selections* and never
 * defines a third calculation, so inventing one would be a silent guess.
 * (D-EMI-1.)
 */
export type EmiInterestType = "FLAT" | "REDUCING" | "CUSTOM_RATE";

export interface EmiInput {
  /** Loan principal in integer paise. Must be > 0. */
  principalPaise: bigint;
  /** Annual nominal rate in integer basis points. Must be >= 0. */
  annualRateBps: bigint;
  interestType: EmiInterestType;
  frequency: EmiFrequency;
  /** Number of repayment periods. Must be a positive integer. */
  durationCount: number;
  /**
   * Anchor for the schedule, `YYYY-MM-DD`. The first installment falls one full
   * period after this date — never on the anchor itself. Defaults to today in
   * Asia/Kolkata when omitted.
   */
  startDate?: string;
}

export interface EmiInstallment {
  /** 1-based. */
  installmentNumber: number;
  /** `YYYY-MM-DD`, DATE-only, Asia/Kolkata. */
  dueDate: string;
  principalPaise: bigint;
  interestPaise: bigint;
  /** `principalPaise + interestPaise`. */
  totalPaise: bigint;
  /** Principal still outstanding after this installment. Zero on the last. */
  closingBalancePaise: bigint;
}

export interface EmiSchedule {
  /** The regular installment. The final one may differ — see below. */
  installmentAmountPaise: bigint;
  /**
   * The last installment absorbs all rounding residue, so the schedule sums
   * exactly to `totalPayablePaise` (D-EMI-3). Equal to
   * `installmentAmountPaise` only when the division happened to be exact.
   */
  finalInstallmentPaise: bigint;
  totalPrincipalPaise: bigint;
  totalInterestPaise: bigint;
  totalPayablePaise: bigint;
  installmentCount: number;
  /** `YYYY-MM-DD`. */
  firstDueDate: string;
  /** `YYYY-MM-DD`. */
  lastDueDate: string;
  installments: EmiInstallment[];
}
