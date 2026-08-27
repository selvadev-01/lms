/**
 * Tests for the Module 13 schemas.
 *
 * The load-bearing properties, each of which a plausible refactor breaks
 * silently:
 *
 *  1. A promise to pay is an amount **and** a date, or neither (Scenario 15).
 *  2. `updateRecoveryActionSchema` enforces that rule too. It is written out
 *     rather than derived from `recordRecoveryActionSchema`, because deriving it
 *     — with `.partial()`, `.pick()`, `.omit()` or `.extend()` — goes through
 *     `.innerType()` and **silently drops every `superRefine`**. The derived
 *     schema still type-checks and still parses; it just stops enforcing the
 *     rule. This has bitten this codebase before, so both schemas are pinned
 *     here.
 *  3. A `FAILED` GPS capture cannot cite a check-in, and a `VERIFIED` one must
 *     (Rule 40, Scenario 30). Synchronization must never turn a failure into a
 *     success.
 *  4. No schema accepts a `branchId`, an `orgId`, or a money figure the server
 *     is supposed to derive. Each would be either inert or a vulnerability.
 */

import { describe, expect, it } from "vitest";

import {
  assessPenaltySchema,
  closeRecoveryCaseSchema,
  openRecoveryCaseSchema,
  penaltyActionSchema,
  proposeSettlementSchema,
  recordRecoveryActionSchema,
  updateRecoveryActionSchema,
  writeOffLoanSchema,
} from "./overdue-recovery";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const action = (overrides: Record<string, unknown> = {}) => ({
  actionType: "PHONE_CALL",
  actionDate: "2026-08-24",
  outcome: "NO_ANSWER",
  ...overrides,
});

