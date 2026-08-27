import { z } from "zod";

/**
 * The LMS password policy, shared verbatim by the browser and the API so a rule
 * is defined once and enforced on both sides of the wire.
 *
 * Thresholds resolve the open questions recorded in docs/OPEN-QUESTIONS.md:
 *
 * - Q-PWD-1/2 — 12 to 200 characters.
 * - Q-PWD-3   — at least 3 of the 4 character classes.
 * - Q-PWD-7   — a small embedded blocklist of common passwords.
 * - Q-PWD-8   — the password may not contain an account identifier.
 *
 * These are applied defaults, not source-defined requirements: the uploaded LMS
 * diagrams define no password policy at all. The API mirrors every value as an
 * `AUTH_PASSWORD_*` environment variable so the deployed thresholds can move
 * without a code change (Sign-In rules 20 and 49).
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/** How many of the four character classes a password must draw from (Q-PWD-3). */
export const PASSWORD_REQUIRED_CLASSES = 3;

/** Default number of previous passwords that may not be reused (Q-PWD-4). */
export const PASSWORD_HISTORY_DEPTH = 5;

export const PASSWORD_TOO_SHORT = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
export const PASSWORD_TOO_LONG = `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
export const PASSWORD_NOT_COMPLEX =
  "Password must include at least 3 of: uppercase, lowercase, number, symbol";
export const PASSWORD_TOO_COMMON =
  "This password is too common. Choose a less predictable one";
export const PASSWORD_CONTAINS_IDENTIFIER =
  "Password must not contain your name, mobile number or organization code";

/**
 * The four character classes.
 *
 * Defined with Unicode property escapes rather than ASCII ranges so that a
 * password containing accented or non-Latin letters is counted as letters, not
 * as symbols. Classing "café" as containing a symbol would let a user satisfy
 * the complexity rule without any of the variety it is meant to require.
 *
 * "Symbol" is correspondingly anything that is neither a letter nor a number,
 * rather than an explicit punctuation list, so no printable character a user
 * can type is silently uncounted.
 */
const CHARACTER_CLASSES = [
  /\p{Ll}/u,
  /\p{Lu}|\p{Lt}/u,
  /\p{Nd}/u,
  /[^\p{L}\p{N}]/u,
] as const;

export function countCharacterClasses(password: string): number {
  return CHARACTER_CLASSES.filter((pattern) => pattern.test(password)).length;
}

/**
 * Passwords rejected outright regardless of whether they satisfy the length and
 * complexity rules (Q-PWD-7).
 *
 * Deliberately small and embedded rather than a downloaded corpus or a Have I
 * Been Pwned lookup: a network call on the reset path would make password
 * validation fail when an unrelated third party is down, and would leak a
 * prefix of the user's password hash to that third party. This list covers the
 * passwords a credential-stuffing list would try first; it is not a substitute
 * for the length and complexity rules, which do the real work.
 *
 * Entries are compared case-insensitively, so they are stored lowercase.
 */
const COMMON_PASSWORDS = new Set([
  "123456",
  "123456789",
  "12345678",
  "1234567890",
  "111111",
  "123123",
  "password",
  "password1",
  "password123",
  "password@123",
  "passw0rd",
  "p@ssw0rd",
  "p@ssword123",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "abc123",
  "abcd1234",
  "abcd@1234",
  "iloveyou",
  "admin",
  "admin123",
  "admin@123",
  "administrator",
  "welcome",
  "welcome1",
  "welcome@123",
  "letmein",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "master",
  "shadow",
  "superman",
  "trustno1",
  "whatever",
  "starwars",
  "computer",
  "internet",
  "samsung",
  "google",
  "facebook",
  "changeme",
  "changeme123",
  "secret",
  "default",
  "test1234",
  "test@123",
  "user@123",
  "login123",
  "india@123",
  "bharat@123",
  "krishna",
  "ganesh",
  "ganesha",
  "shivam",
  "omnamahshivaya",
  "jaishreeram",
  "radhakrishna",
  "saibaba",
  "mumbai",
  "chennai",
  "kolkata",
  "hyderabad",
  "bangalore",
  "delhi123",
  "india123",
  "lms@123",
  "lms1234",
  "loan@123",
  "finance123",
  "9876543210",
  "1234567890a",
  "qwerty@123",
  "asdf1234",
  "zxcvbnm",
  "1q2w3e4r",
  "1qaz2wsx",
  "q1w2e3r4",
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

/**
 * Identifier fragments shorter than this are ignored when checking whether the
 * password embeds an account identifier.
 *
 * Without a floor, a user named "Al" or an org coded "AB" would make every
 * password containing those two letters — a large fraction of all passwords —
 * unusable, and the message would be baffling.
 */
const MIN_IDENTIFIER_LENGTH = 4;

/**
 * Splits raw identifiers (a name, a mobile number, an org code) into the
 * fragments worth matching. A name is split on whitespace and punctuation so
 * that "Priya Sharma" rejects both "priya" and "sharma" independently.
 */
export function identifierFragments(identifiers: readonly string[]): string[] {
  const fragments = identifiers
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
    .filter((fragment) => fragment.length >= MIN_IDENTIFIER_LENGTH);

  return [...new Set(fragments)];
}

export function containsIdentifier(
  password: string,
  identifiers: readonly string[],
): boolean {
  const lowered = password.toLowerCase();
  return identifierFragments(identifiers).some((fragment) =>
    lowered.includes(fragment),
  );
}

export interface PasswordPolicyOptions {
  /**
   * Account identifiers the password may not contain — typically the user's
   * name, mobile number and organization code (Q-PWD-8).
   *
   * Only the server passes these. The browser validates the reset form before
   * any identity is known to it, which is deliberate: the reset screen carries
   * no identity field, because identity comes solely from the single-use reset
   * authorization the server holds.
   */
  identifiers?: readonly string[];
}

/**
 * Builds the password-policy schema.
 *
 * Length is checked with `.min`/`.max` so an over-long value is rejected before
 * the more expensive rules run; everything else is a single `superRefine` so
 * that a password failing several rules reports all of them at once rather than
 * making the user fix one violation per submission.
 */
export function buildPasswordPolicySchema(
  options: PasswordPolicyOptions = {},
): z.ZodType<string> {
  const identifiers = options.identifiers ?? [];

  return z
    .string()
    .min(PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT)
    .max(PASSWORD_MAX_LENGTH, PASSWORD_TOO_LONG)
    .superRefine((password, ctx) => {
      if (countCharacterClasses(password) < PASSWORD_REQUIRED_CLASSES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: PASSWORD_NOT_COMPLEX,
        });
      }

      if (isCommonPassword(password)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: PASSWORD_TOO_COMMON,
        });
      }

      if (identifiers.length > 0 && containsIdentifier(password, identifiers)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: PASSWORD_CONTAINS_IDENTIFIER,
        });
      }
    });
}

/**
 * The identifier-free policy, used by the browser and as the default everywhere
 * an account is not in hand.
 */
export const passwordPolicySchema = buildPasswordPolicySchema();

/** One rule's outcome, for the strength meter's checklist. */
export interface PasswordRule {
  id: "length" | "classes" | "common";
  label: string;
  satisfied: boolean;
}

/**
 * Evaluates a password against the policy for UI feedback.
 *
 * Returns only booleans and a score — never the password — so a caller can hold
 * the result in component state without the plaintext ever entering it.
 */
export function evaluatePassword(password: string): {
  rules: PasswordRule[];
  /** 0-4; 0 for an empty input. */
  score: number;
  satisfiesPolicy: boolean;
} {
  const classes = countCharacterClasses(password);
  const rules: PasswordRule[] = [
    {
      id: "length",
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      satisfied:
        password.length >= PASSWORD_MIN_LENGTH &&
        password.length <= PASSWORD_MAX_LENGTH,
    },
    {
      id: "classes",
      label: "3 of: uppercase, lowercase, number, symbol",
      satisfied: classes >= PASSWORD_REQUIRED_CLASSES,
    },
    {
      id: "common",
      label: "Not a commonly used password",
      satisfied: password.length > 0 && !isCommonPassword(password),
    },
  ];

  const satisfiesPolicy = rules.every((rule) => rule.satisfied);

  if (password.length === 0) {
    return { rules, score: 0, satisfiesPolicy: false };
  }

  /**
   * Score is presentational only — the policy above is what actually gates a
   * reset. It rewards meeting the policy, then length beyond the minimum, so a
   * compliant password never renders as "weak".
   */
  let score = satisfiesPolicy ? 2 : Math.min(classes, 1);
  if (satisfiesPolicy && password.length >= PASSWORD_MIN_LENGTH + 4) score += 1;
  if (satisfiesPolicy && classes === 4 && password.length >= 16) score += 1;

  return { rules, score, satisfiesPolicy };
}
