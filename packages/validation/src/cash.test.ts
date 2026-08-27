/**
 * Tests for the Module 12 cash handover and reconciliation schemas.
 *
 * Three properties here are load-bearing beyond ordinary validation coverage:
 *
 *  - **No schema accepts a derived figure.** The agent's expected balance and
 *    the reconciliation difference are computed server-side from posted
 *    collections (Rule 24). A schema that accepted either would make the
 *    reconciliation circular — the system checking the client's number against
 *    the client's number — so their absence is asserted, not assumed.
 *  - **No schema accepts a branch or an agent.** That absence is what makes
 *    Scenarios 46 and 48 structural rather than a check somebody remembers.
 *  - **A resolution cannot be blank.** Rule 35 requires a recorded reason and
 *    an authorized action for every discrepancy; an optional reason is how that
 *    becomes an empty one.
 */

import { describe, expect, it } from "vitest";

import {
  createCashHandoverSchema,
  createReconciliationSchema,
  enqueueSyncItemSchema,
  listCashHandoversSchema,
  listReconciliationsSchema,
  receiveCashHandoverSchema,
  resolveDiscrepancySchema,
  reverseCashHandoverSchema,
  submitCashHandoverSchema,
} from "./cash";

const HANDOVER_ID = "11111111-1111-1111-1111-111111111111";
const IDEMPOTENCY_KEY = "22222222-2222-2222-2222-222222222222";
const VERSION = "2026-08-24T04:00:00.000Z";

/** The first message for a field, or undefined if the field passed. */
function messageFor(
  result: { success: boolean; error?: { issues: readonly unknown[] } },
  path: string,
): string | undefined {
  if (result.success || !result.error) return undefined;
  for (const raw of result.error.issues) {
    const issue = raw as {
      path: readonly (string | number)[];
      message: string;
    };
    if (issue.path[0] === path) return issue.message;
  }
  return undefined;
}

