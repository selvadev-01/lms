/**
 * Payment appropriation — how a repayment is split across what a borrower owes.
 *
 * # Why this lives beside `computeSchedule`
 *
 * The two halves of the money story belong together: one decides what is owed,
 * the other decides what a payment settles. Both are pure integer-paise
 * arithmetic with no I/O, which is what lets the API recompute an allocation
 * authoritatively at posting time without trusting anything a client sent, and
 * lets the same result be replayed from stored balances afterwards.
 *
 * # The two ordering rules
 *
 * Across obligations: **oldest due date first**. A borrower with three overdue
 * installments settles the oldest before the newest, which is what keeps
 * ageing, penalty exposure and any downstream provisioning honest.
 *
 * Within one obligation: **penalty → interest → principal → fees**. This order
 * is fixed by Rule 13 and is not configurable. No later category receives a
 * paisa while an earlier applicable category is still owed.
 *
 * # Determinism
 *
 * Same balances plus same amount must always produce the same split, and the
 * split must be reproducible from stored balances long afterwards (Scenario 8).
 * Two things make that true, and both are load-bearing:
 *
 *  1. The input array is **copied before sorting**, so the caller's row order —
 *     which is whatever the database happened to return — cannot influence the
 *     result, and the caller's array is never mutated.
 *  2. The sort key is `(dueDate, installmentNumber)`, with the installment
 *     number breaking ties. Two installments can share a due date; without the
 *     tiebreak their relative order would depend on the sort's stability and the
 *     input order, which is exactly the non-determinism rule 14 forbids.
 *
 * # Overpayment is an error, not a remainder
 *
 * `allocate` throws rather than returning money it could not place. Holding an
 * excess as unapplied credit is a real feature with real accounting — it needs a
 * liability account and a later application flow — and quietly leaving a
 * remainder in a field nobody reads is how that feature gets half-built. Until
 * it exists deliberately, tendering more than is owed is refused.
 */

/** The four components of a debt, in appropriation order. */
export type AllocationComponent = "PENALTY" | "INTEREST" | "PRINCIPAL" | "FEE";

/**
 * The order money is applied within a single obligation (Rule 13).
 *
 * Exported so a caller can render the rule rather than restate it, and so a
 * test can assert against the same constant the algorithm walks.
 */
export const APPROPRIATION_ORDER: readonly AllocationComponent[] = [
  "PENALTY",
  "INTEREST",
  "PRINCIPAL",
  "FEE",
] as const;

/**
 * One installment's authoritative outstanding balances.
 *
 * Every figure must come from a server-side read (Rule 38). These are
 * *outstanding* amounts, not contractual dues: a partially-paid installment
 * presents what remains, never what it originally billed.
 */
export interface AllocationTarget {
  emiId: string;
  /** `YYYY-MM-DD`. The primary sort key; compared as a string, which is safe for ISO dates. */
  dueDate: string;
  /** Breaks a due-date tie, so the ordering is total rather than merely mostly-defined. */
  installmentNumber: number;
  penaltyOutstandingPaise: bigint;
  interestOutstandingPaise: bigint;
  principalOutstandingPaise: bigint;
  /**
   * Always `0n` today: no module raises a fee yet. The path is built and tested
   * so that introducing fees is a change to what fills this field, not a change
   * to the appropriation algorithm.
   */
  feeOutstandingPaise: bigint;
}

/** One movement: this much of the payment settled this component of this EMI. */
export interface AllocationLine {
  emiId: string;
  component: AllocationComponent;
  amountPaise: bigint;
}

export interface AllocationResult {
  /**
   * The movements, in the order they were applied. Never contains a zero
   * amount — a line that moved nothing is not a fact worth storing, and writing
   * one would put rows in `collection_allocations` that mean nothing happened.
   */
  lines: readonly AllocationLine[];
  penaltyPaise: bigint;
  interestPaise: bigint;
  principalPaise: bigint;
  feesPaise: bigint;
  /** Always `0n` — `allocate` throws rather than leaving a remainder. */
  unallocatedPaise: bigint;
  /** Equals the amount passed in. The identity the database CHECK also asserts. */
  totalAllocatedPaise: bigint;
  /** Per-EMI totals, so a caller updates each installment row in one pass. */
  perEmiPaise: ReadonlyMap<string, bigint>;
  /** EMIs whose four components all reached zero — the ones now fully paid. */
  fullySettledEmiIds: readonly string[];
}

export type AllocationErrorCode =
  "NON_POSITIVE" | "NO_OUTSTANDING" | "OVERPAYMENT";

/**
 * Thrown when a payment cannot be appropriated.
 *
 * An exception rather than a partial result, for the same reason
 * `EmiCalculationError` is: a caller handed a half-complete allocation could
 * mistake it for success and post an unbalanced financial entry.
 */
export class AllocationError extends Error {
  readonly code: AllocationErrorCode;
  /** Present on OVERPAYMENT: the largest amount that would have been accepted. */
  readonly maxCollectablePaise?: bigint;

