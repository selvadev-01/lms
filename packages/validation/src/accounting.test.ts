/**
 * Tests for the Module 14 accounting schemas.
 *
 * Four properties here are load-bearing beyond ordinary validation coverage:
 *
 *  - **The mandatory-field messages are the source's, verbatim.** The scenario
 *    outline names each one, so each is pinned rather than asserted loosely.
 *  - **Scope fields are absent, and the schema strips them.** No schema accepts
 *    an `orgId` or `branchId`; that absence is what makes cross-branch posting
 *    structurally impossible rather than a check somebody has to remember.
 *  - **Only MANUAL and ADJUSTMENT are authorable.** A hand-written journal that
 *    could claim to be a DISBURSEMENT would reconcile against a source
 *    transaction that does not exist.
 *  - **Totals are compared as BigInt.** The 90,000-crore case below is the one
 *    a `Number` comparison gets wrong, and it is the whole reason money crosses
 *    this boundary as a digit string.
 */

import { describe, expect, it } from "vitest";

import {
  createAccountSchema,
  createJournalSchema,
  generalLedgerQuerySchema,
  journalLineSchema,
  listAccountsSchema,
  manualJournalTypeSchema,
  reverseJournalSchema,
  updateAccountSchema,
  updateJournalSchema,
  validateJournalSchema,
} from "./accounting";

const BANK = "11111111-1111-1111-1111-111111111111";
const INCOME = "22222222-2222-2222-2222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-3333-3333-333333333333";
const VERSION = "2026-08-23T10:00:00.000Z";

function validAccount(overrides: Record<string, unknown> = {}) {
  return {
    accountCode: "1300",
    accountName: "Suspense",
    accountType: "ASSET",
    normalBalance: "DEBIT",
    status: "ACTIVE",
    ...overrides,
  };
}

function line(overrides: Record<string, unknown> = {}) {
  return {
    accountId: BANK,
    debitPaise: "50000",
    creditPaise: "",
    ...overrides,
  };
}

function validJournal(overrides: Record<string, unknown> = {}) {
  return {
    entryDate: "2026-08-23",
    entryType: "MANUAL",
    description: "Bank charges for August",
    idempotencyKey: IDEMPOTENCY_KEY,
    lines: [
      line(),
      line({ accountId: INCOME, debitPaise: "", creditPaise: "50000" }),
    ],
    ...overrides,
  };
}

/** The first message for a given path, or undefined. */
function messageAt(
  result: { success: boolean; error?: { issues: readonly unknown[] } },
  path: string,
): string | undefined {
  if (result.success) return undefined;
  const issues = result.error!.issues as {
    path: (string | number)[];
    message: string;
  }[];
  return issues.find((issue) => issue.path.join(".") === path)?.message;
}

function messages(result: {
  success: boolean;
  error?: { issues: readonly unknown[] };
}): string[] {
  if (result.success) return [];
  return (result.error!.issues as { message: string }[]).map((i) => i.message);
}

