import { z } from "zod";

// Imported at the top rather than beside the re-export below: the compiled CJS
// turns a lower import into a require that runs after signUpSchema is built,
// which fails at load with a TDZ error rather than at compile time.
import { passwordPolicySchema } from "./password-policy";

import {
  emailSchema,
  mobileField,
  optionalText,
  statusSchema,
} from "./primitives";

/**
 * Zod schemas shared by web forms and api DTOs, so a rule is defined once and
 * enforced on both sides of the wire.
 *
 * The shared primitives live in `./primitives` and are re-exported below, so
 * consumers still import everything from `@lms/validation`. They are not defined
 * here because `./rbac` needs them and this file re-exports `./rbac` — see the
 * cycle note in that file.
 */

export {
  idSchema,
  emailSchema,
  phoneSchema,
  mobileField,
  optionalText,
  statusSchema,
} from "./primitives";

export const panSchema = z
  .string()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Enter a valid PAN");

export const aadhaarSchema = z
  .string()
  .regex(/^\d{12}$/, "Aadhaar must be 12 digits");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Organization code identifies the tenant at sign-in. `Organization.code` is
 * globally unique, whereas a mobile number is only unique within an org
 * (`@@unique([orgId, mobile])`), so the code is what resolves which tenant a
 * mobile number belongs to.
 */
export const orgCodeSchema = z
  .string()
  .trim()
  .min(1, "Organization Code is required")
  .max(50)
  .regex(/^[A-Za-z0-9_-]+$/, "Enter a valid Organization Code");

/**
 * Sign-in credentials: Organization Code + Mobile Number + Password.
 *
 * The password rule here is deliberately `min(1)` — presence only. Applying the
 * full password policy at sign-in would leak policy details to an attacker and
 * lock out users whose password predates a policy change. The policy belongs to
 * the password-management flows; use `passwordPolicySchema` there.
 */
export const signInSchema = z.object({
  orgCode: orgCodeSchema,
  mobile: mobileField,
  password: z.string().min(1, "Password is required"),
});

/**
 * Public organization signup — creating a tenant and its first Super Admin.
 *
 * Every field reuses an existing primitive rather than restating a rule, so the
 * browser and the API cannot come to disagree about what a valid organization
 * code or mobile number is.
 *
 * The password uses the full `passwordPolicySchema`, unlike sign-in above: this
 * is a password being *created*, which is exactly where the policy belongs.
 *
 * `confirmPassword` exists only here. The API has no such field — it receives
 * one password and either accepts it or does not, and checking that two strings
 * the same client sent match each other proves nothing server-side. It is a
 * typo-catcher for the person typing, so it is enforced where the typing
 * happens.
 */
