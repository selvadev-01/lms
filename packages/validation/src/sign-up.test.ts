import { describe, expect, it } from "vitest";

import { signUpSchema } from "./index";

/**
 * Public organization signup.
 *
 * The schema is assembled from primitives the sign-in and password flows
 * already use, so these tests are about the wiring rather than about restating
 * the rules: that each field reaches the primitive it should, and that
 * `confirmPassword` — the one rule that exists only here — reports against the
 * field a user would actually correct.
 */

const VALID = {
  orgName: "Kestrel Finance",
  orgCode: "KESTREL",
  adminName: "Asha R",
  adminMobile: "9876543210",
  password: "Falcon9Ridge2026",
  confirmPassword: "Falcon9Ridge2026",
};

/** The field paths a failed parse blamed. */
function errorPaths(input: unknown): string[] {
  const result = signUpSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join("."));
}

describe("signUpSchema", () => {
  it("accepts a complete, valid signup", () => {
    expect(signUpSchema.safeParse(VALID).success).toBe(true);
  });

  it("trims the text fields rather than treating spaces as content", () => {
    const result = signUpSchema.safeParse({
      ...VALID,
      orgName: "  Kestrel Finance  ",
      adminName: "  Asha R  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orgName).toBe("Kestrel Finance");
      expect(result.data.adminName).toBe("Asha R");
    }
  });

  describe("required fields", () => {
    it.each([
      ["orgName", "Organization Name is required"],
      ["orgCode", "Organization Code is required"],
      ["adminName", "Your Name is required"],
      ["adminMobile", "Mobile Number is required"],
    ])("names %s when it is blank", (field, message) => {
      const result = signUpSchema.safeParse({ ...VALID, [field]: "   " });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message)).toContain(message);
      }
    });
  });

  describe("organization code", () => {
    it("rejects characters a tenant identifier may not contain", () => {
      expect(errorPaths({ ...VALID, orgCode: "kestrel finance" })).toContain(
        "orgCode",
      );
      expect(errorPaths({ ...VALID, orgCode: "kestrel!" })).toContain(
        "orgCode",
      );
    });

    it("accepts letters, digits, hyphens and underscores in either case", () => {
      for (const code of ["KESTREL", "kestrel", "kes-trel_1"]) {
        expect(
          signUpSchema.safeParse({ ...VALID, orgCode: code }).success,
        ).toBe(true);
      }
    });
  });

  describe("mobile number", () => {
    it("rejects a number that is not a 10-digit Indian mobile", () => {
      for (const mobile of ["1234567890", "98765", "98765432101"]) {
        expect(errorPaths({ ...VALID, adminMobile: mobile })).toContain(
          "adminMobile",
        );
      }
    });
  });

  describe("password", () => {
    it("applies the full creation policy, unlike sign-in", () => {
      // Sign-in checks presence only; this is a password being created, which
      // is exactly where the policy belongs.
      const result = signUpSchema.safeParse({
        ...VALID,
        password: "short",
        confirmPassword: "short",
      });

      expect(result.success).toBe(false);
      expect(
        errorPaths({ ...VALID, password: "short", confirmPassword: "short" }),
      ).toContain("password");
    });
  });

  describe("confirmPassword", () => {
    it("reports a mismatch against the field the user would correct", () => {
      const paths = errorPaths({
        ...VALID,
        confirmPassword: "Falcon9Ridge2027",
      });

      // Not `password` — the user's first entry is the one they meant.
      expect(paths).toContain("confirmPassword");
      expect(paths).not.toContain("password");
    });

    it("carries a message a person can act on", () => {
      const result = signUpSchema.safeParse({
        ...VALID,
        confirmPassword: "Falcon9Ridge2027",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message)).toContain(
          "Passwords do not match",
        );
      }
    });

    it("requires it to be filled in at all", () => {
      expect(errorPaths({ ...VALID, confirmPassword: "" })).toContain(
        "confirmPassword",
      );
    });
  });
});