describe("createCashHandoverSchema", () => {
  it("accepts a positive amount with an idempotency key", () => {
    const result = createCashHandoverSchema.safeParse({
      handedOverCashPaise: "500000",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result.success).toBe(true);
  });

  it("refuses a zero handover", () => {
    // Handing over nothing is not a transfer; it is a draft nobody needs.
    const result = createCashHandoverSchema.safeParse({
      handedOverCashPaise: "0",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result.success).toBe(false);
    expect(messageFor(result, "handedOverCashPaise")).toBe(
      "Cash Handed Over must be greater than zero",
    );
  });

  it("refuses a fractional amount rather than rounding it", () => {
    // Money is integer paise. `z.coerce.number()` would silently round this.
    const result = createCashHandoverSchema.safeParse({
      handedOverCashPaise: "1000.50",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result.success).toBe(false);
  });

  it("requires an idempotency key", () => {
    const result = createCashHandoverSchema.safeParse({
      handedOverCashPaise: "500000",
    });

    expect(result.success).toBe(false);
    expect(messageFor(result, "idempotencyKey")).toBe(
      "Idempotency Key is required",
    );
  });

  it("does not accept a branch, an agent, a date or a derived balance", () => {
    // Branch comes from the agent's own branch, the agent from the JWT, the
    // date from the server's Asia/Kolkata clock, and the expected balance from
    // the server's own derivation over posted collections.
    const result = createCashHandoverSchema.safeParse({
      handedOverCashPaise: "500000",
      idempotencyKey: IDEMPOTENCY_KEY,
      branchId: "99999999-9999-9999-9999-999999999999",
      fieldAgentId: "88888888-8888-8888-8888-888888888888",
      businessDate: "2026-01-01",
      expectedCashPaise: "999999",
      status: "RECEIVED",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    for (const key of [
      "branchId",
      "fieldAgentId",
      "businessDate",
      "expectedCashPaise",
      "status",
    ]) {
      expect(result.data).not.toHaveProperty(key);
    }
  });
});

describe("submitCashHandoverSchema", () => {
  it("carries only a version and an acknowledgment", () => {
    const result = submitCashHandoverSchema.safeParse({
      expectedVersion: VERSION,
    });

    expect(result.success).toBe(true);
  });

  it("does not let the amount change at submit time", () => {
    // The balance check and the custody claim must run against one number.
    const result = submitCashHandoverSchema.safeParse({
      expectedVersion: VERSION,
      handedOverCashPaise: "1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("handedOverCashPaise");
  });

  it("requires a version", () => {
    const result = submitCashHandoverSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("receiveCashHandoverSchema", () => {
  it("takes the branch's own count, separate from the declared amount", () => {
    // Scenario 24: recording what was actually counted is what lets the
    // difference be non-zero and traceable rather than assumed away.
    const result = receiveCashHandoverSchema.safeParse({
      receivedCashPaise: "480000",
      expectedVersion: VERSION,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.receivedCashPaise).toBe("480000");
  });

  it("does not accept the idempotency key in the body", () => {
    // It travels as an Idempotency-Key header: this acts on a row that already
    // exists, which is the header half of the codebase's two-way split.
    const result = receiveCashHandoverSchema.safeParse({
      receivedCashPaise: "480000",
      expectedVersion: VERSION,
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("idempotencyKey");
  });

  it("requires a version, because the row already exists", () => {
    const result = receiveCashHandoverSchema.safeParse({
      receivedCashPaise: "480000",
    });

    expect(result.success).toBe(false);
  });
});

describe("reverseCashHandoverSchema", () => {
  it("requires a reason", () => {
    const result = reverseCashHandoverSchema.safeParse({
      expectedVersion: VERSION,
    });

    expect(result.success).toBe(false);
    expect(messageFor(result, "reversalReason")).toBe(
      "Reversal Reason is required",
    );
  });

  it("refuses a whitespace-only reason", () => {
    const result = reverseCashHandoverSchema.safeParse({
      reversalReason: "   ",
      expectedVersion: VERSION,
    });

    expect(result.success).toBe(false);
  });

  it("has no amount — reversal is all or nothing", () => {
    const result = reverseCashHandoverSchema.safeParse({
      reversalReason: "Cash was miscounted at the counter.",
      expectedVersion: VERSION,
      amountPaise: "1000",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("amountPaise");
  });
});

describe("createReconciliationSchema", () => {
  it("takes the physical count against a handover", () => {
    const result = createReconciliationSchema.safeParse({
      handoverId: HANDOVER_ID,
      actualCashPaise: "480000",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result.success).toBe(true);
  });

  it("does not accept the expected side or the difference", () => {
    // Both are derived: expected is copied from the handover the server
    // recorded, and the difference is computed from the two. A client-supplied
    // difference would let a reconciliation assert a match it never counted.
    const result = createReconciliationSchema.safeParse({
      handoverId: HANDOVER_ID,
      actualCashPaise: "480000",
      idempotencyKey: IDEMPOTENCY_KEY,
      expectedCashPaise: "480000",
      differencePaise: "0",
      status: "MATCHED",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    for (const key of ["expectedCashPaise", "differencePaise", "status"]) {
      expect(result.data).not.toHaveProperty(key);
    }
  });

  it("requires the handover it reconciles", () => {
    const result = createReconciliationSchema.safeParse({
      actualCashPaise: "480000",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(result.success).toBe(false);
    expect(messageFor(result, "handoverId")).toBe("Handover is required");
  });
});

describe("resolveDiscrepancySchema (Rule 35)", () => {
  function validResolution(overrides: Record<string, unknown> = {}) {
    return {
      discrepancyType: "SHORTAGE",
      discrepancyReason:
        "Agent reports a note was rejected by the counting machine.",
      resolutionAction: "RECOVERED_FROM_AGENT",
      expectedVersion: VERSION,
      ...overrides,
    };
  }

  it("accepts a complete resolution", () => {
    const result = resolveDiscrepancySchema.safeParse(validResolution());
    expect(result.success).toBe(true);
  });

  it("requires a discrepancy type", () => {
    const body = validResolution();
    delete (body as Record<string, unknown>).discrepancyType;

    const result = resolveDiscrepancySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("requires a reason", () => {
    const body = validResolution();
    delete (body as Record<string, unknown>).discrepancyReason;

    const result = resolveDiscrepancySchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(messageFor(result, "discrepancyReason")).toBe("Reason is required");
  });

  it("refuses a whitespace-only reason", () => {
    const result = resolveDiscrepancySchema.safeParse(
      validResolution({ discrepancyReason: "   " }),
    );

    expect(result.success).toBe(false);
  });

  it("requires a resolution action", () => {
    const body = validResolution();
    delete (body as Record<string, unknown>).resolutionAction;

    const result = resolveDiscrepancySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("leaves the approval reference optional", () => {
    // NO_ACTION and ESCALATED legitimately post nothing, so there is no
    // Module 14 entry number to record.
    const result = resolveDiscrepancySchema.safeParse(
      validResolution({ resolutionAction: "NO_ACTION" }),
    );

    expect(result.success).toBe(true);
  });

  it("carries a Module 14 entry number when one exists", () => {
    const result = resolveDiscrepancySchema.safeParse(
      validResolution({ approvalReference: "JE-000042" }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.approvalReference).toBe("JE-000042");
  });

  it("does not let a resolution rewrite the counted figures", () => {
    // Rule 36: approval cannot silently change historical amounts.
    const result = resolveDiscrepancySchema.safeParse(
      validResolution({
        expectedCashPaise: "1",
        actualCashPaise: "1",
        differencePaise: "0",
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    for (const key of [
      "expectedCashPaise",
      "actualCashPaise",
      "differencePaise",
    ]) {
      expect(result.data).not.toHaveProperty(key);
    }
  });
});

describe("enqueueSyncItemSchema", () => {
  it("accepts a device's queued-item report", () => {
    const result = enqueueSyncItemSchema.safeParse({
      clientTransactionId: "device-alpha-0001",
      entityType: "FIELD_COLLECTION",
      payload: { loanId: HANDOVER_ID, amountPaise: "100000" },
      queuedAt: "2026-08-24T09:30:00+05:30",
    });

    expect(result.success).toBe(true);
  });

  it("requires the device's stable transaction id", () => {
    const result = enqueueSyncItemSchema.safeParse({
      entityType: "FIELD_COLLECTION",
      payload: {},
      queuedAt: "2026-08-24T09:30:00+05:30",
    });

    expect(result.success).toBe(false);
    expect(messageFor(result, "clientTransactionId")).toBe(
      "Client Transaction Id is required",
    );
  });

  it("requires a timestamped queue time", () => {
    const result = enqueueSyncItemSchema.safeParse({
      clientTransactionId: "device-alpha-0001",
      entityType: "FIELD_COLLECTION",
      payload: {},
      queuedAt: "not-a-timestamp",
    });

    expect(result.success).toBe(false);
  });
});

describe("list filters", () => {
  it("defaults the handover page window", () => {
    const result = listCashHandoversSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(20);
  });

  it("does not accept a branch or agent filter on either list", () => {
    for (const schema of [listCashHandoversSchema, listReconciliationsSchema]) {
      const result = schema.safeParse({
        branchId: "99999999-9999-9999-9999-999999999999",
        fieldAgentId: "88888888-8888-8888-8888-888888888888",
      });

      expect(result.success).toBe(true);
      if (!result.success) continue;
      expect(result.data).not.toHaveProperty("branchId");
      expect(result.data).not.toHaveProperty("fieldAgentId");
    }
  });

  it("caps the page size on both lists", () => {
    for (const schema of [listCashHandoversSchema, listReconciliationsSchema]) {
      expect(schema.safeParse({ pageSize: "500" }).success).toBe(false);
    }
  });
});
