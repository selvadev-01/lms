import { describe, expect, it } from "vitest";

import { signInSchema } from "./index";

/** Collects the first error message per field. */
function errorsFor(input: Record<string, unknown>) {
  const result = signInSchema.safeParse(input);
  if (result.success) return null;
  return result.error.flatten().fieldErrors;
}

const VALID = {
  orgCode: "DEMO",
  mobile: "9000000001",
  password: "Password@123",
};

describe("signInSchema", () => {
  it("accepts valid credentials", () => {
    expect(signInSchema.safeParse(VALID).success).toBe(true);
  });

  // Scenario 25
  it("requires the mobile number", () => {
    expect(errorsFor({ ...VALID, mobile: "" })?.mobile).toContain(
      "Mobile Number is required",
    );
  });

  // Scenario 26
  it("requires the password", () => {
    expect(errorsFor({ ...VALID, password: "" })?.password).toContain(
      "Password is required",
    );
  });

  // Scenario 27: whitespace-only is treated as missing, not as a format error.
  it("treats a whitespace-only mobile number as missing", () => {
    expect(errorsFor({ ...VALID, mobile: "   " })?.mobile).toContain(
      "Mobile Number is required",
    );
  });

  // Scenario 28
  it("rejects a malformed mobile number with the format message", () => {
    const errors = errorsFor({ ...VALID, mobile: "12345" })?.mobile;
    expect(errors).toContain("Enter a valid 10-digit mobile number");
    expect(errors).not.toContain("Mobile Number is required");
  });

  it("rejects an Indian mobile not starting 6-9", () => {
    expect(errorsFor({ ...VALID, mobile: "1234567890" })?.mobile).toBeTruthy();
  });

  it("requires the organization code", () => {
    expect(errorsFor({ ...VALID, orgCode: "" })?.orgCode).toContain(
      "Organization Code is required",
    );
  });

  it("trims surrounding whitespace rather than creating a separate identity", () => {
    const result = signInSchema.safeParse({ ...VALID, mobile: " 9000000001 " });
    expect(result.success && result.data.mobile).toBe("9000000001");
  });

  /**
   * The password rule at sign-in is presence-only. Applying the length policy
   * here would disclose it to an attacker (Scenario 22) and would lock out
   * users whose password predates a policy change.
   */
  it("does not apply the password length policy at sign-in", () => {
    expect(signInSchema.safeParse({ ...VALID, password: "x" }).success).toBe(
      true,
    );
  });
});
