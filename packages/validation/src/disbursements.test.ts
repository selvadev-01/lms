import { describe, expect, it } from "vitest";

import {
  cancelDisbursementSchema,
  confirmDisbursementSchema,
  failDisbursementSchema,
  listDisbursementsSchema,
  recordTransferSchema,
  scheduleDisbursementSchema,
  updateDisbursementScheduleSchema,
} from "./disbursements";

const VERSION = "2026-08-21T10:00:00.000Z";
const UUID = "11111111-2222-3333-4444-555555555555";

/** The message for `path`, or undefined if that field parsed cleanly. */
const errorFor = (
  result: {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  },
  path: string,
): string | undefined =>
  result.success
    ? undefined
    : result.error?.issues.find((issue) => issue.path.join(".") === path)
        ?.message;

describe("scheduleDisbursementSchema", () => {
  const valid = {
    applicationId: UUID,
    disbursementDate: "2026-08-21",
    disbursementAccountId: UUID,
    expectedVersion: VERSION,
  };

  it("accepts a valid schedule", () => {
    expect(scheduleDisbursementSchema.safeParse(valid).success).toBe(true);
  });

  // Scenario Outline: mandatory field validation.
  it("requires the disbursement date", () => {
    const result = scheduleDisbursementSchema.safeParse({
      ...valid,
      disbursementDate: "",
    });
    expect(errorFor(result, "disbursementDate")).toBe(
      "Disbursement Date is required",
    );
  });

  it("requires the disbursement account", () => {
    const result = scheduleDisbursementSchema.safeParse({
      ...valid,
      disbursementAccountId: "",
    });
    expect(errorFor(result, "disbursementAccountId")).toBe(
      "Disbursement Account is required",
    );
  });

  /**
   * The reason the date schema round-trips through `Date` rather than trusting
   * the regex: 2026-02-31 matches `\d{4}-\d{2}-\d{2}` and rolls over to March.
   */
  it("rejects a well-formed date that does not exist", () => {
    const result = scheduleDisbursementSchema.safeParse({
      ...valid,
      disbursementDate: "2026-02-31",
    });
    expect(errorFor(result, "disbursementDate")).toBe(
      "Disbursement Date must be a valid date",
    );
  });

  it("rejects a non-date string of the right length", () => {
    const result = scheduleDisbursementSchema.safeParse({
      ...valid,
      disbursementDate: "not-a-date",
    });
    expect(errorFor(result, "disbursementDate")).toBe(
      "Disbursement Date must be a valid date",
    );
  });

  it("accepts a leap day in a leap year", () => {
    expect(
      scheduleDisbursementSchema.safeParse({
        ...valid,
        disbursementDate: "2028-02-29",
      }).success,
    ).toBe(true);
  });

  it("rejects a leap day in a non-leap year", () => {
    const result = scheduleDisbursementSchema.safeParse({
      ...valid,
      disbursementDate: "2026-02-29",
    });
    expect(errorFor(result, "disbursementDate")).toBeDefined();
  });

  /**
   * Rule 6 / Scenario 6: the amount is the sanction letter's, never the
   * caller's. Sending one is a 400, not a silently ignored field.
   */
  it("has no amount field to send", () => {
    expect(
      Object.keys(scheduleDisbursementSchema.shape).includes("amountPaise"),
    ).toBe(false);
  });

  /** Scenario 33: the client cannot supply a branch. */
  it("has no scope fields", () => {
    const keys = Object.keys(scheduleDisbursementSchema.shape);
    expect(keys).not.toContain("branchId");
    expect(keys).not.toContain("orgId");
  });

  it("rejects a malformed expectedVersion", () => {
    const result = scheduleDisbursementSchema.safeParse({
      ...valid,
      expectedVersion: "yesterday",
    });
    expect(errorFor(result, "expectedVersion")).toBe(
      "This form is out of date. Reload and try again.",
    );
  });
});

describe("updateDisbursementScheduleSchema", () => {
  /**
   * Moving a schedule to a different loan is a cancel plus a re-schedule.
   * Allowing it here would let one loan's approved terms fund another.
   */
  it("cannot re-target the application", () => {
    expect(Object.keys(updateDisbursementScheduleSchema.shape)).not.toContain(
      "applicationId",
    );
  });
});

