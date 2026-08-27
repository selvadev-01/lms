/**
 * Tests for the Module 11 collection schemas.
 *
 * Two properties here are load-bearing beyond ordinary validation coverage:
 *
 *  - **The mandatory-field messages are the source's, verbatim.** The scenario
 *    outline names each one, and an e2e test asserts the rendered text. Changing
 *    a message here breaks a documented acceptance criterion, so each is pinned.
 *  - **Scope fields are absent, and the schema strips them.** That absence is
 *    what makes Scenarios 37, 38 and 39 structural. A test that only checked
 *    "valid input parses" would not notice someone adding a `branchId` field.
 */

import { describe, expect, it } from "vitest";

import {
  listCollectionsSchema,
  postCollectionSchema,
  previewAllocationSchema,
  reverseCollectionSchema,
  syncCollectionSchema,
} from "./collections";

const LOAN_ID = "11111111-1111-1111-1111-111111111111";
const IDEMPOTENCY_KEY = "22222222-2222-2222-2222-222222222222";
const OFFLINE_UUID = "33333333-3333-3333-3333-333333333333";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    loanId: LOAN_ID,
    collectionDate: "2026-08-22",
    paymentMode: "CASH",
    amountPaise: "100000",
    idempotencyKey: IDEMPOTENCY_KEY,
    ...overrides,
  };
}

/** The first message for a field, or undefined if the field passed. */
function messageFor(
  result: ReturnType<typeof postCollectionSchema.safeParse>,
  field: string,
): string | undefined {
  if (result.success) return undefined;
  const fieldErrors = result.error.flatten().fieldErrors as Record<
    string,
    string[] | undefined
  >;
  return fieldErrors[field]?.[0];
}

describe("postCollectionSchema — mandatory fields", () => {
  it("accepts a well-formed cash collection", () => {
    const result = postCollectionSchema.safeParse(validBody());

    expect(result.success).toBe(true);
  });

  // The scenario outline in the source, one row per case.
  it.each([
    ["loanId", "Loan is required"],
    ["collectionDate", "Collection Date is required"],
    ["paymentMode", "Payment Mode is required"],
    ["amountPaise", "Collected Amount is required"],
    ["idempotencyKey", "Idempotency Key is required"],
  ])("reports %s as missing with the source's message", (field, message) => {
    const body = validBody();
    delete (body as Record<string, unknown>)[field];

    expect(messageFor(postCollectionSchema.safeParse(body), field)).toBe(
      message,
    );
  });

  it("treats an empty string as missing, not as a value", () => {
    // An untouched input posts "", which must fail the same way an absent field
    // does rather than reaching the server as a blank.
    for (const field of ["collectionDate", "paymentMode", "amountPaise"]) {
      const result = postCollectionSchema.safeParse(validBody({ [field]: "" }));
      expect(result.success).toBe(false);
    }
  });
});

describe("postCollectionSchema — amounts", () => {
  it("rejects a zero amount", () => {
    // Scenario 9.
    expect(
      messageFor(
        postCollectionSchema.safeParse(validBody({ amountPaise: "0" })),
        "amountPaise",
      ),
    ).toBe("Collected Amount must be greater than zero");
  });

  it("rejects a negative amount", () => {
    // Scenario 10. The digit regex is what refuses the minus sign.
    expect(
      messageFor(
        postCollectionSchema.safeParse(validBody({ amountPaise: "-100" })),
        "amountPaise",
      ),
    ).toBe("Collected Amount must be a whole number of paise");
  });

  it.each(["1000.50", "1,000", "1e5", "abc", " 100 200"])(
    "rejects %s as a non-integer-paise representation",
    (amount) => {
      // Scenario 11. A decimal must fail rather than round: coercing to a
      // number would turn "1000.50" into 1000 or 1001 silently.
      const result = postCollectionSchema.safeParse(
        validBody({ amountPaise: amount }),
      );
      expect(result.success).toBe(false);
    },
  );

  it("accepts a large amount without precision loss", () => {
    // Well past Number.MAX_SAFE_INTEGER: the string carries it intact, which is
    // the whole reason money crosses the wire as digits.
    const huge = "90071992547409910";
    const result = postCollectionSchema.safeParse(
      validBody({ amountPaise: huge }),
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amountPaise).toBe(huge);
  });
});

describe("postCollectionSchema — dates", () => {
  it("rejects a well-formed but non-existent date", () => {
    expect(
      messageFor(
        postCollectionSchema.safeParse(
          validBody({ collectionDate: "2026-02-31" }),
        ),
        "collectionDate",
      ),
    ).toBe("Collection Date must be a valid date");
  });

  it.each(["22-08-2026", "2026/08/22", "2026-8-2", "yesterday"])(
    "rejects %s as a collection date",
    (value) => {
      const result = postCollectionSchema.safeParse(
        validBody({ collectionDate: value }),
      );
      expect(result.success).toBe(false);
    },
  );

  it("accepts a leap day that exists", () => {
    const result = postCollectionSchema.safeParse(
      validBody({ collectionDate: "2028-02-29" }),
    );
    expect(result.success).toBe(true);
  });
});

