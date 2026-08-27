/**
 * Tests for payment appropriation.
 *
 * The properties below are load-bearing, and each maps to a rule or scenario in
 * the Module 11 source. A tidy-up that "simplifies" any of them changes what a
 * borrower is charged:
 *
 *  - The order within an obligation is penalty → interest → principal → fees,
 *    and no later category is touched while an earlier one is owed (Rule 13,
 *    Scenario 7). Reordering these is a business-rule change, not a refactor.
 *  - Obligations are consumed oldest due date first, ties broken by installment
 *    number (Scenario 8's replayability depends on a *total* order).
 *  - `allocate` copies before sorting, so caller row order cannot change the
 *    result and the caller's array is never mutated (Scenario 8).
 *  - Overpayment throws rather than leaving a remainder. A remainder silently
 *    stored is how half an unapplied-credit feature gets built (Rule 33).
 *  - Zero-amount lines are never emitted — a row saying nothing moved is not a
 *    fact worth storing.
 */

import { describe, expect, it } from "vitest";

import {
  allocate,
  AllocationError,
  APPROPRIATION_ORDER,
  type AllocationTarget,
} from "./allocation.js";

function target(overrides: Partial<AllocationTarget> = {}): AllocationTarget {
  return {
    emiId: "emi-1",
    dueDate: "2026-01-10",
    installmentNumber: 1,
    penaltyOutstandingPaise: 0n,
    interestOutstandingPaise: 0n,
    principalOutstandingPaise: 0n,
    feeOutstandingPaise: 0n,
    ...overrides,
  };
}

/** An installment owing 100 penalty, 200 interest, 700 principal — 1000 total. */
function standardEmi(
  emiId: string,
  dueDate: string,
  installmentNumber: number,
): AllocationTarget {
  return target({
    emiId,
    dueDate,
    installmentNumber,
    penaltyOutstandingPaise: 100n,
    interestOutstandingPaise: 200n,
    principalOutstandingPaise: 700n,
  });
}

describe("allocate — appropriation order", () => {
  it("settles every component when the payment covers the whole obligation", () => {
    // Scenario 6.
    const result = allocate(1000n, [standardEmi("emi-1", "2026-01-10", 1)]);

    expect(result.penaltyPaise).toBe(100n);
    expect(result.interestPaise).toBe(200n);
    expect(result.principalPaise).toBe(700n);
    expect(result.feesPaise).toBe(0n);
    expect(result.totalAllocatedPaise).toBe(1000n);
    expect(result.unallocatedPaise).toBe(0n);
    expect(result.fullySettledEmiIds).toEqual(["emi-1"]);
  });

  it("fills penalty before interest before principal on a part payment", () => {
    // Scenario 7. 250 covers all penalty (100) and part of interest (150),
    // and must not reach principal at all.
    const result = allocate(250n, [standardEmi("emi-1", "2026-01-10", 1)]);

    expect(result.penaltyPaise).toBe(100n);
    expect(result.interestPaise).toBe(150n);
    expect(result.principalPaise).toBe(0n);
    expect(result.lines.map((line) => line.component)).toEqual([
      "PENALTY",
      "INTEREST",
    ]);
    expect(result.fullySettledEmiIds).toEqual([]);
  });

  it.each([
    [50n, { penalty: 50n, interest: 0n, principal: 0n }],
    [100n, { penalty: 100n, interest: 0n, principal: 0n }],
    [101n, { penalty: 100n, interest: 1n, principal: 0n }],
    [300n, { penalty: 100n, interest: 200n, principal: 0n }],
    [301n, { penalty: 100n, interest: 200n, principal: 1n }],
    [1000n, { penalty: 100n, interest: 200n, principal: 700n }],
  ])(
    "allocates %s paise strictly in order, never skipping ahead",
    (amount, expected) => {
      const result = allocate(amount, [standardEmi("emi-1", "2026-01-10", 1)]);

      expect(result.penaltyPaise).toBe(expected.penalty);
      expect(result.interestPaise).toBe(expected.interest);
      expect(result.principalPaise).toBe(expected.principal);
    },
  );

  it("skips a component with nothing outstanding rather than emitting a zero line", () => {
    const result = allocate(500n, [
      target({
        emiId: "emi-1",
        penaltyOutstandingPaise: 0n,
        interestOutstandingPaise: 200n,
        principalOutstandingPaise: 700n,
      }),
    ]);

    expect(result.lines.map((line) => line.component)).toEqual([
      "INTEREST",
      "PRINCIPAL",
    ]);
    expect(result.lines.every((line) => line.amountPaise > 0n)).toBe(true);
  });

  it("reaches fees only after principal is fully settled", () => {
    // The fee path has no source today, so this is the one place its ordering
    // is pinned. Without it, introducing fees later could quietly land them
    // ahead of principal.
    const withFees = target({
      emiId: "emi-1",
      penaltyOutstandingPaise: 100n,
      interestOutstandingPaise: 200n,
      principalOutstandingPaise: 700n,
      feeOutstandingPaise: 50n,
    });

    expect(allocate(1000n, [withFees]).feesPaise).toBe(0n);
    expect(allocate(1001n, [withFees]).feesPaise).toBe(1n);
    expect(allocate(1050n, [withFees]).feesPaise).toBe(50n);
  });

  it("keeps APPROPRIATION_ORDER as the documented rule", () => {
    // Guards the constant itself: the algorithm walks it, so a reordering here
    // silently changes every allocation in the system.
    expect(APPROPRIATION_ORDER).toEqual([
      "PENALTY",
      "INTEREST",
      "PRINCIPAL",
      "FEE",
    ]);
  });
});

