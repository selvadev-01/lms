/**
 * Tests for the Module 12 field collection schemas.
 *
 * Three properties here are load-bearing beyond ordinary validation coverage:
 *
 *  - **A claimed GPS success must name the check-in that verified it.** That is
 *    the client-side half of Scenario 55 ("GPS failure does not become silent
 *    success"). The API repeats the rule and additionally resolves the id, but
 *    a regression here is what would let the form submit the lie in the first
 *    place.
 *  - **Scope fields are absent, and the schema strips them.** Their absence is
 *    what makes Scenario 48 structural. A test that only checked "valid input
 *    parses" would not notice someone adding a `branchId` field.
 *  - **The field body really does inherit the Module 11 contract.** These
 *    schemas are built by extending `syncCollectionSchema`, so a Module 11
 *    change silently reshapes them. The inheritance tests pin that.
 */

import { describe, expect, it } from "vitest";

import {
  listFieldCollectionsSchema,
  recordFieldCollectionSchema,
  syncFieldCollectionSchema,
  verifyCollectionSchema,
} from "./field-collections";

const LOAN_ID = "11111111-1111-1111-1111-111111111111";
const IDEMPOTENCY_KEY = "22222222-2222-2222-2222-222222222222";
const OFFLINE_UUID = "33333333-3333-3333-3333-333333333333";
const CHECK_IN_ID = "44444444-4444-4444-4444-444444444444";
const VISIT_ID = "55555555-5555-5555-5555-555555555555";

function recordBody(overrides: Record<string, unknown> = {}) {
  return {
    loanId: LOAN_ID,
    collectionDate: "2026-08-24",
    paymentMode: "CASH",
    amountPaise: "100000",
    idempotencyKey: IDEMPOTENCY_KEY,
    deviceId: "device-alpha",
    gpsCaptureStatus: "PENDING",
    ...overrides,
  };
}

function syncBody(overrides: Record<string, unknown> = {}) {
  return recordBody({
    offlineTransactionUuid: OFFLINE_UUID,
    collectedAt: "2026-08-24T09:30:00+05:30",
    ...overrides,
  });
}

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

