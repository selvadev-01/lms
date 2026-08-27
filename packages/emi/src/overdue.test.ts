/**
 * Load-bearing properties of the delinquency arithmetic.
 *
 * The ones a plausible refactor would break silently:
 *
 *  1. The DPD boundary agrees with `deriveEmiStatus`: due today is not overdue,
 *     due yesterday is one day past due. A refactor that counted inclusively
 *     would put every borrower one day further into ageing and would move some
 *     across a bucket and NPA threshold.
 *  2. Day counting is exact across month, year and leap boundaries. A `Date`
 *     subtraction would pass the easy cases and drift on the hard ones.
 *  3. Settled and not-yet-due obligations contribute nothing to the totals
 *     (Scenarios 6, 7).
 *  4. DPD comes from the *oldest* unpaid obligation, so the pair shown in
 *     Scenario 2 is internally consistent.
 *  5. The input array is never mutated or reordered, so the caller's row order
 *     cannot influence the result (Scenario 8).
 *  6. `classifyNpa` never returns LOSS — that is a judgment, not arithmetic.
 */

import { describe, expect, it } from "vitest";

import { parseIsoDate } from "./dates.js";
import {
  classifyNpa,
  daysBetween,
  daysPastDue,
  delinquencyBucket,
  NPA_THRESHOLD_DAYS,
  summarizeOverdue,
  type OverdueObligation,
} from "./overdue.js";

const on = (iso: string) => parseIsoDate(iso);

describe("daysBetween", () => {
  it("is zero for the same day", () => {
    expect(daysBetween(on("2026-08-24"), on("2026-08-24"))).toBe(0);
  });

  it("counts forward and backward symmetrically", () => {
    expect(daysBetween(on("2026-08-01"), on("2026-08-24"))).toBe(23);
    expect(daysBetween(on("2026-08-24"), on("2026-08-01"))).toBe(-23);
  });

  it("crosses a month boundary", () => {
    expect(daysBetween(on("2026-01-31"), on("2026-02-01"))).toBe(1);
  });

  it("crosses a year boundary", () => {
    expect(daysBetween(on("2025-12-31"), on("2026-01-01"))).toBe(1);
  });

  // 2024 is a leap year: February has 29 days, so the span is 366.
  it("honours the Gregorian leap rule", () => {
    expect(daysBetween(on("2024-01-01"), on("2025-01-01"))).toBe(366);
    expect(daysBetween(on("2025-01-01"), on("2026-01-01"))).toBe(365);
    expect(daysBetween(on("2024-02-28"), on("2024-03-01"))).toBe(2);
    expect(daysBetween(on("2023-02-28"), on("2023-03-01"))).toBe(1);
  });

  // 1900 was not a leap year; 2000 was. The century rule is where a naive
  // "divisible by four" implementation goes wrong.
  it("honours the century rule", () => {
    expect(daysBetween(on("1900-02-28"), on("1900-03-01"))).toBe(1);
    expect(daysBetween(on("2000-02-28"), on("2000-03-01"))).toBe(2);
  });
});

describe("daysPastDue", () => {
  /**
   * The boundary that must agree with `deriveEmiStatus`, which returns DUE for
   * a same-day comparison and OVERDUE only once the due date is in the past.
   */
  it("is zero on the due date itself", () => {
    expect(daysPastDue(on("2026-08-24"), on("2026-08-24"))).toBe(0);
  });

  it("is one the day after the due date", () => {
    expect(daysPastDue(on("2026-08-24"), on("2026-08-25"))).toBe(1);
  });

  it("is zero, never negative, before the due date", () => {
    expect(daysPastDue(on("2026-08-24"), on("2026-08-01"))).toBe(0);
  });
});

describe("delinquencyBucket", () => {
  it.each([
    [0, "CURRENT"],
    [1, "DPD_1_30"],
    [30, "DPD_1_30"],
    [31, "DPD_31_60"],
    [60, "DPD_31_60"],
    [61, "DPD_61_90"],
    [90, "DPD_61_90"],
    [91, "DPD_91_180"],
    [180, "DPD_91_180"],
    [181, "DPD_180_PLUS"],
    [5000, "DPD_180_PLUS"],
  ])("puts %i days in %s", (dpd, expected) => {
    expect(delinquencyBucket(dpd)).toBe(expected);
  });
});

describe("classifyNpa", () => {
  it.each([
    [0, "STANDARD"],
    [1, "SPECIAL_MENTION"],
    [89, "SPECIAL_MENTION"],
    [90, "SUB_STANDARD"],
    [454, "SUB_STANDARD"],
    [455, "DOUBTFUL"],
  ])("classifies %i days as %s", (dpd, expected) => {
    expect(classifyNpa(dpd)).toBe(expected);
  });

  it("becomes non-performing exactly at the threshold", () => {
    expect(classifyNpa(NPA_THRESHOLD_DAYS - 1)).toBe("SPECIAL_MENTION");
    expect(classifyNpa(NPA_THRESHOLD_DAYS)).toBe("SUB_STANDARD");
  });

  /**
   * LOSS is a judgment about recoverability. Inferring it from ageing alone
   * would write off loans the business never decided to write off.
   */
  it("never returns LOSS from a day count alone", () => {
    for (const dpd of [0, 1, 90, 365, 3650, 36500]) {
      expect(classifyNpa(dpd)).not.toBe("LOSS");
    }
  });
});

