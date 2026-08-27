/**
 * Tests for penal interest assessment.
 *
 * The load-bearing properties, each mapping to a rule or scenario in the Module
 * 13 source. A tidy-up that "simplifies" any of them changes what a borrower is
 * charged:
 *
 *  1. Same inputs always produce the same figure, and every value stays in
 *     `bigint` (Rule 11, Scenario 18). No paisa passes through a `number`.
 *  2. The grace period is subtracted from the day count, not from the amount,
 *     and a borrower inside it is charged nothing.
 *  3. Multiplication happens before division. Dividing first truncates the
 *     per-day figure to whole paise and multiplies the error by the day count —
 *     on a small balance that silently rounds the whole charge to zero.
 *  4. `FIXED_AMOUNT` is charged once however late; `DAILY_FIXED_AMOUNT` scales.
 *     Collapsing the two would change every flat-fee rule into a daily one.
 *  5. The two percentage types read different bases — outstanding vs the
 *     contractual EMI — which is what makes them genuinely different rules
 *     rather than two spellings of one (Rule 9, Open Question 9).
 *  6. A misconfigured rule throws; a grace period or a settled balance returns
 *     zero. Conflating the two would quietly forgive every borrower under a
 *     broken rule (Scenario 51's principle, one level down).
 *  7. The snapshot records what the calculation actually saw, so a charge can be
 *     replayed and defended later (Rule 12).
 */

import { describe, expect, it } from "vitest";

import {
  assessPenalty,
  PenaltyConfigurationError,
  type PenaltyBasis,
  type PenaltyRuleInput,
} from "./penalty.js";

const rule = (overrides: Partial<PenaltyRuleInput> = {}): PenaltyRuleInput => ({
  calculationType: "PERCENTAGE_OUTSTANDING_PER_DAY",
  rateBps: 50n, // 0.5% per day
  fixedAmountPaise: null,
  graceDays: 0,
  ...overrides,
});

const basis = (overrides: Partial<PenaltyBasis> = {}): PenaltyBasis => ({
  outstandingPaise: 10000000n, // ₹1,00,000
  emiAmountPaise: 5000000n, // ₹50,000
  daysPastDue: 10,
  ...overrides,
});

describe("grace period", () => {
  it("charges nothing inside the grace period", () => {
    const result = assessPenalty(
      rule({ graceDays: 15 }),
      basis({ daysPastDue: 10 }),
    );
    expect(result.amountPaise).toBe(0n);
    expect(result.snapshot.chargeableDays).toBe(0);
  });

  it("charges nothing on the last day of grace", () => {
    const result = assessPenalty(
      rule({ graceDays: 10 }),
      basis({ daysPastDue: 10 }),
    );
    expect(result.amountPaise).toBe(0n);
  });

  /** The grace period reduces the days charged, not the amount per day. */
  it("charges for the days beyond grace only", () => {
    const withGrace = assessPenalty(
      rule({ graceDays: 5 }),
      basis({ daysPastDue: 15 }),
    );
    const without = assessPenalty(
      rule({ graceDays: 0 }),
      basis({ daysPastDue: 10 }),
    );
    expect(withGrace.snapshot.chargeableDays).toBe(10);
    expect(withGrace.amountPaise).toBe(without.amountPaise);
  });
});

describe("PERCENTAGE_OUTSTANDING_PER_DAY", () => {
  /** ₹1,00,000 × 0.5% × 10 days = ₹5,000 = 500000 paise. */
  it("applies the rate to the outstanding balance per day", () => {
    const result = assessPenalty(rule(), basis());
    expect(result.amountPaise).toBe(500000n);
  });

  it("scales linearly with the day count", () => {
    const ten = assessPenalty(rule(), basis({ daysPastDue: 10 }));
    const twenty = assessPenalty(rule(), basis({ daysPastDue: 20 }));
    expect(twenty.amountPaise).toBe(ten.amountPaise * 2n);
  });

  /**
   * Property 3. With a balance of ₹1 and a rate of 0.05%/day over 37 days, a
   * divide-first implementation computes floor(100 × 5 / 10000) = 0 per day and
   * charges nothing at all. Multiplying first gives floor(100 × 5 × 37 / 10000)
   * = 1 paisa, which is the honest answer.
   */
  it("multiplies before dividing so small balances are not rounded away", () => {
    const result = assessPenalty(
      rule({ rateBps: 5n }),
      basis({ outstandingPaise: 100n, daysPastDue: 37 }),
    );
    expect(result.amountPaise).toBe(1n);
  });

  /** Truncation, not rounding up: never a paisa the formula did not produce. */
  it("truncates a fractional paisa rather than rounding up", () => {
    // 100 × 5 × 36 / 10000 = 1.8 -> 1
    const result = assessPenalty(
      rule({ rateBps: 5n }),
      basis({ outstandingPaise: 100n, daysPastDue: 36 }),
    );
    expect(result.amountPaise).toBe(1n);
  });

  it("charges nothing when the balance is settled", () => {
    const result = assessPenalty(rule(), basis({ outstandingPaise: 0n }));
    expect(result.amountPaise).toBe(0n);
  });
});