describe("recordFieldCollectionSchema", () => {
  it("accepts a valid cash collection with no GPS evidence", () => {
    // Rule 40: GPS is supporting evidence and does not replace authorization,
    // so a collection with no location is valid.
    const result = recordFieldCollectionSchema.safeParse(recordBody());
    expect(result.success).toBe(true);
  });

  it("requires a device id even when the network was up", () => {
    const body = recordBody();
    delete (body as Record<string, unknown>).deviceId;

    const result = recordFieldCollectionSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(messageFor(result, "deviceId")).toBe("Device id is required");
  });

  it("requires a GPS capture status", () => {
    const body = recordBody();
    delete (body as Record<string, unknown>).gpsCaptureStatus;

    const result = recordFieldCollectionSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(messageFor(result, "gpsCaptureStatus")).toBe(
      "GPS Capture Status is required",
    );
  });

  it("does not carry the offline identity fields", () => {
    // `record` is the online act. Accepting an offline uuid here would give one
    // logical payment two identities and defeat the replay lookup.
    const result = recordFieldCollectionSchema.safeParse(
      recordBody({
        offlineTransactionUuid: OFFLINE_UUID,
        collectedAt: "2026-08-24T09:30:00+05:30",
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("offlineTransactionUuid");
    expect(result.data).not.toHaveProperty("collectedAt");
  });

  it("inherits the Module 11 bank-reference rule", () => {
    // Not restated in field-collections.ts — it rides in from the extended
    // Module 11 body. If that inheritance broke, this is what would notice.
    const result = recordFieldCollectionSchema.safeParse(
      recordBody({ paymentMode: "UPI" }),
    );

    expect(result.success).toBe(false);
    expect(messageFor(result, "transactionReference")).toBe(
      "Payment Reference is required for this payment mode",
    );
  });

  it("inherits the Module 11 idempotency requirement", () => {
    const body = recordBody();
    delete (body as Record<string, unknown>).idempotencyKey;

    const result = recordFieldCollectionSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(messageFor(result, "idempotencyKey")).toBe(
      "Idempotency Key is required",
    );
  });
});

describe("GPS evidence honesty (Scenario 55, Rule 41)", () => {
  it("refuses a claimed GPS success with no check-in reference", () => {
    const result = recordFieldCollectionSchema.safeParse(
      recordBody({ gpsCaptureStatus: "VERIFIED" }),
    );

    expect(result.success).toBe(false);
    expect(messageFor(result, "gpsCheckInId")).toBe(
      "A verified GPS capture must reference the check-in that verified it",
    );
  });

  it("accepts a claimed GPS success that names its check-in", () => {
    const result = recordFieldCollectionSchema.safeParse(
      recordBody({ gpsCaptureStatus: "VERIFIED", gpsCheckInId: CHECK_IN_ID }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts a failed capture with no check-in, and keeps it failed", () => {
    // The whole point: a failure is recordable and is not promoted on the way
    // through. Synchronization must not convert it into a success.
    const result = syncFieldCollectionSchema.safeParse(
      syncBody({ gpsCaptureStatus: "FAILED" }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.gpsCaptureStatus).toBe("FAILED");
  });

  it("refuses a GPS status the server alone may decide", () => {
    // EXPIRED and CANCELLED are server verdicts. A client that can name any
    // outcome can name a flattering one.
    for (const status of ["EXPIRED", "CANCELLED", "GRANTED"]) {
      const result = recordFieldCollectionSchema.safeParse(
        recordBody({ gpsCaptureStatus: status }),
      );
      expect(result.success).toBe(false);
    }
  });
});

describe("syncFieldCollectionSchema", () => {
  it("accepts a valid offline capture", () => {
    const result = syncFieldCollectionSchema.safeParse(syncBody());
    expect(result.success).toBe(true);
  });

  it("inherits the Module 11 bank-reference rule", () => {
    // The same `.innerType()` hazard as the record schema: extending a
    // ZodEffects drops its refinement unless it is re-applied.
    const result = syncFieldCollectionSchema.safeParse(
      syncBody({ paymentMode: "BANK_TRANSFER" }),
    );

    expect(result.success).toBe(false);
    expect(messageFor(result, "transactionReference")).toBe(
      "Payment Reference is required for this payment mode",
    );
  });

  it("requires a stable offline transaction id", () => {
    const body = syncBody();
    delete (body as Record<string, unknown>).offlineTransactionUuid;

    const result = syncFieldCollectionSchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("keeps the device's captured time as evidence", () => {
    // Retained, and never authoritative: the business date is the server's.
    const result = syncFieldCollectionSchema.safeParse(syncBody());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.collectedAt).toBe("2026-08-24T09:30:00+05:30");
  });

  it("carries the field evidence alongside the offline identity", () => {
    const result = syncFieldCollectionSchema.safeParse(
      syncBody({
        gpsCaptureStatus: "VERIFIED",
        gpsCheckInId: CHECK_IN_ID,
        fieldVisitId: VISIT_ID,
        customerAckReference: "signature-book-p42",
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.fieldVisitId).toBe(VISIT_ID);
    expect(result.data.customerAckReference).toBe("signature-book-p42");
  });
});

describe("scope fields are absent (Scenario 48)", () => {
  it("strips anything that would let a client choose its own scope", () => {
    const result = syncFieldCollectionSchema.safeParse(
      syncBody({
        branchId: "99999999-9999-9999-9999-999999999999",
        collectorUserId: "88888888-8888-8888-8888-888888888888",
        customerId: "77777777-7777-7777-7777-777777777777",
        receiptNumber: "RCP-BR1-000001",
        isFieldCollection: true,
        custodyHandoverId: "66666666-6666-6666-6666-666666666666",
        penaltyPaidPaise: "500",
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    for (const key of [
      "branchId",
      "collectorUserId",
      "customerId",
      "receiptNumber",
      "isFieldCollection",
      "custodyHandoverId",
      "penaltyPaidPaise",
    ]) {
      expect(result.data).not.toHaveProperty(key);
    }
  });
});

describe("verifyCollectionSchema", () => {
  const VERSION = "2026-08-24T04:00:00.000Z";

  it("accepts a confirmation with no notes", () => {
    // "It is what it says it is" has no more detail to give.
    const result = verifyCollectionSchema.safeParse({
      decision: "CONFIRMED",
      expectedVersion: VERSION,
    });

    expect(result.success).toBe(true);
  });

  it("requires a reason when rejecting", () => {
    const result = verifyCollectionSchema.safeParse({
      decision: "REJECTED",
      expectedVersion: VERSION,
    });

    expect(result.success).toBe(false);
    expect(messageFor(result, "verificationNotes")).toBe(
      "A reason is required when rejecting a collection",
    );
  });

  it("accepts a rejection that gives a reason", () => {
    const result = verifyCollectionSchema.safeParse({
      decision: "REJECTED",
      verificationNotes: "Customer denies making this payment.",
      expectedVersion: VERSION,
    });

    expect(result.success).toBe(true);
  });

  it("requires a version, because the row already exists", () => {
    const result = verifyCollectionSchema.safeParse({
      decision: "CONFIRMED",
    });

    expect(result.success).toBe(false);
    expect(messageFor(result, "expectedVersion")).toBeDefined();
  });

  it("refuses a decision the reviewer may not make", () => {
    // PENDING_VERIFICATION is where a synced collection starts and RECONCILED
    // is set by the cash flow. Neither is a reviewer's verdict.
    for (const decision of ["PENDING_VERIFICATION", "RECONCILED"]) {
      const result = verifyCollectionSchema.safeParse({
        decision,
        expectedVersion: VERSION,
      });
      expect(result.success).toBe(false);
    }
  });
});

describe("listFieldCollectionsSchema", () => {
  it("defaults the page window", () => {
    const result = listFieldCollectionsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(20);
  });

  it("accepts the awaiting-handover narrowing", () => {
    const result = listFieldCollectionsSchema.safeParse({
      awaitingHandover: "true",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.awaitingHandover).toBe(true);
  });

  it("does not accept a branch or agent filter", () => {
    // Branch scope comes from the session; an agent's own scope is applied
    // server-side. Accepting either would mean deciding whether to believe it.
    const result = listFieldCollectionsSchema.safeParse({
      branchId: "99999999-9999-9999-9999-999999999999",
      fieldAgentId: "88888888-8888-8888-8888-888888888888",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("branchId");
    expect(result.data).not.toHaveProperty("fieldAgentId");
  });

  it("caps the page size", () => {
    const result = listFieldCollectionsSchema.safeParse({ pageSize: "500" });
    expect(result.success).toBe(false);
  });
});