describe("summarizeOverdue", () => {
  /**
   * `dueDate` is an ISO string here and a `CivilDate` on the interface, so the
   * overrides are declared as their own shape rather than as a
   * `Partial<OverdueObligation>` — intersecting the two would give `dueDate` the
   * impossible type `CivilDate & string`.
   */
  const obligation = (overrides: {
    dueDate: string;
    principalOutstandingPaise?: bigint;
    interestOutstandingPaise?: bigint;
    penaltyOutstandingPaise?: bigint;
    feesOutstandingPaise?: bigint;
  }): OverdueObligation => ({
    dueDate: on(overrides.dueDate),
    principalOutstandingPaise: overrides.principalOutstandingPaise ?? 0n,
    interestOutstandingPaise: overrides.interestOutstandingPaise ?? 0n,
    penaltyOutstandingPaise: overrides.penaltyOutstandingPaise ?? 0n,
    feesOutstandingPaise: overrides.feesOutstandingPaise ?? 0n,
  });

  const today = on("2026-08-24");

  it("reports nothing overdue for an empty book", () => {
    const position = summarizeOverdue([], today);
    expect(position.oldestDueDate).toBeNull();
    expect(position.daysPastDue).toBe(0);
    expect(position.bucket).toBe("CURRENT");
    expect(position.totalOverduePaise).toBe(0n);
  });

  /** Scenario 7: a fully settled EMI is excluded from the overdue totals. */
  it("excludes a fully paid obligation", () => {
    const position = summarizeOverdue(
      [obligation({ dueDate: "2026-07-01" })],
      today,
    );
    expect(position.oldestDueDate).toBeNull();
    expect(position.totalOverduePaise).toBe(0n);
  });

  /** Scenario 6: a part-paid EMI stays overdue for what remains. */
  it("includes the remaining balance of a partly paid obligation", () => {
    const position = summarizeOverdue(
      [
        obligation({
          dueDate: "2026-07-01",
          principalOutstandingPaise: 250000n,
        }),
      ],
      today,
    );
    expect(position.overduePrincipalPaise).toBe(250000n);
    expect(position.totalOverduePaise).toBe(250000n);
  });

  it("excludes an obligation that is not yet due", () => {
    const position = summarizeOverdue(
      [
        obligation({
          dueDate: "2026-09-01",
          principalOutstandingPaise: 500000n,
        }),
      ],
      today,
    );
    expect(position.totalOverduePaise).toBe(0n);
  });

  it("excludes an obligation due today", () => {
    const position = summarizeOverdue(
      [
        obligation({
          dueDate: "2026-08-24",
          principalOutstandingPaise: 500000n,
        }),
      ],
      today,
    );
    expect(position.totalOverduePaise).toBe(0n);
  });

  it("sums the four components into the total", () => {
    const position = summarizeOverdue(
      [
        obligation({
          dueDate: "2026-06-01",
          principalOutstandingPaise: 100000n,
          interestOutstandingPaise: 20000n,
          penaltyOutstandingPaise: 3000n,
          feesOutstandingPaise: 400n,
        }),
      ],
      today,
    );
    expect(position.totalOverduePaise).toBe(123400n);
    expect(position.totalOverduePaise).toBe(
      position.overduePrincipalPaise +
        position.overdueInterestPaise +
        position.overduePenaltyPaise +
        position.overdueFeesPaise,
    );
  });

  /**
   * Scenario 2 shows the oldest unpaid due date and the DPD side by side.
   * Deriving the second from anything but the first makes the pair inconsistent.
   */
  it("takes days past due from the oldest unpaid obligation", () => {
    const position = summarizeOverdue(
      [
        obligation({
          dueDate: "2026-08-01",
          principalOutstandingPaise: 100n,
        }),
        obligation({
          dueDate: "2026-06-01",
          principalOutstandingPaise: 100n,
        }),
        obligation({
          dueDate: "2026-07-01",
          principalOutstandingPaise: 100n,
        }),
      ],
      today,
    );
    expect(position.oldestDueDate).toEqual(on("2026-06-01"));
    expect(position.daysPastDue).toBe(84);
  });

  /** A settled old row must not become the oldest *unpaid* date. */
  it("ignores settled rows when finding the oldest due date", () => {
    const position = summarizeOverdue(
      [
        obligation({ dueDate: "2026-01-01" }),
        obligation({
          dueDate: "2026-08-01",
          principalOutstandingPaise: 100n,
        }),
      ],
      today,
    );
    expect(position.oldestDueDate).toEqual(on("2026-08-01"));
  });

  /** Scenario 8: the caller's row order cannot influence the result. */
  it("is independent of input order and does not mutate the input", () => {
    const rows = [
      obligation({ dueDate: "2026-08-01", principalOutstandingPaise: 100n }),
      obligation({ dueDate: "2026-06-01", interestOutstandingPaise: 200n }),
      obligation({ dueDate: "2026-07-01", penaltyOutstandingPaise: 300n }),
    ];
    const snapshot = [...rows];

    const forwards = summarizeOverdue(rows, today);
    const backwards = summarizeOverdue([...rows].reverse(), today);

    expect(forwards).toEqual(backwards);
    expect(rows).toEqual(snapshot);
  });

  /** Scenario 8: the same inputs always produce the same result. */
  it("is deterministic across repeated evaluation", () => {
    const rows = [
      obligation({ dueDate: "2026-05-11", principalOutstandingPaise: 987654n }),
      obligation({ dueDate: "2026-06-11", interestOutstandingPaise: 12345n }),
    ];
    expect(summarizeOverdue(rows, today)).toEqual(
      summarizeOverdue(rows, today),
    );
  });

  it("derives the bucket and NPA eligibility from the derived DPD", () => {
    const position = summarizeOverdue(
      [
        obligation({
          dueDate: "2026-01-01",
          principalOutstandingPaise: 100n,
        }),
      ],
      today,
    );
    expect(position.daysPastDue).toBe(235);
    expect(position.bucket).toBe("DPD_180_PLUS");
    expect(position.npaEligibility).toBe("SUB_STANDARD");
  });
});
