import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import {
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  PASSWORD_NOT_COMPLEX,
  PASSWORD_TOO_COMMON,
  PASSWORD_TOO_SHORT,
} from "./index";

/** Collects error messages per field for any of the recovery schemas. */
function errorsFor(schema: ZodTypeAny, input: Record<string, unknown>) {
  const result = schema.safeParse(input);
  if (result.success) return null;
  return result.error.flatten().fieldErrors as Record<string, string[]>;
}

const VALID_REQUEST = { orgCode: "DEMO", mobile: "9000000001" };

describe("forgotPasswordSchema", () => {
  it("accepts a valid recovery request", () => {
    expect(forgotPasswordSchema.safeParse(VALID_REQUEST).success).toBe(true);
  });

  // Scenario 4
  it("requires the mobile number", () => {
    expect(
      errorsFor(forgotPasswordSchema, { ...VALID_REQUEST, mobile: "" })?.mobile,
    ).toContain("Mobile Number is required");
  });

  // Scenario 6: whitespace-only is treated as missing, not as a format error.
  it("treats a whitespace-only mobile number as missing", () => {
    expect(
      errorsFor(forgotPasswordSchema, { ...VALID_REQUEST, mobile: "   " })
        ?.mobile,
    ).toContain("Mobile Number is required");
  });

  // Scenario 5
  it("rejects a malformed mobile number with the format message", () => {
    const errors = errorsFor(forgotPasswordSchema, {
      ...VALID_REQUEST,
      mobile: "12345",
    })?.mobile;
    expect(errors).toContain("Enter a valid 10-digit mobile number");
    expect(errors).not.toContain("Mobile Number is required");
  });

  /**
   * Rule 4: the recovery identifier must normalize exactly as sign-in does, so
   * two spellings of one number cannot resolve to two identities.
   */
  it("trims surrounding whitespace rather than creating a separate identity", () => {
    const result = forgotPasswordSchema.safeParse({
      ...VALID_REQUEST,
      mobile: " 9000000001 ",
    });
    expect(result.success && result.data.mobile).toBe("9000000001");
  });

  // Rule 5: the screen must not ask for the password it exists to recover.
  it("strips any password submitted alongside the recovery request", () => {
    const result = forgotPasswordSchema.safeParse({
      ...VALID_REQUEST,
      password: "Password@123",
    });
    expect(result.success && "password" in result.data).toBe(false);
  });
});

describe("verifyOtpSchema", () => {
  const VALID_OTP = { ...VALID_REQUEST, otp: "123456" };

  it("accepts a valid 6-digit code", () => {
    expect(verifyOtpSchema.safeParse(VALID_OTP).success).toBe(true);
  });

  it("requires the verification code", () => {
    expect(
      errorsFor(verifyOtpSchema, { ...VALID_OTP, otp: "" })?.otp,
    ).toContain("Verification Code is required");
  });

  it("treats a whitespace-only code as missing", () => {
    expect(
      errorsFor(verifyOtpSchema, { ...VALID_OTP, otp: "  " })?.otp,
    ).toContain("Verification Code is required");
  });

  it.each(["12345", "1234567", "12345a", "abcdef"])(
    "rejects %s as a verification code",
    (otp) => {
      expect(errorsFor(verifyOtpSchema, { ...VALID_OTP, otp })?.otp).toContain(
        "Enter the 6-digit verification code",
      );
    },
  );

  it("still enforces the mobile-number rules inherited from step 1", () => {
    expect(
      errorsFor(verifyOtpSchema, { ...VALID_OTP, mobile: "" })?.mobile,
    ).toContain("Mobile Number is required");
  });
});