describe("allocate — ordering across installments", () => {
  const three = [
    standardEmi("emi-1", "2026-01-10", 1),
    standardEmi("emi-2", "2026-02-10", 2),
    standardEmi("emi-3", "2026-03-10", 3),
  ];

  it("consumes the oldest due date first", () => {
    // 1500 settles emi-1 entirely (1000) then 500 of emi-2, and must not touch
    // emi-3 at all.
    const result = allocate(1500n, three);

    expect(result.perEmiPaise.get("emi-1")).toBe(1000n);
    expect(result.perEmiPaise.get("emi-2")).toBe(500n);
    expect(result.perEmiPaise.has("emi-3")).toBe(false);
    expect(result.fullySettledEmiIds).toEqual(["emi-1"]);
  });

  it("restarts the component order for each installment", () => {
    // The oldest EMI's principal is paid before the next EMI's penalty: the
    // ordering is within an obligation, not across the whole loan.
    const result = allocate(1100n, three);

    expect(result.lines).toEqual([
      { emiId: "emi-1", component: "PENALTY", amountPaise: 100n },
      { emiId: "emi-1", component: "INTEREST", amountPaise: 200n },
      { emiId: "emi-1", component: "PRINCIPAL", amountPaise: 700n },
      { emiId: "emi-2", component: "PENALTY", amountPaise: 100n },
    ]);
  });

  it("breaks a due-date tie on installment number", () => {
    const sameDay = [
      standardEmi("emi-b", "2026-01-10", 2),
      standardEmi("emi-a", "2026-01-10", 1),
    ];

    const result = allocate(1000n, sameDay);

    expect(result.perEmiPaise.get("emi-a")).toBe(1000n);
    expect(result.perEmiPaise.has("emi-b")).toBe(false);
  });

  it("marks a previously part-paid installment settled when its remainder clears", () => {
    // Scenario 22 against an EMI that already had a payment: "fully settled"
    // means the outstanding coming in reached zero, not that the full
    // contractual amount was paid now.
    const partPaid = target({
      emiId: "emi-1",
      penaltyOutstandingPaise: 0n,
      interestOutstandingPaise: 0n,
      principalOutstandingPaise: 250n,
    });

    const result = allocate(250n, [partPaid]);

    expect(result.fullySettledEmiIds).toEqual(["emi-1"]);
  });
});

describe("allocate — determinism and purity", () => {
  const targets = [
    standardEmi("emi-3", "2026-03-10", 3),
    standardEmi("emi-1", "2026-01-10", 1),
    standardEmi("emi-2", "2026-02-10", 2),
  ];

  it("produces an identical result when run twice", () => {
    // Scenario 8.
    const first = allocate(1500n, targets);
    const second = allocate(1500n, targets);

    expect(second.lines).toEqual(first.lines);
    expect(second.totalAllocatedPaise).toBe(first.totalAllocatedPaise);
  });

  it("ignores the input order, so a database row order cannot change the split", () => {
    // Scenario 8's replayability: the same stored balances must reproduce the
    // same allocation regardless of how they were queried.
    const shuffled = [targets[2]!, targets[0]!, targets[1]!];

    expect(allocate(1500n, shuffled).lines).toEqual(
      allocate(1500n, targets).lines,
    );
  });

  it("does not mutate the caller's array", () => {
    const original = [...targets];

    allocate(1500n, targets);

    expect(targets).toEqual(original);
    expect(targets[0]!.emiId).toBe("emi-3");
  });
});

