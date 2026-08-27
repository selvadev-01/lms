import { describe, expect, it } from "vitest";

import {
  convertCustomerTypeSchema,
  createCustomerSchema,
  createGuarantorSchema,
  customerCodeSchema,
  deactivateGuarantorSchema,
  kycDocumentTypeSchema,
  listCustomersSchema,
  reviewGuarantorKycSchema,
  reviewKycSchema,
  updateCustomerSchema,
  updateGuarantorSchema,
  uploadDocumentSchema,
  verifyDocumentSchema,
  verifyGuarantorDocumentSchema,
  verifyMobileOtpSchema,
} from "./index";

/**
 * Module 04 form schemas.
 *
 * The same three concerns as `rbac.test.ts` apply — verbatim messages, absent
 * fields rejected rather than ignored — plus one specific to this module:
 *
 * The **scope fields** (`orgId`, `branchId`) are asserted to be rejected on every
 * write shape. That is Scenarios 30 and 31 tested at the schema layer. The API
 * also refuses them via `forbidNonWhitelisted`, so this is a second line rather
 * than the only one, but it is the line the web actions parse against — and a
 * schema that silently stripped `branchId` would let a form submit a branch the
 * server then ignores, which looks like success to the caller.
 */

const validCustomer = {
  fullName: "Anitha Raman",
  mobile: "9876543210",
  email: "",
  dateOfBirth: "",
  gender: "",
  addressLine1: "12 Gandhi Street",
  addressLine2: "",
  city: "Chennai",
  state: "Tamil Nadu",
  pincode: "600001",
  customerType: "KYC" as const,
};

describe("createCustomerSchema", () => {
  it("accepts a complete KYC customer", () => {
    const result = createCustomerSchema.safeParse(validCustomer);
    expect(result.success).toBe(true);
  });

  it("accepts a LOCAL customer with name, mobile and address", () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      customerType: "LOCAL",
    });
    expect(result.success).toBe(true);
  });

  // Scenario 3 — customer type required.
  it("rejects a missing customer type with its own message", () => {
    const { customerType: _omitted, ...withoutType } = validCustomer;
    const result = createCustomerSchema.safeParse(withoutType);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.customerType).toContain(
      "Customer Type is required",
    );
  });

  it("rejects an unknown customer type", () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      customerType: "WALKIN",
    });
    expect(result.success).toBe(false);
  });

  // Scenario 4 — mandatory LOCAL fields. Each asserted separately so a failure
  // names the field that actually broke.
  // `as const` so `field` is a union of the actual key names rather than
  // `string`, which cannot index the typed `fieldErrors` object.
  it.each([
    ["fullName", "Full Name is required"],
    ["mobile", "Mobile Number is required"],
    ["addressLine1", "Address is required"],
  ] as const)("rejects a LOCAL customer missing %s", (field, message) => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      customerType: "LOCAL",
      [field]: "",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors[field]).toContain(message);
  });

  // The same three are required for a KYC customer too — the source names them
  // for LOCAL specifically, but a customer with no name is not a record.
  it("rejects a KYC customer with no name", () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      fullName: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed mobile number", () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      mobile: "12345",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.mobile).toContain(
      "Enter a valid 10-digit mobile number",
    );
  });

  it("trims a mobile number typed with a stray space", () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      mobile: " 9876543210",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.mobile).toBe("9876543210");
  });

  // Scenarios 30, 31 — the client cannot choose its own scope.
  it.each(["orgId", "branchId"])("rejects a client-supplied %s", (field) => {
    const result = createCustomerSchema.strict().safeParse({
      ...validCustomer,
      [field]: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(false);
  });

  it("normalizes an untouched optional field to undefined", () => {
    const result = createCustomerSchema.safeParse(validCustomer);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // `""` from an untouched input and `null` from a field the form does not
    // render must both mean absence, never a literal empty string in the row.
    expect(result.data.email).toBeUndefined();
    expect(result.data.gender).toBeUndefined();
  });

  it("rejects a date of birth in the future", () => {
    const nextYear = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      dateOfBirth: nextYear,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.dateOfBirth).toContain(
      "Date of birth cannot be in the future",
    );
  });

  it("accepts a past date of birth", () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      dateOfBirth: "1990-04-17",
    });
    expect(result.success).toBe(true);
  });

  // Scenario 5 — the duplicate override is explicit and opt-in.
  it("accepts the force flag for a known duplicate", () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      force: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.force).toBe(true);
  });

  it("defaults force to undefined rather than true", () => {
    const result = createCustomerSchema.safeParse(validCustomer);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.force).toBeUndefined();
  });
});