export const signUpSchema = z
  .object({
    orgName: z.string().trim().min(1, "Organization Name is required").max(200),
    orgCode: orgCodeSchema,
    adminName: z.string().trim().min(1, "Your Name is required").max(200),
    adminMobile: mobileField,
    password: passwordPolicySchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    // Reported against the field the user would correct, not the first one.
    path: ["confirmPassword"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Password policy for creating or changing a password.
 *
 * Defined in ./password-policy so the rules, their messages and the UI-facing
 * evaluator live together; re-exported here because `@lms/validation` is the
 * single import surface both apps use.
 */
export {
  passwordPolicySchema,
  buildPasswordPolicySchema,
  evaluatePassword,
  countCharacterClasses,
  isCommonPassword,
  containsIdentifier,
  identifierFragments,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_REQUIRED_CLASSES,
  PASSWORD_HISTORY_DEPTH,
  PASSWORD_TOO_SHORT,
  PASSWORD_TOO_LONG,
  PASSWORD_NOT_COMPLEX,
  PASSWORD_TOO_COMMON,
  PASSWORD_CONTAINS_IDENTIFIER,
  type PasswordPolicyOptions,
  type PasswordRule,
} from "./password-policy";

// --- Password recovery -------------------------------------------------------

/**
 * Step 1 — Forgot Password.
 *
 * Mobile Number is the only source-defined recovery identifier, and no password
 * is collected: the screen exists precisely because the password is unavailable
 * (Forgot Password rule 5). Organization Code is carried for the same reason as
 * sign-in — a mobile number is only unique within a tenant.
 */
export const forgotPasswordSchema = z.object({
  orgCode: orgCodeSchema,
  mobile: mobileField,
});

/**
 * Step 2 — Verify the recovery OTP.
 *
 * Length is not hard-coded to the config default by accident: `AUTH_RECOVERY_
 * OTP_LENGTH` is server-side, and a client schema cannot read it. Six digits is
 * the applied default (Q-REC-3); if that changes, this regex changes with it.
 */
export const verifyOtpSchema = forgotPasswordSchema.extend({
  otp: z
    .string()
    .trim()
    .min(1, "Verification Code is required")
    .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit verification code")),
});

/**
 * Step 3 — Reset Password.
 *
 * Carries no identity field at all. The user is identified solely by the
 * single-use reset authorization minted in step 2, which the server holds; a
 * client-supplied mobile here would be an authorization bypass.
 *
 * Confirm Password is a UI-only guard against typos in a masked field. It is
 * checked server-side too, because the Server Action is the authoritative
 * validator, but it is never sent to the API.
 */
export const resetPasswordSchema = z
  .object({
    password: passwordPolicySchema,
    confirmPassword: z.string().min(1, "Confirm Password is required"),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// --- Change Password (authenticated) -----------------------------------------

/**
 * Change Password — an authenticated user replacing their own credential.
 *
 * Carries no identity field, for the same reason `resetPasswordSchema` does not:
 * the user is whoever the session says they are. A client-supplied user id here
 * would be an authorization bypass (Change Password Scenario 29).
 *
 * `currentPassword` is presence-only, exactly like `signInSchema.password`.
 * Applying the policy to it would reject any user whose existing password
 * predates a policy tightening — locking them out of the one screen that would
 * fix it.
 *
 * The `.min(1).pipe(...)` on `newPassword` follows the `mobileField` idiom: an
 * empty value must report "required" rather than a length error (Scenario 5).
 *
 * The new-differs-from-current refinement is a convenience only. The server
 * enforces it authoritatively for free — `PasswordPolicyService.assertNotReused`
 * checks the current hash before the history, so Scenario 15 is rejected there
 * even if this schema is bypassed. Checking here just saves a round trip.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current Password is required"),
    newPassword: z
      .string()
      .min(1, "New Password is required")
      .pipe(passwordPolicySchema),
    confirmNewPassword: z.string().min(1, "Confirm New Password is required"),
  })
  .refine((value) => value.newPassword === value.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: "Your new password must be different from your current password",
    path: ["newPassword"],
  });

/**
 * A GPS check-in submitted from the field-operations screen.
 *
 * Deliberately carries no `userId`, `orgId`, `branchId` or `sessionId`: all
 * four come from the authenticated session server-side, which is what makes
 * "GPS cannot change your branch or organization" (GPS Scenarios 23, 24, 26)
 * true by construction rather than by validation.
 *
 * Coordinates are optional at this layer because the same shape carries a
 * failed attempt. Whether a position is *required* is a verification rule, not
 * a parse rule — it lives in `evaluateLocation` on the server, so a client that
 * omits coordinates gets a recorded, audited failure rather than a 400 that
 * leaves no trace.
 */
export const gpsCheckInSchema = z.object({
  /** Client-minted per attempt; the idempotency key for a retried submit. */
  clientAttemptId: z.string().uuid(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  /** Metres of uncertainty, as reported by the device. Never negative. */
  accuracyMeters: z.coerce.number().min(0).optional(),
  /** Device clock, ISO-8601. Checked for freshness server-side, not trusted. */
  locationTimestamp: z.string().datetime({ offset: true }).optional(),
  permissionStatus: z.enum(["GRANTED", "DENIED", "UNAVAILABLE", "UNKNOWN"]),
  networkStatus: z.enum(["ONLINE", "OFFLINE"]),
});

/**
 * A failure the browser reported before any position existed — a denied
 * permission, a timeout, or a provider error.
 *
 * Separate from `gpsCheckInSchema` because the client genuinely has nothing to
 * send but a cause, and forcing it through the coordinate-shaped schema would
 * mean inventing empty fields for a record whose whole point is that no
 * location was obtained.
 */
export const gpsFailureSchema = z.object({
  clientAttemptId: z.string().uuid(),
  permissionStatus: z.enum(["GRANTED", "DENIED", "UNAVAILABLE", "UNKNOWN"]),
  networkStatus: z.enum(["ONLINE", "OFFLINE"]),
  failureReason: z.enum([
    "PERMISSION_DENIED",
    "POSITION_UNAVAILABLE",
    "TIMEOUT",
    "PROVIDER_ERROR",
    "NETWORK_LOST",
    "CANCELLED",
  ]),
});

/**
 * Branch code, unique within an organization (`@@unique([orgId, code])`) as
 * opposed to `orgCodeSchema`, which is globally unique. Same character rule:
 * codes appear in receipt numbers and report filenames, so they stay to
 * characters that survive a filename and a URL unescaped.
 */
export const branchCodeSchema = z
  .string()
  .trim()
  .min(1, "Branch Code is required")
  .max(50)
  .regex(/^[A-Za-z0-9_-]+$/, "Enter a valid Branch Code");

/**
 * Company Settings edit.
 *
 * `code` is absent by design, not by oversight: the organization code is the
 * tenant's identity, is quoted at sign-in, and is referenced by history. The
 * API's `forbidNonWhitelisted` turns an attempt to send one into a 400 rather
 * than a silent no-op (Module 02 Scenario 6).
 */
export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Organization Name is required").max(200),
  legalName: optionalText(250),
  timezone: optionalText(64),
});

/** Branch create. `organizationId` is likewise absent — scope comes from the JWT. */
export const createBranchSchema = z.object({
  code: branchCodeSchema,
  name: z.string().trim().min(1, "Branch Name is required").max(200),
  addressLine1: z.string().trim().min(1, "Address is required").max(250),
  addressLine2: optionalText(250),
  city: z.string().trim().min(1, "City is required").max(100),
  state: z.string().trim().min(1, "State is required").max(100),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter a valid 6-digit pincode"),
  phone: optionalText(30),
  contactEmail: optionalText(255).pipe(emailSchema.optional()),
  status: statusSchema,
});

/**
 * Branch edit. Code is omitted for the same reason the organization's is:
 * branch codes scope gapless receipt sequences, so renaming one would
 * retroactively change what an already-issued receipt number refers to
 * (Scenario 39).
 */
export const updateBranchSchema = createBranchSchema.omit({
  code: true,
  status: true,
});

/**
 * Status change. The reason is optional but capped at the column width, and is
 * what makes a deactivation answerable later without an audit query.
 */
export const setStatusSchema = z.object({
  status: statusSchema,
  reason: optionalText(500),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type SetStatusInput = z.infer<typeof setStatusSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type GpsCheckInInput = z.infer<typeof gpsCheckInSchema>;
export type GpsFailureInput = z.infer<typeof gpsFailureSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * The shared dropdown option contract and its helpers.
 *
 * Placed before the schema re-exports below because those files import
 * `optionsFrom` from `./options` directly — the same cycle-avoiding rule that
 * sends them to `./primitives` rather than here. `options.ts` itself imports
 * nothing.
 */
export * from "./options";

/**
 * Master data form schemas. Takes its category list from `./options` directly,
 * never from here, for the same cycle-avoiding reason as the files below.
 */
export * from "./master-data";

/**
 * Module 03 schemas, re-exported so both apps keep one import surface.
 *
 * `rbac.ts` takes its primitives from `./primitives` rather than from here, which
 * is what keeps this re-export from being a cycle.
 */
export * from "./rbac";

/**
 * Module 04 schemas. Same cycle-avoiding rule as `rbac.ts`: `customers.ts` takes
 * its primitives from `./primitives`, never from here.
 */
export * from "./customers";

/**
 * Modules 06-07 schemas. Same cycle-avoiding rule as `rbac.ts` and
 * `customers.ts`: `loans.ts` takes its primitives from `./primitives`, never
 * from here.
 */
export * from "./loans";

/**
 * Module 09 schemas. Reaches for `./loans` and `./primitives` directly, never
 * for this file — the same cycle-avoiding rule, one level deeper: this line
 * re-exports `disbursements.ts`, so an import from `./index` there would begin
 * evaluating this module before its own consts had initialized.
 */
export * from "./disbursements";

/** Module 10 schemas. Same cycle-avoiding rule as `disbursements.ts` above. */
export * from "./repayment-schedules";

/** Module 11 schemas. Same cycle-avoiding rule as `disbursements.ts` above. */
export * from "./collections";

/**
 * Module 12 schemas — field collection. Same cycle-avoiding rule as
 * `disbursements.ts` above; this one additionally reaches `./collections`
 * directly, because a field collection extends a Module 11 collection body.
 */
export * from "./field-collections";

/** Module 12 schemas — cash custody. Same cycle-avoiding rule. */
export * from "./cash";

/** Module 14 schemas. Same cycle-avoiding rule as `disbursements.ts` above. */
export * from "./accounting";

/**
 * Module 13 schemas — overdue and recovery. Same cycle-avoiding rule as
 * `disbursements.ts` above.
 *
 * Named `overdue-recovery.ts` rather than `recovery.ts` because the latter
 * would collide in meaning with `recovery.test.ts`, which covers *password*
 * recovery. There is deliberately no overdue *input* schema: the overdue
 * position is derived server-side from the schedule and the business date, so
 * there is nothing for a client to submit.
 */
export * from "./overdue-recovery";

/**
 * Module 15 — reports and analytics.
 *
 * The only schemas in this package that describe a *read*. Every other module
 * file validates something a user is submitting; a report request is a query,
 * and what it needs guarding against is not a malformed record but an
 * unbounded or out-of-scope question — hence the date-range ceiling and the
 * per-category date-basis whitelist rather than field-level rules.
 *
 * There is deliberately no schema for a report's *rows*: they are projections
 * of other modules' authoritative data, and a report can never be submitted.
 */
export * from "./reports";

/**
 * Module 16 — notifications.
 *
 * Two absences here are load-bearing rather than oversights. There is no
 * `recipientUserId` anywhere, and the preference schema carries no `userId` at
 * all: Rules 49 and 50 scope preferences to the authenticated user, and an
 * absent field enforces Scenario 19 more strongly than a permission check
 * because there is no slot to put another user's id in.
 *
 * There is also no schema for a notification's *content*. Titles and messages
 * are rendered from a template at creation and frozen (Rule 40, Scenario 8) —
 * a user never submits one, so validating one would describe a path that does
 * not exist.
 */
export * from "./notifications";

/**
 * Module 17 — settings, audit and maintenance.
 *
 * The important export here is `SETTING_DEFINITIONS`, and it is not a form
 * schema. It is the registry that decides which setting codes exist at all: the
 * `settings` table is generic, and this list is the only thing standing between
 * it and the arbitrary key/value store Rules 8 and 9 forbid. An unknown code is
 * refused, never stored.
 *
 * One absence is load-bearing. No schema here carries a `requiresApproval`
 * field, and there is no column for it either — maker-checker is a property of
 * the definition, so it cannot be turned off per row by anyone submitting a
 * form. Rule 43 depends on that being unrepresentable rather than merely
 * checked.
 */
export * from "./settings";

/**
 * Module 18 — the dashboard's period and scope filter.
 *
 * The smallest module file here, and deliberately so. The dashboard writes
 * nothing: it is a read and navigation layer (Rule 1), so there is no form to
 * validate and the only input anyone submits is which period and which branch
 * to look at.
 *
 * What is absent is the point. No `organizationId`, because it comes from the
 * JWT. No `businessDate`, because it is derived on the server from
 * Asia/Kolkata — the specification asks for a "Business Date is required"
 * message, and the field is instead made unacceptable, so it can never be
 * missing. And `branchId` is a request the server is free to refuse, never an
 * instruction it obeys.
 */
export * from "./dashboard";