describe("allocate — the money identity", () => {
  it("always splits exactly the amount tendered", () => {
    // The identity the `collections_allocation_sums` CHECK enforces in the
    // database, asserted here across the whole plausible range so the two can
    // never disagree.
    const targets = [
      target({
        emiId: "emi-1",
        dueDate: "2026-01-10",
        installmentNumber: 1,
        penaltyOutstandingPaise: 137n,
        interestOutstandingPaise: 2_411n,
        principalOutstandingPaise: 8_642n,
        feeOutstandingPaise: 53n,
      }),
      target({
        emiId: "emi-2",
        dueDate: "2026-02-10",
        installmentNumber: 2,
        penaltyOutstandingPaise: 0n,
        interestOutstandingPaise: 2_150n,
        principalOutstandingPaise: 8_903n,
      }),
    ];

    const total = 137n + 2_411n + 8_642n + 53n + 2_150n + 8_903n;

    for (let amount = 1n; amount <= total; amount += 7n) {
      const result = allocate(amount, targets);

      const summed =
        result.penaltyPaise +
        result.interestPaise +
        result.principalPaise +
        result.feesPaise +
        result.unallocatedPaise;

      expect(summed).toBe(amount);
      expect(result.totalAllocatedPaise).toBe(amount);

      const lineSum = result.lines.reduce(
        (sum, line) => sum + line.amountPaise,
        0n,
      );
      expect(lineSum).toBe(amount);

      const perEmiSum = [...result.perEmiPaise.values()].reduce(
        (sum, value) => sum + value,
        0n,
      );
      expect(perEmiSum).toBe(amount);
    }
  });

  it("never emits a zero-amount line at any amount", () => {
    const targets = [
      standardEmi("emi-1", "2026-01-10", 1),
      standardEmi("emi-2", "2026-02-10", 2),
    ];

    for (let amount = 1n; amount <= 2000n; amount += 1n) {
      for (const line of allocate(amount, targets).lines) {
        expect(line.amountPaise).toBeGreaterThan(0n);
      }
    }
  });
});

describe("allocate — refusals", () => {
  const targets = [standardEmi("emi-1", "2026-01-10", 1)];

  it.each([0n, -1n, -5000n])("refuses %s as a collection amount", (amount) => {
    // Scenarios 9, 10.
    expect(() => allocate(amount, targets)).toThrow(AllocationError);
    try {
      allocate(amount, targets);
    } catch (error) {
      expect((error as AllocationError).code).toBe("NON_POSITIVE");
    }
  });

  it("refuses a payment when nothing is outstanding", () => {
    // Scenario 30: a fully settled loan takes no further ordinary collection.
    try {
      allocate(100n, [target({ emiId: "emi-1" })]);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as AllocationError).code).toBe("NO_OUTSTANDING");
    }
  });

  it("refuses a payment against an empty schedule", () => {
    try {
      allocate(100n, []);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as AllocationError).code).toBe("NO_OUTSTANDING");
    }
  });

  it("refuses an overpayment and reports the maximum collectable", () => {
    // The decided scope: excess is rejected, never held as unapplied credit.
    // The maximum is surfaced so the caller can tell the user what to tender.
    try {
      allocate(1001n, targets);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as AllocationError).code).toBe("OVERPAYMENT");
      expect((error as AllocationError).maxCollectablePaise).toBe(1000n);
    }
  });

  it("accepts a payment of exactly the outstanding balance", () => {
    // The boundary the overpayment guard sits on: one paisa more is refused,
    // this exact figure must not be.
    expect(allocate(1000n, targets).totalAllocatedPaise).toBe(1000n);
  });

  it("refuses a negative outstanding balance as corrupt data", () => {
    try {
      allocate(100n, [
        target({ emiId: "emi-1", principalOutstandingPaise: -1n }),
      ]);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as AllocationError).code).toBe("NO_OUTSTANDING");
    }
  });

  it("is catchable as AllocationError across the CJS build boundary", () => {
    // The prototype-chain restoration in the constructor is what makes this
    // hold; without it `instanceof` fails for the API's CommonJS consumer.
    try {
      allocate(0n, targets);
    } catch (error) {
      expect(error).toBeInstanceOf(AllocationError);
      expect((error as Error).name).toBe("AllocationError");
    }
  });
});