describe("postCollectionSchema — payment reference", () => {
  it.each(["UPI", "BANK_TRANSFER"])(
    "requires a reference for %s",
    (paymentMode) => {
      // Scenario 45.
      const result = postCollectionSchema.safeParse(validBody({ paymentMode }));

      expect(messageFor(result, "transactionReference")).toBe(
        "Payment Reference is required for this payment mode",
      );
    },
  );

  it("does not require a reference for cash", () => {
    const result = postCollectionSchema.safeParse(
      validBody({ paymentMode: "CASH" }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts a reference supplied alongside a bank mode", () => {
    const result = postCollectionSchema.safeParse(
      validBody({ paymentMode: "UPI", transactionReference: "UTR-2026-0001" }),
    );

    expect(result.success).toBe(true);
  });

  it("rejects a reference with characters that would need escaping", () => {
    const result = postCollectionSchema.safeParse(
      validBody({
        paymentMode: "UPI",
        transactionReference: "UTR 2026, <b>x</b>",
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects an unknown payment mode", () => {
    expect(
      messageFor(
        postCollectionSchema.safeParse(validBody({ paymentMode: "CHEQUE" })),
        "paymentMode",
      ),
    ).toBe("Payment Mode is required");
  });
});

describe("postCollectionSchema — what it refuses to carry", () => {
  it.each([
    "branchId",
    "customerId",
    "collectorUserId",
    "receiptNumber",
    "penaltyPaidPaise",
    "principalPaidPaise",
    "status",
  ])("strips %s rather than letting a client set it", (field) => {
    // Scenarios 37, 38, 39. Zod strips unknown keys by default; the API's
    // `forbidNonWhitelisted` turns the same attempt into a 400. Either way the
    // value never reaches a query.
    const result = postCollectionSchema.safeParse(
      validBody({ [field]: "attacker-supplied" }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty(field);
    }
  });

  it("requires the idempotency key to be a uuid", () => {
    // A non-uuid key would still be unique-indexed, but uuid-ness is what makes
    // a client-minted key collision-free across devices.
    expect(
      messageFor(
        postCollectionSchema.safeParse(
          validBody({ idempotencyKey: "KEY-001" }),
        ),
        "idempotencyKey",
      ),
    ).toBe("Idempotency Key is required");
  });
});

describe("reverseCollectionSchema", () => {
  const valid = {
    reversalReason: "Collected against the wrong loan",
    expectedVersion: "2026-08-22T10:00:00.000Z",
  };

  it("accepts a reason with a version", () => {
    expect(reverseCollectionSchema.safeParse(valid).success).toBe(true);
  });

  it.each(["", "   "])("requires a non-blank reason (%s)", (reason) => {
    const result = reverseCollectionSchema.safeParse({
      ...valid,
      reversalReason: reason,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.reversalReason?.[0]).toBe(
        "Reversal Reason is required",
      );
    }
  });

  it("requires a parseable version token", () => {
    // Scenario 26: a malformed token must be a 400 at the edge rather than an
    // opaque failed match inside the reversal transaction.
    const result = reverseCollectionSchema.safeParse({
      ...valid,
      expectedVersion: "not-a-timestamp",
    });

    expect(result.success).toBe(false);
  });

  it("carries no amount, because reversal is full-only", () => {
    const result = reverseCollectionSchema.safeParse({
      ...valid,
      amountPaise: "500",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("amountPaise");
  });
});

describe("syncCollectionSchema", () => {
  const valid = {
    ...validBody(),
    offlineTransactionUuid: OFFLINE_UUID,
    deviceId: "field-tablet-07",
    collectedAt: "2026-08-22T09:15:00.000Z",
  };

  it("accepts an offline capture with its device identity", () => {
    // Scenarios 17, 40.
    expect(syncCollectionSchema.safeParse(valid).success).toBe(true);
  });

  it.each(["offlineTransactionUuid", "deviceId", "collectedAt"])(
    "requires %s",
    (field) => {
      const body = { ...valid };
      delete (body as Record<string, unknown>)[field];

      expect(syncCollectionSchema.safeParse(body).success).toBe(false);
    },
  );

  it("requires a timestamp with an offset for the capture time", () => {
    // A bare local time would be ambiguous, and the whole point of retaining
    // the device time is that it says exactly when the device thought it was.
    expect(
      syncCollectionSchema.safeParse({
        ...valid,
        collectedAt: "2026-08-22 09:15",
      }).success,
    ).toBe(false);
  });

  it("still enforces the reference rule offline", () => {
    // Scenario 41: sync re-runs every gate. A device cannot post a referenceless
    // bank transfer by going through the offline path.
    const result = syncCollectionSchema.safeParse({
      ...valid,
      paymentMode: "BANK_TRANSFER",
    });

    expect(result.success).toBe(false);
  });
});

describe("previewAllocationSchema", () => {
  it("accepts a loan and an amount", () => {
    expect(
      previewAllocationSchema.safeParse({
        loanId: LOAN_ID,
        amountPaise: "5000",
      }).success,
    ).toBe(true);
  });

  it("refuses a zero preview, matching the posting rule", () => {
    // The preview and the post must agree about what is collectable, or the
    // form would offer an amount the server then refuses.
    expect(
      previewAllocationSchema.safeParse({ loanId: LOAN_ID, amountPaise: "0" })
        .success,
    ).toBe(false);
  });
});

describe("listCollectionsSchema", () => {
  it("defaults paging when nothing is supplied", () => {
    const result = listCollectionsSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  it("strips a client-supplied branch filter", () => {
    // Scenario 1: branch scope comes from the session. Accepting a filter here
    // would mean the server had to decide whether to believe it.
    const result = listCollectionsSchema.safeParse({
      branchId: "other-branch",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });

  it("caps the page size", () => {
    expect(listCollectionsSchema.safeParse({ pageSize: 5000 }).success).toBe(
      false,
    );
  });

  it("accepts a status filter from the enum only", () => {
    expect(listCollectionsSchema.safeParse({ status: "POSTED" }).success).toBe(
      true,
    );
    expect(listCollectionsSchema.safeParse({ status: "PAID" }).success).toBe(
      false,
    );
  });
});