describe("updateCustomerSchema", () => {
  const validUpdate = {
    ...validCustomer,
    customerType: undefined,
    expectedVersion: "2026-08-19T08:00:00.000Z",
  };

  it("accepts a profile edit carrying its expected version", () => {
    const result = updateCustomerSchema.safeParse(validUpdate);
    expect(result.success).toBe(true);
  });

  // Q-CUST-22 — a write with no version handle cannot detect a lost update.
  it("rejects an edit with no expected version", () => {
    const { expectedVersion: _omitted, ...withoutVersion } = validUpdate;
    const result = updateCustomerSchema.safeParse(withoutVersion);
    expect(result.success).toBe(false);
  });

  // One field, one endpoint: each of these has its own route and permission.
  it.each(["status", "customerType", "customerCode"])(
    "rejects %s on a profile edit",
    (field) => {
      const result = updateCustomerSchema
        .strict()
        .safeParse({ ...validUpdate, [field]: "ACTIVE" });
      expect(result.success).toBe(false);
    },
  );
});

describe("listCustomersSchema", () => {
  it("accepts an empty query", () => {
    expect(listCustomersSchema.safeParse({}).success).toBe(true);
  });

  it.each(["Anitha", "CUST001", "9876543210"])(
    "accepts %s as a single search term",
    (search) => {
      // Scenarios 18-20 are one box, not three: the service decides which column
      // a term addresses.
      const result = listCustomersSchema.safeParse({ search });
      expect(result.success).toBe(true);
    },
  );

  it("rejects an unknown status filter", () => {
    const result = listCustomersSchema.safeParse({ status: "ARCHIVED" });
    expect(result.success).toBe(false);
  });
});