describe("recordTransferSchema", () => {
  const bank = {
    paymentMode: "BANK_TRANSFER" as const,
    amountPaise: "10000000",
    transactionReference: "TXN-123",
    transferDate: "2026-08-21",
    expectedVersion: VERSION,
  };

  it("accepts a bank transfer with a reference", () => {
    expect(recordTransferSchema.safeParse(bank).success).toBe(true);
  });

  /**
   * Rule 11 / Scenario 16 — the case a `@ValidateIf`-style conditional would
   * silently accept. This is the single most important assertion in the file.
   */
  it("rejects a bank transfer with no reference", () => {
    const result = recordTransferSchema.safeParse({
      ...bank,
      transactionReference: undefined,
    });
    expect(errorFor(result, "transactionReference")).toBe(
      "Transaction Reference is required for a bank transfer",
    );
  });

  it("rejects a bank transfer with a blank reference", () => {
    const result = recordTransferSchema.safeParse({
      ...bank,
      transactionReference: "",
    });
    expect(errorFor(result, "transactionReference")).toBe(
      "Transaction Reference is required for a bank transfer",
    );
  });

  it("requires a reference for UPI too, which settles through a bank", () => {
    const result = recordTransferSchema.safeParse({
      ...bank,
      paymentMode: "UPI",
      transactionReference: undefined,
    });
    expect(errorFor(result, "transactionReference")).toBeDefined();
  });

  /** Cash has no external system to reference (Scenario 15). */
  it("accepts cash with no reference", () => {
    expect(
      recordTransferSchema.safeParse({
        ...bank,
        paymentMode: "CASH",
        transactionReference: undefined,
      }).success,
    ).toBe(true);
  });

  // Scenario 7.
  it("rejects a zero amount", () => {
    const result = recordTransferSchema.safeParse({
      ...bank,
      amountPaise: "0",
    });
    expect(errorFor(result, "amountPaise")).toBe(
      "Amount must be greater than zero",
    );
  });

  it("rejects a negative amount", () => {
    const result = recordTransferSchema.safeParse({
      ...bank,
      amountPaise: "-100",
    });
    expect(errorFor(result, "amountPaise")).toBe(
      "Amount must be a whole number of paise",
    );
  });

  /**
   * Rupees typed into a paise field. Accepting "1000.50" would fund a loan at
   * a hundredth of its intended size.
   */
  it("rejects a decimal amount rather than interpreting it", () => {
    const result = recordTransferSchema.safeParse({
      ...bank,
      amountPaise: "1000.50",
    });
    expect(errorFor(result, "amountPaise")).toBe(
      "Amount must be a whole number of paise",
    );
  });

  /** Paise beyond Number.MAX_SAFE_INTEGER must still parse as a string. */
  it("accepts an amount larger than a JS safe integer", () => {
    expect(
      recordTransferSchema.safeParse({
        ...bank,
        amountPaise: "90000000000000000",
      }).success,
    ).toBe(true);
  });

  it("requires the transfer date", () => {
    const result = recordTransferSchema.safeParse({
      ...bank,
      transferDate: "",
    });
    expect(errorFor(result, "transferDate")).toBe("Transfer Date is required");
  });

  it("requires a transfer method", () => {
    const result = recordTransferSchema.safeParse({
      ...bank,
      paymentMode: undefined,
    });
    expect(errorFor(result, "paymentMode")).toBe("Transfer Method is required");
  });

  it("rejects a reference with characters that break a CSV export", () => {
    const result = recordTransferSchema.safeParse({
      ...bank,
      transactionReference: "TXN,123\n456",
    });
    expect(errorFor(result, "transactionReference")).toBeDefined();
  });
});

describe("confirmDisbursementSchema", () => {
  it("accepts a uuid idempotency key", () => {
    expect(
      confirmDisbursementSchema.safeParse({
        idempotencyKey: UUID,
        expectedVersion: VERSION,
      }).success,
    ).toBe(true);
  });

  /** Scenarios 28, 46: without a key there is nothing to replay against. */
  it("requires the idempotency key", () => {
    expect(
      confirmDisbursementSchema.safeParse({ expectedVersion: VERSION }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid key", () => {
    expect(
      confirmDisbursementSchema.safeParse({
        idempotencyKey: "retry-1",
        expectedVersion: VERSION,
      }).success,
    ).toBe(false);
  });
});

describe("failDisbursementSchema", () => {
  it("requires a failure reason", () => {
    const result = failDisbursementSchema.safeParse({
      failureReason: "",
      expectedVersion: VERSION,
    });
    expect(errorFor(result, "failureReason")).toBe(
      "Failure Reason is required",
    );
  });
});

describe("cancelDisbursementSchema", () => {
  it("requires a cancellation reason", () => {
    const result = cancelDisbursementSchema.safeParse({
      cancellationReason: "",
      expectedVersion: VERSION,
    });
    expect(errorFor(result, "cancellationReason")).toBe(
      "Cancellation Reason is required",
    );
  });
});

describe("listDisbursementsSchema", () => {
  it("defaults pagination", () => {
    const result = listDisbursementsSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });

  /** Scenario 3: a branch admin's list cannot be widened by a query parameter. */
  it("has no branchId parameter", () => {
    expect(Object.keys(listDisbursementsSchema.shape)).not.toContain(
      "branchId",
    );
  });

  it("rejects an unknown status", () => {
    expect(
      listDisbursementsSchema.safeParse({ status: "DISBURSED" }).success,
    ).toBe(false);
  });
});