describe("chart of accounts", () => {
  it("accepts a well-formed account", () => {
    expect(createAccountSchema.safeParse(validAccount()).success).toBe(true);
  });

  it.each([
    ["accountCode", "Account Code is required"],
    ["accountName", "Account Name is required"],
  ])("requires %s with the source's message", (field, message) => {
    const result = createAccountSchema.safeParse(validAccount({ [field]: "" }));

    expect(result.success).toBe(false);
    expect(messageAt(result, field)).toBe(message);
  });

  it("reports an untouched Account Type select as required", () => {
    // An untouched <select> posts "", which fails the enum rather than any
    // length rule — which is why the message lives on the enum's errorMap.
    const result = createAccountSchema.safeParse(
      validAccount({ accountType: "" }),
    );

    expect(messageAt(result, "accountType")).toBe("Account Type is required");
  });

  it("rejects an account code containing characters a URL would escape", () => {
    const result = createAccountSchema.safeParse(
      validAccount({ accountCode: "11 00/A" }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects a normal balance that contradicts the account type", () => {
    // An asset carrying a credit balance is a data-entry slip, and finding it
    // here is far cheaper than finding it in a trial balance that will not tie.
    const result = createAccountSchema.safeParse(
      validAccount({ accountType: "ASSET", normalBalance: "CREDIT" }),
    );

    expect(messageAt(result, "normalBalance")).toBe(
      "An asset account normally carries a debit balance",
    );
  });

  it.each([
    ["LIABILITY", "CREDIT"],
    ["EQUITY", "CREDIT"],
    ["INCOME", "CREDIT"],
    ["EXPENSE", "DEBIT"],
    ["ASSET", "DEBIT"],
  ])("accepts %s with its conventional %s balance", (type, balance) => {
    const result = createAccountSchema.safeParse(
      validAccount({ accountType: type, normalBalance: balance }),
    );

    expect(result.success).toBe(true);
  });

  it("refuses a control account that is also postable", () => {
    const result = createAccountSchema.safeParse(
      validAccount({ isControlAccount: true, isPostable: true }),
    );

    expect(messageAt(result, "isPostable")).toBe(
      "A control account is driven by its subsidiary ledger and cannot be posted to directly",
    );
  });

  it("refuses an effective range that ends before it starts", () => {
    const result = createAccountSchema.safeParse(
      validAccount({ effectiveFrom: "2026-08-23", effectiveTo: "2026-08-01" }),
    );

    expect(messageAt(result, "effectiveTo")).toBe(
      "Effective To must be on or after Effective From",
    );
  });

  it("accepts an effective range that starts and ends on the same day", () => {
    const result = createAccountSchema.safeParse(
      validAccount({ effectiveFrom: "2026-08-23", effectiveTo: "2026-08-23" }),
    );

    expect(result.success).toBe(true);
  });

  it("defaults a new account to postable but not manually postable", () => {
    // The asymmetry is deliberate: a source module may post to any active
    // account, but a hand-written journal may only touch one explicitly opened
    // to it.
    const parsed = createAccountSchema.parse(validAccount());

    expect(parsed.isPostable).toBe(true);
    expect(parsed.isManualPostingAllowed).toBe(false);
    expect(parsed.branchScope).toBe("ORGANIZATION");
  });

  it("strips a client-supplied orgId or branchId", () => {
    // Their absence is what makes cross-organization writes structurally
    // impossible. A test that only checked "valid input parses" would not
    // notice someone adding the field.
    const parsed = createAccountSchema.parse(
      validAccount({ orgId: "sneaky", branchId: "sneaky" }),
    );

    expect(parsed).not.toHaveProperty("orgId");
    expect(parsed).not.toHaveProperty("branchId");
  });

  it("still enforces the cross-field rules on a partial edit", () => {
    // A rule enforced on create but not on edit can be got around by creating
    // and then editing.
    const result = updateAccountSchema.safeParse({
      accountType: "INCOME",
      normalBalance: "DEBIT",
      expectedVersion: VERSION,
    });

    expect(result.success).toBe(false);
  });

  it("requires a version on edit", () => {
    const result = updateAccountSchema.safeParse({ accountName: "Renamed" });

    expect(result.success).toBe(false);
  });

  it("accepts an edit that changes one field", () => {
    const result = updateAccountSchema.safeParse({
      accountName: "Renamed",
      expectedVersion: VERSION,
    });

    expect(result.success).toBe(true);
  });

  it("accepts an empty account filter", () => {
    expect(listAccountsSchema.safeParse({}).success).toBe(true);
  });
});

describe("journal lines", () => {
  it("accepts a debit-only line whose credit field was left blank", () => {
    // The blank half is the normal case, not an edge case: exactly one side of
    // every line is always empty.
    const result = journalLineSchema.safeParse(line());

    expect(result.success).toBe(true);
    expect(result.success && result.data.creditPaise).toBe("0");
  });

  it("accepts a credit-only line", () => {
    const result = journalLineSchema.safeParse(
      line({ debitPaise: "", creditPaise: "50000" }),
    );

    expect(result.success).toBe(true);
    expect(result.success && result.data.debitPaise).toBe("0");
  });

  it("treats a missing side as zero rather than as unknown", () => {
    const result = journalLineSchema.safeParse({
      accountId: BANK,
      debitPaise: "50000",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.creditPaise).toBe("0");
  });

  it("refuses a line carrying both a debit and a credit", () => {
    const result = journalLineSchema.safeParse(
      line({ debitPaise: "100", creditPaise: "100" }),
    );

    expect(messageAt(result, "debitPaise")).toBe(
      "A line is either a debit or a credit, not both",
    );
  });

  it("refuses a line that moves nothing", () => {
    const result = journalLineSchema.safeParse(
      line({ debitPaise: "", creditPaise: "" }),
    );

    expect(messageAt(result, "debitPaise")).toBe(
      "Enter a debit or a credit amount",
    );
  });

  it("refuses a fractional amount rather than rounding it", () => {
    // "100.50" is rupees typed into a paise field. Rounding it would silently
    // change the amount; rejecting it makes the caller convert deliberately.
    const result = journalLineSchema.safeParse(line({ debitPaise: "100.50" }));

    expect(result.success).toBe(false);
  });

  it("refuses a negative amount", () => {
    const result = journalLineSchema.safeParse(line({ debitPaise: "-100" }));

    expect(result.success).toBe(false);
  });

  it("requires an account", () => {
    const result = journalLineSchema.safeParse(line({ accountId: "" }));

    expect(messageAt(result, "accountId")).toBe("Account is required");
  });
});

describe("journal entries", () => {
  it("accepts a balanced two-line journal", () => {
    expect(createJournalSchema.safeParse(validJournal()).success).toBe(true);
  });

  it.each([
    ["entryDate", "Business Date is required"],
    ["description", "Description is required"],
  ])("requires %s with the source's message", (field, message) => {
    const result = createJournalSchema.safeParse(validJournal({ [field]: "" }));

    expect(messageAt(result, field)).toBe(message);
  });

  it("reports an untouched Journal Type select as required", () => {
    const result = createJournalSchema.safeParse(
      validJournal({ entryType: "" }),
    );

    expect(messageAt(result, "entryType")).toBe("Journal Type is required");
  });

  it("requires at least one line", () => {
    const result = createJournalSchema.safeParse(validJournal({ lines: [] }));

    expect(messages(result)).toContain("At least one journal line is required");
  });

  it("refuses an unbalanced journal and says by how much", () => {
    const result = createJournalSchema.safeParse(
      validJournal({
        lines: [
          line({ debitPaise: "50000" }),
          line({ accountId: INCOME, debitPaise: "", creditPaise: "40000" }),
        ],
      }),
    );

    expect(messageAt(result, "lines")).toBe(
      "Total debit must equal total credit. They differ by ₹100.00.",
    );
  });

  it("refuses a journal with only debit lines", () => {
    const result = createJournalSchema.safeParse(
      validJournal({
        lines: [
          line({ debitPaise: "50000" }),
          line({ accountId: INCOME, debitPaise: "50000" }),
        ],
      }),
    );

    expect(messageAt(result, "lines")).toBe(
      "A journal needs at least one debit line and one credit line",
    );
  });

  it("refuses a journal with only credit lines", () => {
    const result = createJournalSchema.safeParse(
      validJournal({
        lines: [
          line({ debitPaise: "", creditPaise: "50000" }),
          line({ accountId: INCOME, debitPaise: "", creditPaise: "50000" }),
        ],
      }),
    );

    expect(messageAt(result, "lines")).toBe(
      "A journal needs at least one debit line and one credit line",
    );
  });

  it("balances amounts too large for a double to hold exactly", () => {
    // 90,000 crore in paise, plus one. Number arithmetic loses the final digit
    // here and would report these two lines as balanced against a total that
    // differs by a paise. BigInt does not.
    const huge = "9000000000000001";
    const result = createJournalSchema.safeParse(
      validJournal({
        lines: [
          line({ debitPaise: huge }),
          line({ accountId: INCOME, debitPaise: "", creditPaise: huge }),
        ],
      }),
    );

    expect(result.success).toBe(true);
  });

  it("detects a one-paise imbalance at that scale", () => {
    const result = createJournalSchema.safeParse(
      validJournal({
        lines: [
          line({ debitPaise: "9000000000000001" }),
          line({
            accountId: INCOME,
            debitPaise: "",
            creditPaise: "9000000000000000",
          }),
        ],
      }),
    );

    expect(messageAt(result, "lines")).toBe(
      "Total debit must equal total credit. They differ by ₹0.01.",
    );
  });

  it("flags a repeated account on the same side", () => {
    const result = createJournalSchema.safeParse(
      validJournal({
        lines: [
          line({ debitPaise: "25000" }),
          line({ debitPaise: "25000" }),
          line({ accountId: INCOME, debitPaise: "", creditPaise: "50000" }),
        ],
      }),
    );

    expect(messageAt(result, "lines.1.accountId")).toBe(
      "This account already has a line on the same side",
    );
  });

  it("allows the same account on opposite sides", () => {
    // A contra entry against one account is legitimate, if unusual.
    const result = createJournalSchema.safeParse(
      validJournal({
        lines: [
          line({ debitPaise: "50000" }),
          line({ debitPaise: "", creditPaise: "50000" }),
        ],
      }),
    );

    expect(result.success).toBe(true);
  });

  it("requires a reason on an adjustment", () => {
    const result = createJournalSchema.safeParse(
      validJournal({ entryType: "ADJUSTMENT" }),
    );

    expect(messageAt(result, "adjustmentReason")).toBe(
      "An adjustment needs a reason",
    );
  });

  it("accepts an adjustment that carries its reason", () => {
    const result = createJournalSchema.safeParse(
      validJournal({
        entryType: "ADJUSTMENT",
        adjustmentReason: "Correcting the August bank charge misposting",
      }),
    );

    expect(result.success).toBe(true);
  });

  it("offers only the two authorable entry types", () => {
    // The other thirteen JournalEntryType members belong to source modules. A
    // hand-written journal claiming to be a DISBURSEMENT would reconcile
    // against a source transaction that does not exist.
    expect(manualJournalTypeSchema.options).toEqual(["MANUAL", "ADJUSTMENT"]);
  });

  it.each(["DISBURSEMENT", "COLLECTION", "REVERSAL", "WRITE_OFF"])(
    "refuses the source-owned entry type %s",
    (entryType) => {
      const result = createJournalSchema.safeParse(validJournal({ entryType }));

      expect(result.success).toBe(false);
    },
  );

  it("requires an idempotency key on create", () => {
    const { idempotencyKey: _omitted, ...withoutKey } = validJournal();
    const result = createJournalSchema.safeParse(withoutKey);

    expect(result.success).toBe(false);
  });

  it("requires a version on edit but no idempotency key", () => {
    const { idempotencyKey: _omitted, ...rest } = validJournal();
    const result = updateJournalSchema.safeParse({
      ...rest,
      expectedVersion: VERSION,
    });

    expect(result.success).toBe(true);
  });

  it("validates a draft without needing a key or a version", () => {
    const { idempotencyKey: _omitted, ...rest } = validJournal();

    expect(validateJournalSchema.safeParse(rest).success).toBe(true);
  });

  it("strips a client-supplied branchId", () => {
    const parsed = createJournalSchema.parse(
      validJournal({ branchId: "sneaky", orgId: "sneaky" }),
    );

    expect(parsed).not.toHaveProperty("branchId");
    expect(parsed).not.toHaveProperty("orgId");
  });
});

describe("reversal", () => {
  it("requires a reason", () => {
    const result = reverseJournalSchema.safeParse({
      reversalReason: "",
      expectedVersion: VERSION,
    });

    expect(messageAt(result, "reversalReason")).toBe(
      "Reversal Reason is required",
    );
  });

  it("accepts a reason and a version", () => {
    const result = reverseJournalSchema.safeParse({
      reversalReason: "Posted against the wrong account",
      expectedVersion: VERSION,
    });

    expect(result.success).toBe(true);
  });

  it("accepts an explicit business date", () => {
    const result = reverseJournalSchema.safeParse({
      reversalReason: "Posted against the wrong account",
      entryDate: "2026-08-24",
      expectedVersion: VERSION,
    });

    expect(result.success).toBe(true);
  });

  it("requires a version, so a stale reversal cannot be submitted", () => {
    const result = reverseJournalSchema.safeParse({
      reversalReason: "Posted against the wrong account",
    });

    expect(result.success).toBe(false);
  });
});

describe("general ledger query", () => {
  it("requires an account", () => {
    const result = generalLedgerQuerySchema.safeParse({});

    expect(messageAt(result, "accountId")).toBe("Account is required");
  });

  it("accepts an account with a date range", () => {
    const result = generalLedgerQuerySchema.safeParse({
      accountId: BANK,
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    });

    expect(result.success).toBe(true);
  });

  it("strips a client-supplied branchId", () => {
    // Branch confinement comes from the actor's scope. The field's absence is
    // what makes a client-supplied branch a 400 rather than a leak.
    const parsed = generalLedgerQuerySchema.parse({
      accountId: BANK,
      branchId: "sneaky",
    });

    expect(parsed).not.toHaveProperty("branchId");
  });

  it("rejects a malformed date rather than coercing it", () => {
    const result = generalLedgerQuerySchema.safeParse({
      accountId: BANK,
      fromDate: "2026-02-31",
    });

    expect(result.success).toBe(false);
  });
});
