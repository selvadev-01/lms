/**
 * Penal interest assessment (Module 13).
 *
 * # Why Module 13 owns this and Module 11 does not
 *
 * `CollectionService` allocates against `Penalty` rows that already exist and
 * never computes one — its own comment says so, and names this module as the
 * owner of assessment. That split is deliberate: a collection must be able to
 * settle a penalty without deciding whether it should have been charged, and an
 * assessment must be reproducible without a payment having happened.
 *
 * # Deterministic, not scheduled
 *
 * Rule 13 permits either a scheduled job or a deterministic calculation from
 * authoritative dates and balances. This is the second, for the same reason
 * `deriveEmiStatus` derives overdue status at read time: a nightly sweep makes
 * the charge depend on whether the job ran, and a missed run silently
 * undercharges every borrower until someone notices. A pure function of
 * (rule, balance, dates) always produces the same figure, can be replayed years
 * later from stored inputs, and has no infrastructure to fail.
 *
 * Scenario 18 requires exactly that: same inputs, same result, all integer
 * paise.
 *
 * # Every value is bigint
 *
 * Rates are basis points and amounts are paise, both integers, and the
 * arithmetic never leaves `bigint`. Rule 11 forbids floating-point money, and a
 * daily percentage accrual is precisely where a `number` would start losing
 * paise — a rate of 0.05% per day on a balance of ₹1,00,000 over 37 days is the
 * kind of repeated multiply-and-add that accumulates representation error.
 */

/**
 * How a penalty is computed, matching the `penalty_calculation_type` database
 * enum.
 *
 * The four the schema already declares. `FIXED_AMOUNT` charges once regardless
 * of how late the borrower is; the other three scale with the delay, which is
 * why they take a day count.
 */
export type PenaltyCalculationType =
  | "FIXED_AMOUNT"
  | "DAILY_FIXED_AMOUNT"
  | "PERCENTAGE_OUTSTANDING_PER_DAY"
  | "PERCENTAGE_EMI_PER_DAY";

/** The configured rule, as `PenaltyRule` stores it. */
export interface PenaltyRuleInput {
  calculationType: PenaltyCalculationType;
  /** Basis points. Required by the two percentage types, ignored by the others. */
  rateBps: bigint | null;
  /** Required by the two fixed types, ignored by the others. */
  fixedAmountPaise: bigint | null;
  /**
   * Days after the due date before a penalty applies at all.
   *
   * Answers Open Question 10's grace-period half. A loan-level override may
   * replace this; the caller resolves which applies before calling.
   */
  graceDays: number;
}

/** What the penalty is charged against. */
export interface PenaltyBasis {
  /**
   * The overdue balance, for `PERCENTAGE_OUTSTANDING_PER_DAY`.
   *
   * Answers Open Question 9. The outstanding amount, not the contractual EMI:
   * a borrower who has paid most of an installment should not be penalised as
   * though they had paid none, and Rule 9 keeps the contractual figure
   * untouched by payments precisely so both readings remain available.
   */
  outstandingPaise: bigint;
  /**
   * The contractual installment amount, for `PERCENTAGE_EMI_PER_DAY`.
   *
   * The figure the borrower agreed to, never rewritten by a part payment
   * (Rule 9). This is what makes the two percentage types genuinely different
   * rather than two spellings of one.
   */
  emiAmountPaise: bigint;
  /**
   * Days past due, from `daysPastDue` in `./overdue.js`.
   *
   * Taken as an argument rather than computed here so that one day-counting
   * implementation serves both the ageing report and the charge. A penalty for
   * 31 days against a loan reported 30 days late is a discrepancy nobody can
   * explain.
   */
  daysPastDue: number;
}

/**
 * The audit trail of one assessment, stored verbatim in
 * `Penalty.calculationSnapshot`.
 *
 * # Why the inputs are snapshotted rather than re-derived
 *
 * Rule 12 requires accrual be replayable. Re-deriving an old charge from
 * today's configuration would produce today's answer, not the one that was
 * made: rules get edited, grace periods change, balances move. Storing what the
 * calculation actually saw is what lets a charge be defended years later, and
 * what makes Scenario 20's correction path meaningful — you cannot show a
 * posting was wrong without knowing what it was based on.
 *
 * Serialized as strings because this lands in a JSON column and `bigint` has no
 * JSON representation.
 */
export interface PenaltyCalculationSnapshot {
  calculationType: PenaltyCalculationType;
  rateBps: string | null;
  fixedAmountPaise: string | null;
  graceDays: number;
  daysPastDue: number;
  /** Days actually charged for: `daysPastDue` less the grace period. */
  chargeableDays: number;
  outstandingPaise: string;
  emiAmountPaise: string;
  /** The basis the percentage was applied to, for the percentage types. */
  basisPaise: string;
}

export interface PenaltyAssessment {
  amountPaise: bigint;
  snapshot: PenaltyCalculationSnapshot;
}

/** Basis points per whole unit: 10,000 bps = 100%. */
const BPS_DIVISOR = 10000n;

/**
 * Assesses the penalty a rule produces for one overdue obligation.
 *
 * Returns zero — with a snapshot explaining why — rather than throwing, when
 * the borrower is inside the grace period or the basis is nothing. A zero
 * charge is a real, defensible answer, and forcing the caller into a try/catch
 * to discover "no penalty applies" would make the ordinary case the exceptional
 * one. A misconfigured *rule*, by contrast, does throw: see below.
 *
 * # Rounding
 *
 * Integer division truncates, so a fractional paisa is discarded rather than
 * rounded up. Deliberate: the borrower is never charged a paisa the formula did
 * not produce, and truncation is the only rounding mode that is stable under
 * replay without carrying a remainder between assessments.
 */