describe("recordRecoveryActionSchema — promise to pay", () => {
  it("accepts an action with no promise at all", () => {
    expect(recordRecoveryActionSchema.safeParse(action()).success).toBe(true);
  });

  it("accepts a complete promise", () => {
    const result = recordRecoveryActionSchema.safeParse(
      action({
        outcome: "CONTACTED_PROMISED",
        promiseToPayDate: "2026-09-01",
        promiseToPayAmountPaise: "500000",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a promised date with no amount", () => {
    const result = recordRecoveryActionSchema.safeParse(
      action({ promiseToPayDate: "2026-09-01" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.promiseToPayAmountPaise)
        .toBeDefined();
    }
  });

  it("rejects a promised amount with no date", () => {
    const result = recordRecoveryActionSchema.safeParse(
      action({ promiseToPayAmountPaise: "500000" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.promiseToPayDate).toBeDefined();
    }
  });
});

describe("recordRecoveryActionSchema — GPS evidence", () => {
  /** Rule 40: a failed capture is recorded as failed, never promoted. */
  it("rejects a failed capture that cites a check-in", () => {
    const result = recordRecoveryActionSchema.safeParse(
      action({ gpsCaptureStatus: "FAILED", gpsCheckInId: UUID }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a failed capture with no check-in", () => {
    const result = recordRecoveryActionSchema.safeParse(
      action({ gpsCaptureStatus: "FAILED" }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a verified capture with no check-in to substantiate it", () => {
    const result = recordRecoveryActionSchema.safeParse(
      action({ gpsCaptureStatus: "VERIFIED" }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a verified capture that cites its check-in", () => {
    const result = recordRecoveryActionSchema.safeParse(
      action({ gpsCaptureStatus: "VERIFIED", gpsCheckInId: UUID }),
    );
    expect(result.success).toBe(true);
  });

  /**
   * The status enum is imported from `field-collections`, which deliberately
   * withholds the outcomes only the server may decide. A client that could
   * name `EXPIRED` could name a flattering outcome.
   */
  it("refuses a capture status only the server may assign", () => {
    for (const status of ["EXPIRED", "CANCELLED"]) {
      expect(
        recordRecoveryActionSchema.safeParse(
          action({ gpsCaptureStatus: status }),
        ).success,
      ).toBe(false);
    }
  });
});

describe("updateRecoveryActionSchema", () => {
  const update = (overrides: Record<string, unknown> = {}) => ({
    expectedVersion: "2026-08-24T10:00:00.000Z",
    ...overrides,
  });

  it("accepts an edit that touches no promise", () => {
    expect(
      updateRecoveryActionSchema.safeParse(update({ notes: "Called again" }))
        .success,
    ).toBe(true);
  });

  /**
   * Property 2, the important one. If this schema is ever rewritten as
   * `recordRecoveryActionSchema.partial()` or `.pick()`, these two cases start
   * passing and the rule is silently gone.
   */
  it("still rejects a half promise after the fields were restated", () => {
    expect(
      updateRecoveryActionSchema.safeParse(
        update({ promiseToPayDate: "2026-09-01" }),
      ).success,
    ).toBe(false);

    expect(
      updateRecoveryActionSchema.safeParse(
        update({ promiseToPayAmountPaise: "500000" }),
      ).success,
    ).toBe(false);
  });

  it("accepts a complete promise on an edit", () => {
    expect(
      updateRecoveryActionSchema.safeParse(
        update({
          promiseToPayDate: "2026-09-01",
          promiseToPayAmountPaise: "500000",
        }),
      ).success,
    ).toBe(true);
  });

  /** Changing what an officer did is a new action, not an edit (Scenario 32). */
  it("does not accept a changed action type", () => {
    const result = updateRecoveryActionSchema.safeParse(
      update({ actionType: "FIELD_VISIT" }),
    );
    if (result.success) {
      expect(result.data).not.toHaveProperty("actionType");
    }
  });

  it("requires the concurrency token", () => {
    expect(updateRecoveryActionSchema.safeParse({ notes: "x" }).success).toBe(
      false,
    );
  });
});

describe("penaltyActionSchema", () => {
  const base = {
    reason: "Customer disputed the charge",
    expectedVersion: "2026-08-24T10:00:00.000Z",
  };

  it("requires an amount for an adjustment", () => {
    expect(
      penaltyActionSchema.safeParse({ ...base, action: "ADJUST" }).success,
    ).toBe(false);
  });

  it("accepts an adjustment that names its amount", () => {
    expect(
      penaltyActionSchema.safeParse({
        ...base,
        action: "ADJUST",
        amountPaise: "10000",
      }).success,
    ).toBe(true);
  });

  it("refuses an amount on a waiver", () => {
    expect(
      penaltyActionSchema.safeParse({
        ...base,
        action: "WAIVE",
        amountPaise: "10000",
      }).success,
    ).toBe(false);
  });

  /** Forgiving a charge is the act most in need of an explanation. */
  it("requires a reason", () => {
    expect(
      penaltyActionSchema.safeParse({
        action: "WAIVE",
        expectedVersion: base.expectedVersion,
      }).success,
    ).toBe(false);
  });
});

describe("what the schemas refuse to accept", () => {
  /**
   * Property 4. Scope comes from the JWT; `forbidNonWhitelisted` in the API
   * turns an attempt into a 400 rather than a silent ignore. A schema that
   * declared these would make that refusal a lie.
   */
  it("declares no branch or organization on any input schema", () => {
    const schemas = {
      openRecoveryCase: openRecoveryCaseSchema,
      assessPenalty: assessPenaltySchema,
      proposeSettlement: proposeSettlementSchema,
    };

    for (const [name, schema] of Object.entries(schemas)) {
      const keys = Object.keys(schema.shape);
      expect(keys, name).not.toContain("branchId");
      expect(keys, name).not.toContain("orgId");
      expect(keys, name).not.toContain("organizationId");
    }
  });

  /**
   * The figure comes from the configured rule and the authoritative balances
   * (Rule 12). Accepting one would let a form decide what a borrower is charged.
   */
  it("does not let a caller name the penalty amount", () => {
    expect(Object.keys(assessPenaltySchema.shape)).not.toContain("amountPaise");
  });

  /** What is written off is what is outstanding, read inside the transaction. */
  it("does not let a caller name the write-off amount", () => {
    expect(Object.keys(writeOffLoanSchema.shape)).not.toContain("amountPaise");
  });

  /** Scenario 39: the closure snapshot is read from the loan, not submitted. */
  it("does not let a caller name the closure figures", () => {
    const keys = Object.keys(closeRecoveryCaseSchema.shape);
    expect(keys).not.toContain("recoveredAmountPaise");
    expect(keys).not.toContain("outstandingBeforePaise");
    expect(keys).not.toContain("remainingOutstandingPaise");
  });
});