  constructor(
    code: AllocationErrorCode,
    message: string,
    maxCollectablePaise?: bigint,
  ) {
    super(message);
    this.name = "AllocationError";
    this.code = code;
    if (maxCollectablePaise !== undefined) {
      this.maxCollectablePaise = maxCollectablePaise;
    }
    // Restores the prototype chain under the CJS build's class downlevelling,
    // so `instanceof AllocationError` holds for API callers. Same reason
    // `EmiCalculationError` does it.
    Object.setPrototypeOf(this, AllocationError.prototype);
  }
}

/** Reads one component's outstanding balance off a target. */
function outstandingOf(
  target: AllocationTarget,
  component: AllocationComponent,
): bigint {
  switch (component) {
    case "PENALTY":
      return target.penaltyOutstandingPaise;
    case "INTEREST":
      return target.interestOutstandingPaise;
    case "PRINCIPAL":
      return target.principalOutstandingPaise;
    case "FEE":
      return target.feeOutstandingPaise;
  }
}

/** The total a target owes across all four components. */
function totalOutstandingOf(target: AllocationTarget): bigint {
  return (
    target.penaltyOutstandingPaise +
    target.interestOutstandingPaise +
    target.principalOutstandingPaise +
    target.feeOutstandingPaise
  );
}

/**
 * Splits `amountPaise` across `targets` by the two ordering rules above.
 *
 * @throws {AllocationError} `NON_POSITIVE` if the amount is zero or negative;
 *   `NO_OUTSTANDING` if nothing is owed; `OVERPAYMENT` if the amount exceeds
 *   everything owed.
 */
export function allocate(
  amountPaise: bigint,
  targets: readonly AllocationTarget[],
): AllocationResult {
  if (amountPaise <= 0n) {
    throw new AllocationError(
      "NON_POSITIVE",
      "A collection amount must be greater than zero",
    );
  }

  // A negative outstanding balance is not a payment problem, it is corrupt
  // data — and allocating against it would silently produce a split that does
  // not reconcile. Refuse rather than compute something wrong.
  for (const target of targets) {
    if (
      target.penaltyOutstandingPaise < 0n ||
      target.interestOutstandingPaise < 0n ||
      target.principalOutstandingPaise < 0n ||
      target.feeOutstandingPaise < 0n
    ) {
      throw new AllocationError(
        "NO_OUTSTANDING",
        `Installment ${target.installmentNumber} has a negative outstanding balance and cannot be allocated against`,
      );
    }
  }

  const totalOutstanding = targets.reduce(
    (sum, target) => sum + totalOutstandingOf(target),
    0n,
  );

  if (totalOutstanding === 0n) {
    throw new AllocationError(
      "NO_OUTSTANDING",
      "This loan has no outstanding balance to collect against",
    );
  }

  if (amountPaise > totalOutstanding) {
    throw new AllocationError(
      "OVERPAYMENT",
      `The amount exceeds the outstanding balance of ${totalOutstanding} paise`,
      totalOutstanding,
    );
  }

  // Copy before sorting: the caller's array is not ours to reorder, and the
  // database's row order must not reach the result. See the header.
  const ordered = [...targets].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return a.installmentNumber - b.installmentNumber;
  });

  const lines: AllocationLine[] = [];
  const perEmiPaise = new Map<string, bigint>();
  const fullySettledEmiIds: string[] = [];
  const totals: Record<AllocationComponent, bigint> = {
    PENALTY: 0n,
    INTEREST: 0n,
    PRINCIPAL: 0n,
    FEE: 0n,
  };

  let remaining = amountPaise;

  for (const target of ordered) {
    if (remaining === 0n) break;

    const owedBefore = totalOutstandingOf(target);
    let consumedHere = 0n;

    for (const component of APPROPRIATION_ORDER) {
      if (remaining === 0n) break;

      const outstanding = outstandingOf(target, component);
      if (outstanding === 0n) continue;

      const applied = outstanding < remaining ? outstanding : remaining;

      lines.push({ emiId: target.emiId, component, amountPaise: applied });
      totals[component] += applied;
      consumedHere += applied;
      remaining -= applied;
    }

    if (consumedHere > 0n) {
      perEmiPaise.set(
        target.emiId,
        (perEmiPaise.get(target.emiId) ?? 0n) + consumedHere,
      );
      // Fully settled means this payment cleared everything the installment
      // still owed — not that the installment was cheap. Compared against what
      // was outstanding coming in, so a previously part-paid EMI settles
      // correctly too.
      if (consumedHere === owedBefore) fullySettledEmiIds.push(target.emiId);
    }
  }

  // Unreachable: the overpayment guard above already proved
  // `amountPaise <= totalOutstanding`, and the walk consumes greedily. Kept as
  // an assertion because the alternative to noticing here is posting an
  // unbalanced journal entry, and a wrong split must never reach the ledger.
  if (remaining !== 0n) {
    throw new AllocationError(
      "OVERPAYMENT",
      `Allocation left ${remaining} paise unapplied, which should be impossible`,
      totalOutstanding,
    );
  }

  return {
    lines,
    penaltyPaise: totals.PENALTY,
    interestPaise: totals.INTEREST,
    principalPaise: totals.PRINCIPAL,
    feesPaise: totals.FEE,
    unallocatedPaise: 0n,
    totalAllocatedPaise: amountPaise,
    perEmiPaise,
    fullySettledEmiIds,
  };
}
