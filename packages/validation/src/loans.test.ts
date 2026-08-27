import { describe, expect, it } from "vitest";

import {
  applicationStatusSchema,
  createLoanApplicationSchema,
  createLoanProductSchema,
  createLoanSchemeSchema,
  declineSanctionSchema,
  emiPreviewSchema,
  expectedVersionSchema,
  listLoanApplicationsSchema,
  modifyTermsSchema,
  recordCreditAssessmentSchema,
  rejectApplicationSchema,
  updateLoanApplicationSchema,
  uploadApplicationDocumentSchema,
  verifyApplicationDocumentSchema,
} from "./loans";

/**
 * What these tests pin, beyond "the schema exists":
 *
 * 1. The money rules. A paise field that quietly accepts "1000.50" or rounds a
 *    large value through `Number` is the failure this whole string-based
 *    representation exists to prevent, so it is tested directly.
 * 2. The fields deliberately *absent* from each schema. `forbidNonWhitelisted`
 *    on the API turns an extra key into a 400, which is what makes scope
 *    tampering structural — but only as long as the key really is absent, so a
 *    future "convenience" addition should break a test rather than open a hole.
 * 3. The conditionally-required reasons, where the message must name the field
 *    the user has to fill in.
 */

function validApplication() {
  return {
    customerId: "11111111-1111-4111-8111-111111111111",
    loanSchemeId: "22222222-2222-4222-8222-222222222222",
    requestedAmountPaise: "10000000",
    purpose: "Working capital",
    interestType: "REDUCING" as const,
    interestRateBps: "1200",
    repaymentFrequency: "MONTHLY" as const,
    durationCount: 12,
  };
}

const VERSION = "2026-08-19T12:00:00.000Z";