export function assessPenalty(
  rule: PenaltyRuleInput,
  basis: PenaltyBasis,
): PenaltyAssessment {
  const chargeableDays = Math.max(0, basis.daysPastDue - rule.graceDays);

  const basisPaise = basisFor(rule.calculationType, basis);

  const snapshot: PenaltyCalculationSnapshot = {
    calculationType: rule.calculationType,
    rateBps: rule.rateBps === null ? null : rule.rateBps.toString(),
    fixedAmountPaise:
      rule.fixedAmountPaise === null ? null : rule.fixedAmountPaise.toString(),
    graceDays: rule.graceDays,
    daysPastDue: basis.daysPastDue,
    chargeableDays,
    outstandingPaise: basis.outstandingPaise.toString(),
    emiAmountPaise: basis.emiAmountPaise.toString(),
    basisPaise: basisPaise.toString(),
  };

  // Inside the grace period, or nothing is owed. Both are legitimate zeroes.
  if (chargeableDays <= 0 || basisPaise <= 0n) {
    return { amountPaise: 0n, snapshot };
  }

  return { amountPaise: compute(rule, chargeableDays, basisPaise), snapshot };
}

/**
 * Which balance the charge applies to.
 *
 * The two fixed types have no basis of their own, but the outstanding amount
 * still gates them: a fully-settled obligation attracts no flat fee either, and
 * returning it here is what makes the `basisPaise <= 0n` guard above cover all
 * four types with one condition.
 */
function basisFor(
  calculationType: PenaltyCalculationType,
  basis: PenaltyBasis,
): bigint {
  switch (calculationType) {
    case "PERCENTAGE_EMI_PER_DAY":
      return basis.emiAmountPaise;
    case "PERCENTAGE_OUTSTANDING_PER_DAY":
    case "FIXED_AMOUNT":
    case "DAILY_FIXED_AMOUNT":
      return basis.outstandingPaise;
    default: {
      // Exhaustiveness: adding a calculation type without extending this switch
      // is a compile error rather than a silent zero charge.
      const unreachable: never = calculationType;
      throw new PenaltyConfigurationError(
        "UNSUPPORTED_CALCULATION_TYPE",
        `Unsupported penalty calculation type: ${String(unreachable)}`,
      );
    }
  }
}

function compute(
  rule: PenaltyRuleInput,
  chargeableDays: number,
  basisPaise: bigint,
): bigint {
  switch (rule.calculationType) {
    case "FIXED_AMOUNT":
      // Charged once, however late. The day count gates it — see the caller —
      // but does not multiply it.
      return requireFixedAmount(rule);

    case "DAILY_FIXED_AMOUNT":
      return requireFixedAmount(rule) * BigInt(chargeableDays);

    case "PERCENTAGE_OUTSTANDING_PER_DAY":
    case "PERCENTAGE_EMI_PER_DAY": {
      const rateBps = requireRate(rule);
      // Multiply before dividing, always. Dividing first would truncate the
      // per-day figure to whole paise and then multiply the error by the day
      // count — on a small balance that rounds the entire charge to zero.
      return (basisPaise * rateBps * BigInt(chargeableDays)) / BPS_DIVISOR;
    }

    default: {
      const unreachable: never = rule.calculationType;
      throw new PenaltyConfigurationError(
        "UNSUPPORTED_CALCULATION_TYPE",
        `Unsupported penalty calculation type: ${String(unreachable)}`,
      );
    }
  }
}

function requireFixedAmount(rule: PenaltyRuleInput): bigint {
  if (rule.fixedAmountPaise === null || rule.fixedAmountPaise < 0n) {
    throw new PenaltyConfigurationError(
      "MISSING_FIXED_AMOUNT",
      `A ${rule.calculationType} penalty rule needs a non-negative fixed amount.`,
    );
  }
  return rule.fixedAmountPaise;
}

function requireRate(rule: PenaltyRuleInput): bigint {
  if (rule.rateBps === null || rule.rateBps < 0n) {
    throw new PenaltyConfigurationError(
      "MISSING_RATE",
      `A ${rule.calculationType} penalty rule needs a non-negative rate in basis points.`,
    );
  }
  return rule.rateBps;
}

/**
 * Thrown when a rule cannot produce a figure — a percentage rule with no rate,
 * a fixed rule with no amount.
 *
 * An exception rather than a zero charge, unlike the grace-period case above.
 * Zero would be indistinguishable from "no penalty applies" and would quietly
 * forgive every borrower under a misconfigured rule; Scenario 51's principle
 * applies here too, one level down: do not fabricate a result from inconsistent
 * inputs.
 */
export class PenaltyConfigurationError extends Error {
  /** Machine-readable, so an API layer can map it without matching on prose. */
  readonly code: PenaltyErrorCode;

  constructor(code: PenaltyErrorCode, message: string) {
    super(message);
    this.name = "PenaltyConfigurationError";
    this.code = code;
    // Restores the prototype chain under the CJS build's ES5-ish class
    // downlevelling, so `instanceof` holds for API callers — the same reason
    // `EmiCalculationError` does it.
    Object.setPrototypeOf(this, PenaltyConfigurationError.prototype);
  }
}

export type PenaltyErrorCode =
  | "MISSING_RATE"
  | "MISSING_FIXED_AMOUNT"
  | "UNSUPPORTED_CALCULATION_TYPE";