describe("PERCENTAGE_EMI_PER_DAY", () => {
  /**
   * Property 5. Rule 9 keeps the contractual EMI untouched by part payments
   * precisely so both readings stay available; a rule written against the EMI
   * must not quietly follow the outstanding balance down.
   */
  it("applies the rate to the contractual EMI, not the outstanding balance", () => {
    const result = assessPenalty(
      rule({ calculationType: "PERCENTAGE_EMI_PER_DAY" }),
      basis({ outstandingPaise: 100n, emiAmountPaise: 5000000n }),
    );
    // ₹50,000 × 0.5% × 10 days = ₹2,500
    expect(result.amountPaise).toBe(250000n);
    expect(result.snapshot.basisPaise).toBe("5000000");
  });

  it("differs from the outstanding-based rule on a part-paid installment", () => {
    const partlyPaid = basis({
      outstandingPaise: 1000000n,
      emiAmountPaise: 5000000n,
    });
    const onEmi = assessPenalty(
      rule({ calculationType: "PERCENTAGE_EMI_PER_DAY" }),
      partlyPaid,
    );
    const onOutstanding = assessPenalty(
      rule({ calculationType: "PERCENTAGE_OUTSTANDING_PER_DAY" }),
      partlyPaid,
    );
    expect(onEmi.amountPaise).not.toBe(onOutstanding.amountPaise);
  });
});

describe("fixed amount rules", () => {
  /** Property 4. Charged once, however late the borrower is. */
  it("FIXED_AMOUNT does not scale with the day count", () => {
    const rate = rule({
      calculationType: "FIXED_AMOUNT",
      rateBps: null,
      fixedAmountPaise: 50000n,
    });
    expect(assessPenalty(rate, basis({ daysPastDue: 1 })).amountPaise).toBe(
      50000n,
    );
    expect(assessPenalty(rate, basis({ daysPastDue: 400 })).amountPaise).toBe(
      50000n,
    );
  });

  it("DAILY_FIXED_AMOUNT scales with the day count", () => {
    const rate = rule({
      calculationType: "DAILY_FIXED_AMOUNT",
      rateBps: null,
      fixedAmountPaise: 10000n,
    });
    expect(assessPenalty(rate, basis({ daysPastDue: 7 })).amountPaise).toBe(
      70000n,
    );
  });

  /** A flat fee does not attach to an obligation that owes nothing either. */
  it("charges no flat fee against a settled obligation", () => {
    const rate = rule({
      calculationType: "FIXED_AMOUNT",
      rateBps: null,
      fixedAmountPaise: 50000n,
    });
    expect(assessPenalty(rate, basis({ outstandingPaise: 0n })).amountPaise).toBe(
      0n,
    );
  });
});

describe("misconfiguration", () => {
  /**
   * Property 6. Zero would be indistinguishable from "no penalty applies" and
   * would silently forgive every borrower under a broken rule.
   */
  it("throws when a percentage rule has no rate", () => {
    expect(() => assessPenalty(rule({ rateBps: null }), basis())).toThrow(
      PenaltyConfigurationError,
    );
  });

  it("throws when a fixed rule has no amount", () => {
    expect(() =>
      assessPenalty(
        rule({
          calculationType: "DAILY_FIXED_AMOUNT",
          rateBps: null,
          fixedAmountPaise: null,
        }),
        basis(),
      ),
    ).toThrow(PenaltyConfigurationError);
  });

  it("carries a machine-readable code", () => {
    try {
      assessPenalty(rule({ rateBps: null }), basis());
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PenaltyConfigurationError);
      expect((error as PenaltyConfigurationError).code).toBe("MISSING_RATE");
    }
  });

  it("does not throw before the grace period has elapsed", () => {
    // The rule is broken, but nothing is chargeable, so nothing is computed.
    const result = assessPenalty(
      rule({ rateBps: null, graceDays: 30 }),
      basis({ daysPastDue: 10 }),
    );
    expect(result.amountPaise).toBe(0n);
  });
});

describe("determinism and the snapshot", () => {
  /** Scenario 18: the same inputs produce the same result, every time. */
  it("returns an identical result for identical inputs", () => {
    const config = rule({ rateBps: 37n, graceDays: 3 });
    const target = basis({ outstandingPaise: 987654321n, daysPastDue: 91 });
    expect(assessPenalty(config, target)).toEqual(
      assessPenalty(config, target),
    );
  });

  /** Rule 12: a charge must be replayable from what the calculation saw. */
  it("records the inputs the calculation used", () => {
    const result = assessPenalty(
      rule({ rateBps: 50n, graceDays: 5 }),
      basis({ outstandingPaise: 10000000n, daysPastDue: 15 }),
    );
    expect(result.snapshot).toEqual({
      calculationType: "PERCENTAGE_OUTSTANDING_PER_DAY",
      rateBps: "50",
      fixedAmountPaise: null,
      graceDays: 5,
      daysPastDue: 15,
      chargeableDays: 10,
      outstandingPaise: "10000000",
      emiAmountPaise: "5000000",
      basisPaise: "10000000",
    });
  });

  /** The snapshot must survive a JSON round trip — it lands in a Json column. */
  it("produces a snapshot that is JSON-serializable", () => {
    const result = assessPenalty(rule(), basis());
    expect(JSON.parse(JSON.stringify(result.snapshot))).toEqual(
      result.snapshot,
    );
  });

  /**
   * Property 1. A balance beyond `Number.MAX_SAFE_INTEGER` must survive intact;
   * a `number` anywhere in the chain would lose paise here.
   */
  it("stays exact on balances beyond a double's precision", () => {
    const result = assessPenalty(
      rule({ rateBps: 10000n }), // 100% per day, to keep the arithmetic checkable
      basis({ outstandingPaise: 9007199254740993n, daysPastDue: 1 }),
    );
    expect(result.amountPaise).toBe(9007199254740993n);
  });
});