describe("reviewKycSchema", () => {
  const version = "2026-08-19T08:00:00.000Z";

  // Scenario 9 — approval needs no justification.
  it("accepts an approval with no reason", () => {
    const result = reviewKycSchema.safeParse({
      decision: "APPROVE",
      expectedVersion: version,
    });
    expect(result.success).toBe(true);
  });

  // Scenario 8 — a revision without a stated reason gives the branch nothing to
  // act on, which defeats the revision loop.
  it.each(["REQUEST_REVISION", "REJECT"])(
    "rejects %s with no reason",
    (decision) => {
      const result = reviewKycSchema.safeParse({
        decision,
        expectedVersion: version,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.flatten().fieldErrors.reason).toContain(
        "A reason is required",
      );
    },
  );

  it("rejects a blank-whitespace reason on a revision", () => {
    const result = reviewKycSchema.safeParse({
      decision: "REQUEST_REVISION",
      reason: "    ",
      expectedVersion: version,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a revision carrying a reason", () => {
    const result = reviewKycSchema.safeParse({
      decision: "REQUEST_REVISION",
      reason: "Address proof is illegible.",
      expectedVersion: version,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown decision", () => {
    const result = reviewKycSchema.safeParse({
      decision: "MAYBE",
      expectedVersion: version,
    });
    expect(result.success).toBe(false);
  });
});

describe("kycDocumentTypeSchema", () => {
  it.each(["ID", "ADDRESS", "PHOTO"])("accepts %s", (value) => {
    expect(kycDocumentTypeSchema.safeParse(value).success).toBe(true);
  });

  // The story warns that loan documents must not be folded into the KYC
  // category; a shared enum is how that would happen by accident.
  it.each(["INCOME", "COLLATERAL", "AGREEMENT"])("rejects %s", (value) => {
    expect(kycDocumentTypeSchema.safeParse(value).success).toBe(false);
  });
});

describe("uploadDocumentSchema", () => {
  it("accepts an upload with no document number", () => {
    // Q-CUST-17 — a photo has no number, and an unreadable ID number should
    // still reach a reviewer.
    const result = uploadDocumentSchema.safeParse({ documentType: "PHOTO" });
    expect(result.success).toBe(true);
  });

  it("requires a document type", () => {
    const result = uploadDocumentSchema.safeParse({ documentNumber: "X123" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.documentType).toContain(
      "Document Type is required",
    );
  });
});

describe("verifyDocumentSchema", () => {
  it("accepts a verification with no reason", () => {
    expect(verifyDocumentSchema.safeParse({ status: "VERIFIED" }).success).toBe(
      true,
    );
  });

  it("rejects a rejection with no reason", () => {
    const result = verifyDocumentSchema.safeParse({ status: "REJECTED" });
    expect(result.success).toBe(false);
  });

  it("rejects PENDING as a review decision", () => {
    // A reviewer moves a document forward or back; they cannot decide "pending".
    expect(verifyDocumentSchema.safeParse({ status: "PENDING" }).success).toBe(
      false,
    );
  });
});

describe("convertCustomerTypeSchema", () => {
  it("accepts a conversion carrying its expected version", () => {
    const result = convertCustomerTypeSchema.safeParse({
      expectedVersion: "2026-08-19T08:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  // There is deliberately no target type: LOCAL → KYC is the only direction, so
  // an approved customer's verification cannot be discarded by a type change.
  it("rejects a caller-supplied target type", () => {
    const result = convertCustomerTypeSchema.strict().safeParse({
      expectedVersion: "2026-08-19T08:00:00.000Z",
      customerType: "LOCAL",
    });
    expect(result.success).toBe(false);
  });
});

describe("createGuarantorSchema", () => {
  it("accepts a guarantor with the three mandatory fields", () => {
    const result = createGuarantorSchema.safeParse({
      fullName: "Ravi Shankar",
      mobile: "9876543211",
      address: "12 Nehru Street, Coimbatore",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a guarantor with a malformed mobile", () => {
    const result = createGuarantorSchema.safeParse({
      fullName: "Ravi Shankar",
      mobile: "abc",
      address: "12 Nehru Street, Coimbatore",
    });
    expect(result.success).toBe(false);
  });

  // Module 05 Rule 13 and the Scenario 9 outline both name "Address is
  // required" for a guarantor, unlike the customer's optional address.
  it("rejects a guarantor without an address", () => {
    const result = createGuarantorSchema.safeParse({
      fullName: "Ravi Shankar",
      mobile: "9876543211",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.address).toContain(
        "Address is required",
      );
    }
  });

  it("rejects an address of only whitespace", () => {
    const result = createGuarantorSchema.safeParse({
      fullName: "Ravi Shankar",
      mobile: "9876543211",
      address: "   ",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateGuarantorSchema", () => {
  // Scenario 46 — a write without the concurrency token could overwrite a
  // change the caller never saw.
  it("rejects an update without the concurrency token", () => {
    const result = updateGuarantorSchema.safeParse({
      fullName: "Ravi Shankar",
      mobile: "9876543211",
      address: "12 Nehru Street, Coimbatore",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.expectedVersion).toBeDefined();
    }
  });

  it("accepts an update carrying the concurrency token", () => {
    const result = updateGuarantorSchema.safeParse({
      fullName: "Ravi Shankar",
      mobile: "9876543211",
      address: "12 Nehru Street, Coimbatore",
      expectedVersion: "2026-08-19T08:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("deactivateGuarantorSchema", () => {
  // Deactivation is what happens *instead of* a blocked delete, so the reason
  // is the only record of why the non-destructive path was taken.
  it("rejects deactivation without a reason", () => {
    const result = deactivateGuarantorSchema.safeParse({
      expectedVersion: "2026-08-19T08:00:00.000Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.reason).toContain(
        "A reason is required",
      );
    }
  });

  it("rejects a reason of only whitespace", () => {
    const result = deactivateGuarantorSchema.safeParse({
      reason: "   ",
      expectedVersion: "2026-08-19T08:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a stated reason", () => {
    const result = deactivateGuarantorSchema.safeParse({
      reason: "Guarantor withdrew from the arrangement",
      expectedVersion: "2026-08-19T08:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("reviewGuarantorKycSchema", () => {
  it("accepts an approval with no reason", () => {
    const result = reviewGuarantorKycSchema.safeParse({
      decision: "APPROVE",
      expectedVersion: "2026-08-19T08:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  // Scenario 23 — the reason is what the resubmission acts on, so a revision
  // request without one gives the branch nothing to fix.
  it("rejects a revision request with no reason", () => {
    const result = reviewGuarantorKycSchema.safeParse({
      decision: "REQUEST_REVISION",
      expectedVersion: "2026-08-19T08:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a rejection with no reason", () => {
    const result = reviewGuarantorKycSchema.safeParse({
      decision: "REJECT",
      expectedVersion: "2026-08-19T08:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("verifyGuarantorDocumentSchema", () => {
  it("accepts a verification with no reason", () => {
    expect(
      verifyGuarantorDocumentSchema.safeParse({ status: "VERIFIED" }).success,
    ).toBe(true);
  });

  it("rejects a document rejection with no reason", () => {
    expect(
      verifyGuarantorDocumentSchema.safeParse({ status: "REJECTED" }).success,
    ).toBe(false);
  });
});

describe("verifyMobileOtpSchema", () => {
  it("accepts a numeric code", () => {
    expect(verifyMobileOtpSchema.safeParse({ otp: "123456" }).success).toBe(
      true,
    );
  });

  it("trims surrounding whitespace from a pasted code", () => {
    const result = verifyMobileOtpSchema.safeParse({ otp: " 123456 " });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.otp).toBe("123456");
  });

  it.each(["", "12ab56", "abcdef"])("rejects %s", (otp) => {
    expect(verifyMobileOtpSchema.safeParse({ otp }).success).toBe(false);
  });

  // The configured OTP length is not asserted client-side: the server mints the
  // code and knows its own length, and a client rule would leak that config.
  it("accepts a code of a non-standard length", () => {
    expect(verifyMobileOtpSchema.safeParse({ otp: "12345678" }).success).toBe(
      true,
    );
  });
});

describe("customerCodeSchema", () => {
  it.each(["CUST001", "cust-001", "CUST_001"])("accepts %s", (code) => {
    expect(customerCodeSchema.safeParse(code).success).toBe(true);
  });

  // It appears in URLs, search queries and exports, so it stays to what survives
  // all three unescaped.
  it.each(["CUST 001", "CUST/001", "CUST#001", ""])("rejects %s", (code) => {
    expect(customerCodeSchema.safeParse(code).success).toBe(false);
  });
});
