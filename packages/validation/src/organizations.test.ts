import { describe, expect, it } from "vitest";

import {
  createBranchSchema,
  setStatusSchema,
  updateBranchSchema,
  updateOrganizationSchema,
} from "./index";

/**
 * Organization and branch form schemas.
 *
 * The load-bearing cases here are the optional fields. `FormData.get()` returns
 * `null` for an input the form never rendered and `""` for one the user left
 * alone, and both mean "no value" — an early version accepted only `""` and so
 * rejected every branch deactivation, because the status form carries no reason
 * input at all. These tests exist so that cannot come back silently.
 */

const validBranch = {
  code: "BR004",
  name: "Madurai Branch",
  addressLine1: "8 West Veli Street",
  city: "Madurai",
  state: "Tamil Nadu",
  pincode: "625001",
  status: "ACTIVE",
};

describe("setStatusSchema", () => {
  it("accepts a null reason, as an unrendered field submits", () => {
    const result = setStatusSchema.safeParse({
      status: "INACTIVE",
      reason: null,
    });

    expect(result.success).toBe(true);
  });

  it("accepts an empty reason, as an untouched input submits", () => {
    const result = setStatusSchema.safeParse({
      status: "INACTIVE",
      reason: "",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reason).toBeUndefined();
  });

  it("accepts an omitted reason", () => {
    expect(setStatusSchema.safeParse({ status: "ACTIVE" }).success).toBe(true);
  });

  it("keeps a supplied reason", () => {
    const result = setStatusSchema.safeParse({
      status: "INACTIVE",
      reason: "Premises closed",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reason).toBe("Premises closed");
  });

  it("rejects a status outside the lifecycle", () => {
    expect(setStatusSchema.safeParse({ status: "ARCHIVED" }).success).toBe(
      false,
    );
  });

  it("rejects a reason beyond the column width", () => {
    const result = setStatusSchema.safeParse({
      status: "INACTIVE",
      reason: "x".repeat(501),
    });

    expect(result.success).toBe(false);
  });
});

describe("createBranchSchema", () => {
  it("accepts a branch with only the mandatory fields", () => {
    expect(createBranchSchema.safeParse(validBranch).success).toBe(true);
  });

  it("accepts null for every optional field", () => {
    const result = createBranchSchema.safeParse({
      ...validBranch,
      addressLine2: null,
      phone: null,
      contactEmail: null,
    });

    expect(result.success).toBe(true);
  });

  it("accepts empty strings for every optional field", () => {
    const result = createBranchSchema.safeParse({
      ...validBranch,
      addressLine2: "",
      phone: "",
      contactEmail: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Normalised to undefined so a Prisma write skips the column rather than
      // storing "" where the schema means null.
      expect(result.data.addressLine2).toBeUndefined();
      expect(result.data.contactEmail).toBeUndefined();
    }
  });

  it("still validates a contact email that was actually supplied", () => {
    const result = createBranchSchema.safeParse({
      ...validBranch,
      contactEmail: "not-an-email",
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["code", "Branch Code is required"],
    ["name", "Branch Name is required"],
    ["city", "City is required"],
    ["state", "State is required"],
  ])("requires %s", (field) => {
    const result = createBranchSchema.safeParse({
      ...validBranch,
      [field]: "",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a pincode that is not six digits", () => {
    expect(
      createBranchSchema.safeParse({ ...validBranch, pincode: "62001" })
        .success,
    ).toBe(false);
  });

  it("rejects a branch code carrying characters a receipt number cannot", () => {
    expect(
      createBranchSchema.safeParse({ ...validBranch, code: "BR 004/A" })
        .success,
    ).toBe(false);
  });
});

describe("updateBranchSchema", () => {
  it("does not accept a code, which is fixed after creation", () => {
    const result = updateBranchSchema.safeParse({
      name: "Renamed",
      addressLine1: "8 West Veli Street",
      city: "Madurai",
      state: "Tamil Nadu",
      pincode: "625001",
      code: "BR999",
    });

    // Zod strips unknown keys rather than failing; the API's
    // `forbidNonWhitelisted` is what turns the attempt into a 400. What matters
    // here is that the code never survives into the parsed payload.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("code");
    }
  });
});

describe("updateOrganizationSchema", () => {
  it("accepts null and empty optional fields", () => {
    const result = updateOrganizationSchema.safeParse({
      name: "Demo Finance Ltd",
      legalName: null,
      timezone: "",
    });

    expect(result.success).toBe(true);
  });

  it("requires a name", () => {
    expect(updateOrganizationSchema.safeParse({ name: "" }).success).toBe(
      false,
    );
  });
});