describe("money and rate fields", () => {
  it("accepts a plain digit string of paise", () => {
    const parsed = createLoanApplicationSchema.safeParse(validApplication());
    expect(parsed.success).toBe(true);
  });

  it.each(["1000.50", "1,000", "1e5", "-100", " ", "abc", "0x10"])(
    "rejects %o as an amount",
    (requestedAmountPaise) => {
      const parsed = createLoanApplicationSchema.safeParse({
        ...validApplication(),
        requestedAmountPaise,
      });
      expect(parsed.success).toBe(false);
    },
  );

  it("rejects a zero amount", () => {
    // Rule 9 / Scenario 8: amount must be strictly greater than zero.
    const parsed = createLoanApplicationSchema.safeParse({
      ...validApplication(),
      requestedAmountPaise: "0",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.requestedAmountPaise).toContain(
      "Loan Amount must be greater than zero",
    );
  });

  it("accepts an amount far beyond Number.MAX_SAFE_INTEGER", () => {
    // 10^17 paise is a thousand crore rupees. Representable exactly as a string
    // and as a bigint; not as a float. This is why the field is not a number.
    const big = "100000000000000000";
    const parsed = createLoanApplicationSchema.safeParse({
      ...validApplication(),
      requestedAmountPaise: big,
    });
    expect(parsed.success).toBe(true);
    expect(BigInt(big) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("reports a missing amount as required rather than as malformed", () => {
    const parsed = createLoanApplicationSchema.safeParse({
      ...validApplication(),
      requestedAmountPaise: "",
    });
    expect(parsed.error?.flatten().fieldErrors.requestedAmountPaise?.[0]).toBe(
      "Loan Amount is required",
    );
  });

  it("rejects an absurd interest rate", () => {
    const parsed = createLoanSchemeSchema.safeParse({
      loanProductId: "33333333-3333-4333-8333-333333333333",
      code: "SCH-01",
      name: "Standard",
      interestType: "FLAT",
      interestRateBps: "99999999",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a zero interest rate", () => {
    // A zero-rate loan is legal and the calculator handles it (D-EMI-7).
    const parsed = emiPreviewSchema.safeParse({
      principalPaise: "10000000",
      annualRateBps: "0",
      interestType: "REDUCING",
      frequency: "MONTHLY",
      durationCount: 12,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("duration", () => {
  it.each([0, -1, 1.5, 10_001])("rejects %o", (durationCount) => {
    const parsed = createLoanApplicationSchema.safeParse({
      ...validApplication(),
      durationCount,
    });
    expect(parsed.success).toBe(false);
  });

  it("coerces a form's string duration to a number", () => {
    // FormData gives strings; the service wants a number.
    const parsed = createLoanApplicationSchema.safeParse({
      ...validApplication(),
      durationCount: "24",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.durationCount).toBe(24);
  });
});

describe("scope fields are absent", () => {
  it("strips orgId and branchId from an application", () => {
    // Zod strips unknown keys; the API's forbidNonWhitelisted rejects them
    // outright. Either way a client cannot place an application outside its own
    // reach (Scenarios 41-43).
    const parsed = createLoanApplicationSchema.safeParse({
      ...validApplication(),
      orgId: "44444444-4444-4444-8444-444444444444",
      branchId: "55555555-5555-4555-8555-555555555555",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("orgId");
    expect(parsed.data).not.toHaveProperty("branchId");
  });

  it("strips status from an application, which has its own transitions", () => {
    const parsed = createLoanApplicationSchema.safeParse({
      ...validApplication(),
      status: "APPROVED",
    });
    expect(parsed.data).not.toHaveProperty("status");
  });

  it("omits customerId from the draft edit schema", () => {
    // Changing who an application is for makes it a different application, and
    // would strand documents uploaded against the original borrower.
    const parsed = updateLoanApplicationSchema.safeParse({
      ...validApplication(),
      expectedVersion: VERSION,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("customerId");
  });
});

describe("expectedVersion", () => {
  it("accepts an ISO timestamp", () => {
    expect(expectedVersionSchema.safeParse(VERSION).success).toBe(true);
  });

  it.each(["", "   ", "not-a-date"])("rejects %o", (value) => {
    expect(expectedVersionSchema.safeParse(value).success).toBe(false);
  });

  it("is required on every mutating schema", () => {
    const withoutVersion = { ...validApplication() };
    expect(updateLoanApplicationSchema.safeParse(withoutVersion).success).toBe(
      false,
    );
    expect(
      rejectApplicationSchema.safeParse({ rejectionReason: "Too risky" })
        .success,
    ).toBe(false);
  });
});

describe("rejection and modification reasons", () => {
  it("requires a rejection reason", () => {
    // Rule 40 / Scenario 27: the unified REJECTED status carries no information
    // on its own, so the reason is the record.
    const parsed = rejectApplicationSchema.safeParse({
      expectedVersion: VERSION,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.rejectionReason?.[0]).toBe(
      "Rejection Reason is required",
    );
  });

  it("rejects a whitespace-only rejection reason", () => {
    const parsed = rejectApplicationSchema.safeParse({
      rejectionReason: "    ",
      expectedVersion: VERSION,
    });
    expect(parsed.success).toBe(false);
  });

  it("requires a comment explaining a terms change", () => {
    const parsed = modifyTermsSchema.safeParse({
      interestType: "REDUCING",
      interestRateBps: "1400",
      repaymentFrequency: "MONTHLY",
      durationCount: 18,
      expectedVersion: VERSION,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.comments?.[0]).toBe(
      "Record why the terms changed",
    );
  });
});

describe("documents", () => {
  it("accepts the three source-defined categories", () => {
    for (const documentType of ["ID", "INCOME", "COLLATERAL"] as const) {
      expect(
        uploadApplicationDocumentSchema.safeParse({ documentType }).success,
      ).toBe(true);
    }
  });

  it("rejects a KYC category that belongs to the customer module", () => {
    // ADDRESS and PHOTO are borrower-KYC types living in a different table under
    // different permissions. One shared enum is how a reviewer's reach would
    // widen by accident.
    expect(
      uploadApplicationDocumentSchema.safeParse({ documentType: "PHOTO" })
        .success,
    ).toBe(false);
    expect(
      uploadApplicationDocumentSchema.safeParse({ documentType: "ADDRESS" })
        .success,
    ).toBe(false);
  });

  it("requires a reason when rejecting a document, reported on that field", () => {
    const parsed = verifyApplicationDocumentSchema.safeParse({
      status: "REJECTED",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.verificationReason?.[0]).toBe(
      "Give a reason when rejecting a document",
    );
  });

  it("does not require a reason when verifying", () => {
    expect(
      verifyApplicationDocumentSchema.safeParse({ status: "VERIFIED" }).success,
    ).toBe(true);
  });
});

describe("product and scheme codes", () => {
  it("accepts an uppercase code", () => {
    const parsed = createLoanProductSchema.safeParse({
      code: "PERSONAL-01",
      name: "Personal Loan",
      loanType: "PERSONAL",
    });
    expect(parsed.success).toBe(true);
  });

  it.each(["lower", "WITH SPACE", "-LEADING", "", "WITH/SLASH"])(
    "rejects code %o",
    (code) => {
      const parsed = createLoanProductSchema.safeParse({
        code,
        name: "Personal Loan",
        loanType: "PERSONAL",
      });
      expect(parsed.success).toBe(false);
    },
  );

  it("rejects a loan type outside the four allowed", () => {
    // Scenario 9.
    const parsed = createLoanProductSchema.safeParse({
      code: "AGRI-01",
      name: "Agriculture",
      loanType: "AGRICULTURE",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.loanType?.[0]).toBe(
      "Loan Type is required",
    );
  });
});

describe("list filters", () => {
  it("treats blank filters as absent rather than as match-nothing", () => {
    const parsed = listLoanApplicationsSchema.safeParse({
      search: "",
      status: undefined,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.search).toBeUndefined();
  });

  it("rejects a malformed date filter", () => {
    expect(
      listLoanApplicationsSchema.safeParse({ fromDate: "19-08-2026" }).success,
    ).toBe(false);
  });
});

describe("Module 08 — credit assessment", () => {
  /**
   * The boolean-coercion trap, pinned.
   *
   * FormData carries strings, and `z.coerce.boolean()` applies
   * `Boolean("false")`, which is `true`. Coercing here would silently turn
   * every failed income check into a passed one — Scenario 9's exact failure.
   */
  it('parses "false" as false, not as truthy', () => {
    const parsed = recordCreditAssessmentSchema.safeParse({
      incomeVerified: "false",
      assessmentResult: "FAIL",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.incomeVerified).toBe("false");
  });

  it("requires an assessment result rather than defaulting to one", () => {
    const parsed = recordCreditAssessmentSchema.safeParse({
      incomeVerified: "true",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.assessmentResult?.[0]).toBe(
      "Assessment Result is required",
    );
  });

  it("rejects a CIBIL score outside the 300-900 band", () => {
    expect(
      recordCreditAssessmentSchema.safeParse({
        incomeVerified: "true",
        assessmentResult: "PASS",
        cibilScore: 1200,
      }).success,
    ).toBe(false);
  });

  it("treats a blank CIBIL score as absent", () => {
    const parsed = recordCreditAssessmentSchema.safeParse({
      incomeVerified: "true",
      assessmentResult: "PASS",
      cibilScore: "",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.cibilScore).toBeUndefined();
  });
});

describe("Module 08 — sanction", () => {
  it("requires a decline reason", () => {
    const parsed = declineSanctionSchema.safeParse({
      declineReason: "   ",
      expectedVersion: "2026-08-20T00:00:00.000Z",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.declineReason?.[0]).toBe(
      "Decline Reason is required",
    );
  });

  it("accepts a decline with a reason", () => {
    expect(
      declineSanctionSchema.safeParse({
        declineReason: "Found cheaper credit",
        expectedVersion: "2026-08-20T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  /**
   * Pins Rule 13 at the validation layer too: a customer's decline lands on
   * the unified REJECTED, so no surface may filter or set CUSTOMER_REJECTED.
   */
  it("does not admit CUSTOMER_REJECTED as an application status", () => {
    expect(applicationStatusSchema.safeParse("CUSTOMER_REJECTED").success).toBe(
      false,
    );
  });

  it("admits the three Module 08 statuses", () => {
    for (const status of [
      "SANCTIONED",
      "CUSTOMER_ACCEPTED",
      "AGREEMENT_SIGNED",
    ]) {
      expect(applicationStatusSchema.safeParse(status).success).toBe(true);
    }
  });
});
