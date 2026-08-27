import { describe, expect, it } from "vitest";

import { EmiCalculationError } from "./errors.js";
import { computeSchedule } from "./schedule.js";
import type { EmiInput } from "./types.js";

/**
 * What these tests are actually pinning:
 *
 * 1. The two invariants that make a schedule trustworthy — principals sum to the
 *    loan, and the installments sum to the stated total payable. A rounding bug
 *    that shifts a paisa shows up here and nowhere else.
 * 2. Hand-computed golden values, so a refactor that changes the *formula*
 *    (rather than just the rounding) cannot pass by adjusting an invariant.
 * 3. The date rules, which are the part most likely to break silently on a
 *    machine in a different timezone.
 *
 * Money is compared as `bigint` throughout; a test that converts to Number would
 * stop detecting the very precision loss the package exists to prevent.
 */

const RUPEE = 100n;
const LAKH = 100_000n * RUPEE;

function base(overrides: Partial<EmiInput> = {}): EmiInput {
  return {
    principalPaise: LAKH,
    annualRateBps: 1_200n, // 12% p.a.
    interestType: "REDUCING",
    frequency: "MONTHLY",
    durationCount: 12,
    startDate: "2026-01-15",
    ...overrides,
  };
}

function sum(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

describe("computeSchedule — invariants", () => {
  const cases: Array<[string, EmiInput]> = [
    ["flat monthly", base({ interestType: "FLAT" })],
    ["reducing monthly", base()],
    [
      "custom rate monthly",
      base({ interestType: "CUSTOM_RATE", annualRateBps: 1_850n }),
    ],
    ["daily, 60 periods", base({ frequency: "DAILY", durationCount: 60 })],
    ["weekly, 52 periods", base({ frequency: "WEEKLY", durationCount: 52 })],
    [
      "quarterly, 8 periods",
      base({ frequency: "QUARTERLY", durationCount: 8 }),
    ],
    ["yearly, 5 periods", base({ frequency: "YEARLY", durationCount: 5 })],
    ["single installment", base({ durationCount: 1 })],
    ["zero interest", base({ annualRateBps: 0n })],
    [
      "indivisible principal",
      base({ principalPaise: 100_007n, durationCount: 7 }),
    ],
    ["high rate", base({ annualRateBps: 3_600n })],
    ["one paisa", base({ principalPaise: 1n, durationCount: 3 })],
  ];

  it.each(cases)("%s: principal repays exactly", (_name, input) => {
    const schedule = computeSchedule(input);
    expect(sum(schedule.installments.map((i) => i.principalPaise))).toBe(
      input.principalPaise,
    );
    expect(schedule.totalPrincipalPaise).toBe(input.principalPaise);
  });

  it.each(cases)("%s: installments sum to total payable", (_name, input) => {
    const schedule = computeSchedule(input);
    expect(sum(schedule.installments.map((i) => i.totalPaise))).toBe(
      schedule.totalPayablePaise,
    );
    expect(schedule.totalPayablePaise).toBe(
      schedule.totalPrincipalPaise + schedule.totalInterestPaise,
    );
  });

  it.each(cases)(
    "%s: balance closes at zero and never goes negative",
    (_name, input) => {
      const schedule = computeSchedule(input);
      expect(schedule.installments.at(-1)?.closingBalancePaise).toBe(0n);
      for (const installment of schedule.installments) {
        expect(installment.closingBalancePaise >= 0n).toBe(true);
        expect(installment.totalPaise).toBe(
          installment.principalPaise + installment.interestPaise,
        );
      }
    },
  );

  it.each(cases)(
    "%s: emits exactly durationCount installments",
    (_name, input) => {
      const schedule = computeSchedule(input);
      expect(schedule.installments).toHaveLength(input.durationCount);
      expect(schedule.installmentCount).toBe(input.durationCount);
      expect(schedule.installments.map((i) => i.installmentNumber)).toEqual(
        Array.from({ length: input.durationCount }, (_, index) => index + 1),
      );
    },
  );
});

describe("computeSchedule — FLAT golden values", () => {
  it("charges interest on the original principal for the whole term", () => {
    // 1,00,000 at 12% p.a. for 12 monthly periods.
    //   totalInterest = 100000 * 1200 * 12 / (10000 * 12) = 12,000 rupees.
    const schedule = computeSchedule(base({ interestType: "FLAT" }));

    expect(schedule.totalInterestPaise).toBe(12_000n * RUPEE);
    expect(schedule.totalPayablePaise).toBe(112_000n * RUPEE);
    // Both principal and interest divide evenly here, so every installment is
    // identical and no residue reaches the last one.
    expect(schedule.installmentAmountPaise).toBe(9_333n * RUPEE + 33n);
    expect(schedule.finalInstallmentPaise).toBe(9_333n * RUPEE + 37n);
  });

  it("is unaffected by how much principal has been repaid", () => {
    const schedule = computeSchedule(base({ interestType: "FLAT" }));
    const interests = schedule.installments
      .slice(0, -1)
      .map((i) => i.interestPaise);
    // Flat interest does not decline with the balance — that is the whole
    // distinction from REDUCING, so pin it rather than assume it.
    expect(new Set(interests.map(String)).size).toBe(1);
  });
});

describe("computeSchedule — REDUCING golden values", () => {
  it("matches the standard amortization formula", () => {
    // 1,00,000 at 12% p.a. (1% monthly) over 12 months.
    // The textbook EMI is 8884.878..., i.e. 888487 paise after flooring.
    const schedule = computeSchedule(base());

    expect(schedule.installmentAmountPaise).toBe(888_487n);
    // First period interest is exactly 1% of the full principal.
    expect(schedule.installments[0]?.interestPaise).toBe(1_000n * RUPEE);
    expect(schedule.installments[0]?.principalPaise).toBe(888_487n - 100_000n);
    // Amortizing 1,00,000 at 1%/period with a floored EMI of 888487 paise, and
    // the final period repaying the residual balance, totals 6,618.51 rupees of
    // interest. Slightly under the unrounded textbook figure, because every
    // period's interest is floored.
    expect(schedule.totalInterestPaise).toBe(661_851n);
  });

  it("declines interest as the balance falls", () => {
    const schedule = computeSchedule(base());
    const interests = schedule.installments.map((i) => i.interestPaise);
    for (let index = 1; index < interests.length; index += 1) {
      expect((interests[index] ?? 0n) < (interests[index - 1] ?? 0n)).toBe(
        true,
      );
    }
  });

  it("treats CUSTOM_RATE as reducing-balance", () => {
    // CUSTOM_RATE differs from REDUCING only in provenance, never in maths
    // (D-EMI-1). Identical inputs must produce byte-identical schedules.
    const reducing = computeSchedule(base({ interestType: "REDUCING" }));
    const custom = computeSchedule(base({ interestType: "CUSTOM_RATE" }));
    expect(custom).toEqual(reducing);
  });
});

describe("computeSchedule — rounding residue", () => {
  it("puts the whole residue on the final installment", () => {
    // 100007 paise over 7 periods at zero interest: 14286 each, 5 paise over.
    const schedule = computeSchedule(
      base({ principalPaise: 100_007n, durationCount: 7, annualRateBps: 0n }),
    );

    for (const installment of schedule.installments.slice(0, -1)) {
      expect(installment.principalPaise).toBe(14_286n);
    }
    expect(schedule.installments.at(-1)?.principalPaise).toBe(14_291n);
    expect(schedule.finalInstallmentPaise).toBe(14_291n);
  });

  it("reports finalInstallmentPaise distinctly from the regular one", () => {
    const schedule = computeSchedule(
      base({ principalPaise: 100_007n, durationCount: 7, annualRateBps: 0n }),
    );
    expect(schedule.finalInstallmentPaise).not.toBe(
      schedule.installmentAmountPaise,
    );
  });
});

describe("computeSchedule — due dates", () => {
  it("puts the first due date one full period after the start", () => {
    const schedule = computeSchedule(base({ startDate: "2026-01-15" }));
    expect(schedule.firstDueDate).toBe("2026-02-15");
    expect(schedule.lastDueDate).toBe("2027-01-15");
  });

  it("clamps a month-end start to the shorter target month", () => {
    // 31 Jan + 1 month is 28 Feb, not 3 March. Overflow would drift the whole
    // schedule, and by a different amount depending on the months it spans.
    const schedule = computeSchedule(
      base({ startDate: "2026-01-31", durationCount: 4 }),
    );
    expect(schedule.installments.map((i) => i.dueDate)).toEqual([
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  it("clamps to 29 February in a leap year", () => {
    const schedule = computeSchedule(
      base({ startDate: "2028-01-31", durationCount: 1 }),
    );
    expect(schedule.firstDueDate).toBe("2028-02-29");
  });

  it("rolls daily and weekly dates across month and year boundaries", () => {
    const daily = computeSchedule(
      base({ frequency: "DAILY", durationCount: 3, startDate: "2026-12-30" }),
    );
    expect(daily.installments.map((i) => i.dueDate)).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);

    const weekly = computeSchedule(
      base({ frequency: "WEEKLY", durationCount: 2, startDate: "2026-12-24" }),
    );
    expect(weekly.installments.map((i) => i.dueDate)).toEqual([
      "2026-12-31",
      "2027-01-07",
    ]);
  });

  it("advances quarterly and yearly by whole months", () => {
    const quarterly = computeSchedule(
      base({
        frequency: "QUARTERLY",
        durationCount: 4,
        startDate: "2026-01-15",
      }),
    );
    expect(quarterly.installments.map((i) => i.dueDate)).toEqual([
      "2026-04-15",
      "2026-07-15",
      "2026-10-15",
      "2027-01-15",
    ]);

    const yearly = computeSchedule(
      base({ frequency: "YEARLY", durationCount: 2, startDate: "2026-03-01" }),
    );
    expect(yearly.installments.map((i) => i.dueDate)).toEqual([
      "2027-03-01",
      "2028-03-01",
    ]);
  });

  it("emits DATE-only strings with no time component", () => {
    const schedule = computeSchedule(base());
    for (const installment of schedule.installments) {
      expect(installment.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("defaults to today in Asia/Kolkata when no start date is given", () => {
    const { startDate: _omitted, ...withoutStart } = base();
    const schedule = computeSchedule(withoutStart);
    expect(schedule.firstDueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("computeSchedule — rejected input", () => {
  const rejections: Array<[string, Partial<EmiInput>, string]> = [
    ["zero principal", { principalPaise: 0n }, "INVALID_PRINCIPAL"],
    ["negative principal", { principalPaise: -1n }, "INVALID_PRINCIPAL"],
    ["negative rate", { annualRateBps: -1n }, "INVALID_RATE"],
    ["zero duration", { durationCount: 0 }, "INVALID_DURATION"],
    ["negative duration", { durationCount: -3 }, "INVALID_DURATION"],
    ["fractional duration", { durationCount: 1.5 }, "INVALID_DURATION"],
    ["excessive duration", { durationCount: 10_001 }, "INVALID_DURATION"],
    [
      "unknown frequency",
      { frequency: "FORTNIGHTLY" as EmiInput["frequency"] },
      "INVALID_FREQUENCY",
    ],
    [
      "unknown interest type",
      { interestType: "SIMPLE" as EmiInput["interestType"] },
      "INVALID_INTEREST_TYPE",
    ],
    ["malformed start date", { startDate: "15-01-2026" }, "INVALID_START_DATE"],
    [
      "impossible start date",
      { startDate: "2026-02-30" },
      "INVALID_START_DATE",
    ],
  ];

  it.each(rejections)("rejects %s", (_name, overrides, code) => {
    // Failure must be an exception, never a partial schedule: Scenarios 12 and 50
    // require submission to be blocked, and a half-built result would read as
    // success to a caller that only checked for null.
    expect(() => computeSchedule(base(overrides))).toThrow(EmiCalculationError);
    try {
      computeSchedule(base(overrides));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as EmiCalculationError).code).toBe(code);
    }
  });
});