describe("resetPasswordSchema", () => {
  const VALID_RESET = {
    password: "NewPassword@123",
    confirmPassword: "NewPassword@123",
  };

  it("accepts a matching pair that meets the policy", () => {
    expect(resetPasswordSchema.safeParse(VALID_RESET).success).toBe(true);
  });

  /**
   * Unlike sign-in, the full policy DOES apply here: this is password creation,
   * which is exactly where passwordPolicySchema is meant to be enforced.
   */
  it("applies the password length policy", () => {
    expect(
      errorsFor(resetPasswordSchema, {
        password: "short",
        confirmPassword: "short",
      })?.password,
    ).toContain(PASSWORD_TOO_SHORT);
  });

  /** Q-PWD-3: 3 of 4 character classes. */
  it("rejects a long password that uses too few character classes", () => {
    const password = "abcdefghijklmnop";
    expect(
      errorsFor(resetPasswordSchema, { password, confirmPassword: password })
        ?.password,
    ).toContain(PASSWORD_NOT_COMPLEX);
  });

  /** Q-PWD-7: the blocklist applies even to a policy-compliant shape. */
  it("rejects a commonly used password", () => {
    const password = "Password@123";
    expect(
      errorsFor(resetPasswordSchema, { password, confirmPassword: password })
        ?.password,
    ).toContain(PASSWORD_TOO_COMMON);
  });

  /** Bounded so a caller cannot force arbitrarily expensive argon2 work. */
  it("rejects an over-long password", () => {
    const password = "a".repeat(201);
    expect(
      errorsFor(resetPasswordSchema, { password, confirmPassword: password })
        ?.password,
    ).toContain("Password must be at most 200 characters");
  });

  it("reports a mismatch against the confirm field", () => {
    expect(
      errorsFor(resetPasswordSchema, {
        ...VALID_RESET,
        confirmPassword: "Different@123",
      })?.confirmPassword,
    ).toContain("Passwords do not match");
  });

  it("requires the confirmation field", () => {
    expect(
      errorsFor(resetPasswordSchema, { ...VALID_RESET, confirmPassword: "" })
        ?.confirmPassword,
    ).toContain("Confirm Password is required");
  });

  /**
   * Scenario 26 / rule 19: identity comes from the single-use reset
   * authorization the server holds, never from a client-supplied field.
   */
  it("carries no identity fields", () => {
    const result = resetPasswordSchema.safeParse({
      ...VALID_RESET,
      mobile: "9000000001",
      orgCode: "DEMO",
      userId: "00000000-0000-0000-0000-000000000000",
    });
    expect(result.success && Object.keys(result.data).sort()).toEqual([
      "confirmPassword",
      "password",
    ]);
  });
});

describe("changePasswordSchema", () => {
  const CURRENT = "Kestrel7Vault";
  const NEXT = "Marigold4Ledger";
  const VALID_CHANGE = {
    currentPassword: CURRENT,
    newPassword: NEXT,
    confirmNewPassword: NEXT,
  };

  it("accepts a compliant change", () => {
    expect(changePasswordSchema.safeParse(VALID_CHANGE).success).toBe(true);
  });

  /** Change Password Scenarios 4, 5 and 6 — the mandatory-field outline. */
  it("requires all three fields", () => {
    const errors = errorsFor(changePasswordSchema, {
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    });
    expect(errors?.currentPassword).toContain("Current Password is required");
    expect(errors?.newPassword).toContain("New Password is required");
    expect(errors?.confirmNewPassword).toContain(
      "Confirm New Password is required",
    );
  });

  /**
   * The current password is checked for presence only, never against the
   * policy: an account whose password predates a policy tightening must still
   * be able to use this screen to fix it.
   */
  it("accepts a non-compliant current password", () => {
    expect(
      changePasswordSchema.safeParse({ ...VALID_CHANGE, currentPassword: "x" })
        .success,
    ).toBe(true);
  });

  /** Scenario 11. */
  it("reports a mismatch against the confirm field", () => {
    expect(
      errorsFor(changePasswordSchema, {
        ...VALID_CHANGE,
        confirmNewPassword: "Different@123",
      })?.confirmNewPassword,
    ).toContain("Passwords do not match");
  });

  /** Scenario 15 — the server rejects this too, as password reuse. */
  it("rejects a new password identical to the current one", () => {
    expect(
      errorsFor(changePasswordSchema, {
        currentPassword: CURRENT,
        newPassword: CURRENT,
        confirmNewPassword: CURRENT,
      })?.newPassword,
    ).toContain(
      "Your new password must be different from your current password",
    );
  });

  /** Scenarios 12 and 13 — the new password carries the full policy. */
  it("applies the password policy to the new password", () => {
    const weak = "abcdefghijklmnop";
    expect(
      errorsFor(changePasswordSchema, {
        currentPassword: CURRENT,
        newPassword: weak,
        confirmNewPassword: weak,
      })?.newPassword,
    ).toContain(PASSWORD_NOT_COMPLEX);
  });

  /** Scenario 29: identity comes from the session, never from the body. */
  it("carries no identity fields", () => {
    const result = changePasswordSchema.safeParse({
      ...VALID_CHANGE,
      userId: "00000000-0000-0000-0000-000000000000",
      orgCode: "DEMO",
    });
    expect(result.success && Object.keys(result.data).sort()).toEqual([
      "confirmNewPassword",
      "currentPassword",
      "newPassword",
    ]);
  });
});
