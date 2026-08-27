import { describe, expect, it } from "vitest";

import {
  buildPasswordPolicySchema,
  containsIdentifier,
  countCharacterClasses,
  evaluatePassword,
  identifierFragments,
  isCommonPassword,
  passwordPolicySchema,
  PASSWORD_CONTAINS_IDENTIFIER,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_NOT_COMPLEX,
  PASSWORD_TOO_COMMON,
  PASSWORD_TOO_LONG,
  PASSWORD_TOO_SHORT,
} from "./password-policy";

/** Collects the messages a schema rejects a password with. */
function messagesFor(
  password: string,
  identifiers: readonly string[] = [],
): string[] {
  const result = buildPasswordPolicySchema({ identifiers }).safeParse(password);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.message);
}

describe("countCharacterClasses", () => {
  it.each([
    ["alllowercase", 1],
    ["ALLUPPERCASE", 1],
    ["1234567890", 1],
    ["!@#$%^&*()", 1],
    ["lowerUPPER", 2],
    ["lower12345", 2],
    ["lowerUPPER1", 3],
    ["lowerUPPER1!", 4],
  ])("counts %s as %i classes", (password, expected) => {
    expect(countCharacterClasses(password)).toBe(expected);
  });

  /**
   * "Symbol" is anything not a letter or digit, so accented characters must not
   * be miscounted as symbols — a user typing a Latin-1 name would otherwise
   * satisfy the symbol class without meaning to.
   */
  it("does not treat accented letters as symbols", () => {
    expect(countCharacterClasses("café")).toBe(1);
  });
});

describe("passwordPolicySchema", () => {
  // Q-PWD-1
  it(`rejects a password shorter than ${PASSWORD_MIN_LENGTH} characters`, () => {
    expect(messagesFor("Ab1!efgh")).toContain(PASSWORD_TOO_SHORT);
  });

  it("accepts a password at exactly the minimum length", () => {
    const password = "Abcdef1!ghij".slice(0, PASSWORD_MIN_LENGTH);
    expect(password).toHaveLength(PASSWORD_MIN_LENGTH);
    expect(passwordPolicySchema.safeParse(password).success).toBe(true);
  });

  // Q-PWD-2
  it(`rejects a password longer than ${PASSWORD_MAX_LENGTH} characters`, () => {
    expect(messagesFor(`Aa1!${"x".repeat(PASSWORD_MAX_LENGTH)}`)).toContain(
      PASSWORD_TOO_LONG,
    );
  });

  // Q-PWD-3 — the 3-of-4 boundary in both directions.
  it("rejects a long password drawing on only two character classes", () => {
    expect(messagesFor("abcdefghijklmnop1")).toContain(PASSWORD_NOT_COMPLEX);
  });

  it("accepts exactly three character classes", () => {
    expect(passwordPolicySchema.safeParse("abcdefghij1A").success).toBe(true);
  });

  it("accepts all four character classes", () => {
    expect(passwordPolicySchema.safeParse("abcdefgh1A!x").success).toBe(true);
  });

  // Q-PWD-7
  it("rejects a blocklisted password", () => {
    expect(messagesFor("Password@123")).toContain(PASSWORD_TOO_COMMON);
  });

  it("matches the blocklist case-insensitively", () => {
    expect(isCommonPassword("PASSWORD@123")).toBe(true);
    expect(isCommonPassword("Welcome@123")).toBe(true);
  });

  it("reports every broken rule at once", () => {
    // Short, one class, and blocklisted.
    const messages = messagesFor("password");
    expect(messages).toContain(PASSWORD_TOO_SHORT);
    expect(messages).toContain(PASSWORD_TOO_COMMON);
  });

  it("never reports the same message twice", () => {
    const messages = messagesFor("password");
    expect(new Set(messages).size).toBe(messages.length);
  });
});

// Q-PWD-8
describe("identifier restrictions", () => {
  const IDENTIFIERS = ["Priya Sharma", "9876543210", "DEMO"];

  it("rejects a password containing the user's mobile number", () => {
    expect(messagesFor("Ab1!9876543210", IDENTIFIERS)).toContain(
      PASSWORD_CONTAINS_IDENTIFIER,
    );
  });

  it.each(["Priya@12345", "sharma@2024X"])(
    "rejects %s for containing a name token",
    (password) => {
      expect(messagesFor(password, IDENTIFIERS)).toContain(
        PASSWORD_CONTAINS_IDENTIFIER,
      );
    },
  );

  it("matches identifiers case-insensitively", () => {
    expect(containsIdentifier("xxPRIYAxx1A", IDENTIFIERS)).toBe(true);
  });

  /**
   * The identifier check is server-only: the browser validates the reset form
   * before it knows whose account is being reset.
   */
  it("is not applied when no identifiers are supplied", () => {
    expect(passwordPolicySchema.safeParse("Priya@123456").success).toBe(true);
  });

  /**
   * Fragments below the length floor are dropped, otherwise a short org code
   * would forbid a large share of all passwords for a baffling reason.
   */
  it("ignores identifier fragments shorter than four characters", () => {
    expect(identifierFragments(["Al", "AB", "9876543210"])).toEqual([
      "9876543210",
    ]);
    expect(containsIdentifier("Album@12345X", ["Al"])).toBe(false);
  });

  it("splits a name into independently matched tokens", () => {
    expect(identifierFragments(["Priya Sharma"]).sort()).toEqual([
      "priya",
      "sharma",
    ]);
  });

  it("tolerates a null-ish identifier list without matching everything", () => {
    expect(containsIdentifier("Abcdefgh1!xy", ["", "  "])).toBe(false);
  });
});

describe("evaluatePassword", () => {
  it("scores an empty password as zero and non-compliant", () => {
    const result = evaluatePassword("");
    expect(result.score).toBe(0);
    expect(result.satisfiesPolicy).toBe(false);
  });

  it("marks a compliant password as satisfying the policy", () => {
    const result = evaluatePassword("Abcdefgh1!xy");
    expect(result.satisfiesPolicy).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(2);
  });

  it("scores a long four-class password highest", () => {
    expect(evaluatePassword("Abcdefghij1!KLmn").score).toBe(4);
  });

  it("flags exactly which rules are unmet", () => {
    const rules = evaluatePassword("password").rules;
    expect(rules.find((rule) => rule.id === "length")?.satisfied).toBe(false);
    expect(rules.find((rule) => rule.id === "common")?.satisfied).toBe(false);
  });

  /**
   * The evaluator exists so the browser can render feedback without holding the
   * plaintext in component state — so its result must not embed the password.
   */
  it("returns no trace of the password itself", () => {
    const serialized = JSON.stringify(evaluatePassword("Sup3rSecret!value"));
    expect(serialized).not.toContain("Sup3rSecret");
  });
});
