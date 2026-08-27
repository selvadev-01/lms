import { z } from "zod";

import { paiseString } from "./loans";
import {
  SETTING_CATEGORIES,
  SETTING_SCOPES,
  SETTING_VALUE_TYPES,
  type SettingCategory,
  type SettingScope,
  type SettingValueType,
} from "./options";

/**
 * Module 17 — the setting definition registry, and the form schemas around it.
 *
 * This file is what makes a generic `settings` table safe. The table stores
 * `setting_code` + `value_json` and could hold anything; `SETTING_DEFINITIONS`
 * below decides what it actually may hold. Every write resolves its code here
 * first, and an unresolved code is refused rather than stored. That is Rules 8
 * and 9 — "only settings defined by the LMS configuration model may be created
 * or changed", "arbitrary key/value settings must not be introduced through the
 * UI" — enforced without a migration per setting.
 *
 * Three properties of a definition are authority, not decoration:
 *
 *  * `schema` validates the value. It is re-run before a change request is
 *    applied, not only at submission, because an approval can arrive days later
 *    (Rules 10, 11; Scenario 63).
 *  * `requiresApproval` decides maker-checker. It lives ONLY here. There is
 *    deliberately no `requires_approval` column on `settings`: a column would be
 *    a second source of truth an operator could flip to bypass approval, which
 *    is what Rule 43 exists to prevent.
 *  * `isProtected` decides both read masking and who may write (Scenario 64).
 *    The row stores a snapshot of it for rendering, but the snapshot must never
 *    be read to make the authorization decision.
 *
 * Import discipline: this file reaches for `./options`, `./primitives` and
 * `./loans` directly and never `./index` — see the header of `primitives.ts` for
 * why that cycle is a runtime failure rather than a type-level one.
 */

/** Integer optimistic-lock token, for the tables that version with a counter. */
const versionSchema = z.coerce
  .number({ invalid_type_error: "This form is out of date. Reload and try again." })
  .int("This form is out of date. Reload and try again.")
  .min(1, "This form is out of date. Reload and try again.");

/**
 * A boolean arriving from an HTML form, where an unchecked box sends nothing and
 * a checked one sends "on".
 */
const formBoolean = z.preprocess(
  (value) =>
    value === "on" || value === "true" || value === true
      ? true
      : value === "" || value === null || value === undefined
        ? false
        : value,
  z.boolean({ invalid_type_error: "Value must be true or false" }),
);

/** A DATE-only value, Asia/Kolkata business-date semantics (Rules 16, 17). */
const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: "Enter a valid date",
  });

/** A local wall-clock "HH:MM". Not a timestamp — see `BusinessCalendar`. */
export const clockTimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time as HH:MM");

export interface SettingDefinition {
  code: string;
  name: string;
  description: string;
  category: SettingCategory;
  scope: SettingScope;
  valueType: SettingValueType;
  /** Requires `settings.protected.manage` to edit, and masks on read without it. */
  isProtected: boolean;
  /** Maker-checker. The only authority on this — see the file header. */
  requiresApproval: boolean;
  /** Validates the stored value. Re-run at apply time, not only at submission. */
  schema: z.ZodTypeAny;
}

/**
 * The settings this LMS supports.
 *
 * Deliberately small. The registry makes adding one a code change — a schema, a
 * scope and a decision about approval — and that is the point: a setting nobody
 * wrote a validator for is a setting nobody decided the rules for. Answers open
 * questions 2, 3 and 6 for the MVP rather than guessing at a general framework.
 */
export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    code: "ORG_DISPLAY_NAME",
    name: "Organization display name",
    description:
      "The name shown in the application header and on generated documents. Does not rename the organization record itself.",
    category: "GENERAL",
    scope: "ORG",
    valueType: "STRING",
    isProtected: false,
    requiresApproval: false,
    schema: z
      .string()
      .trim()
      .min(1, "Value is required")
      .max(200, "Value must be 200 characters or fewer"),
  },
  {
    code: "ORG_FINANCIAL_YEAR_START",
    name: "Financial year start",
    description:
      "The MM-DD the financial year begins on. Reporting periods derive from it; it does not alter any posted transaction.",
    category: "FINANCIAL",
    scope: "ORG",
    valueType: "STRING",
    isProtected: false,
    requiresApproval: false,
    // MM-DD rather than a full date: the year is whichever year the period falls
    // in, and storing one would silently expire the setting every January.
    schema: z
      .string()
      .trim()
      .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Enter a date as MM-DD"),
  },
  {
    code: "BRANCH_CASH_LIMIT_PAISE",
    name: "Branch cash holding limit",
    description:
      "The maximum cash a branch may hold before a handover is expected. Advisory: it is surfaced in reconciliation, and never blocks a collection that has already happened.",
    category: "OPERATIONS",
    scope: "BRANCH",
    valueType: "PAISE",
    isProtected: false,
    // A cash limit is a control, so a branch may propose but not self-approve.
    requiresApproval: true,
    // `paiseString`, not `z.number().int()`. Money in this codebase is a digit
    // string end to end, because a double cannot hold a large rupee amount in
    // paise without losing the last digits — the same reason the loan and
    // accounting schemas use it. It also rejects "1000.50" outright, which is
    // Scenario 8: a floating-point monetary value is refused, not truncated.
    schema: paiseString("Value"),
  },
  {
    code: "EOD_AUTO_RUN_ENABLED",
    name: "Automatic end-of-day",
    description:
      "Whether the scheduled EOD sweep runs for this scope. Disabling it does not prevent an authorized manual run.",
    category: "OPERATIONS",
    scope: "ORG_OR_BRANCH",
    valueType: "BOOLEAN",
    isProtected: false,
    requiresApproval: false,
    schema: formBoolean,
  },
  {
    code: "AUDIT_EXPORT_MAX_DAYS",
    name: "Audit export range limit",
    description:
      "The widest date range a single audit export may cover. Protected: widening it changes how much evidence one request can remove from the system at once.",
    category: "SECURITY",
    scope: "ORG",
    valueType: "INTEGER",
    isProtected: true,
    requiresApproval: true,
    schema: z.coerce
      .number({ invalid_type_error: "Value must be a whole number of days" })
      .int("Value must be a whole number of days")
      .min(1, "Value must be at least 1 day")
      .max(366, "Value must be 366 days or fewer"),
  },
  {
    code: "MAINTENANCE_DEFAULT_MESSAGE",
    name: "Default maintenance message",
    description:
      "Shown to users when an operation is blocked by maintenance mode and no specific message was given (Rule 79).",
    category: "OPERATIONS",
    scope: "ORG",
    valueType: "STRING",
    isProtected: false,
    requiresApproval: false,
    schema: z
      .string()
      .trim()
      .min(1, "Value is required")
      .max(500, "Value must be 500 characters or fewer"),
  },
] as const;

export const SETTING_CODES = SETTING_DEFINITIONS.map(
  (definition) => definition.code,
);

/**
 * Resolve a setting code, or `undefined` for an unknown one.
 *
 * Callers must treat `undefined` as a refusal. Returning it rather than throwing
 * keeps the decision — 400 on the API, a field error on a form — with the caller.
 */
export function getSettingDefinition(
  code: string,
): SettingDefinition | undefined {
  return SETTING_DEFINITIONS.find((definition) => definition.code === code);
}

/** Whether a definition may be written at the given scope. */
export function isScopeAllowed(
  definition: SettingDefinition,
  branchId: string | null,
): boolean {
  if (definition.scope === "ORG") return branchId === null;
  if (definition.scope === "BRANCH") return branchId !== null;
  return true;
}

export const settingCodeSchema = z
  .string()
  .trim()
  .min(1, "Setting Code is required")
  .refine((code) => getSettingDefinition(code) !== undefined, {
    // Named deliberately: an unsupported code is a different failure from a
    // malformed value, and Scenario 60 asks for the import of an unsupported
    // setting to be refused as such.
    message: "That setting is not supported by this system",
  });

export const settingCategorySchema = z.enum(SETTING_CATEGORIES, {
  errorMap: () => ({ message: "Category is required" }),
});

export const settingValueTypeSchema = z.enum(SETTING_VALUE_TYPES, {
  errorMap: () => ({ message: "Value Type is required" }),
});

export const settingScopeSchema = z.enum(SETTING_SCOPES, {
  errorMap: () => ({ message: "Scope is required" }),
});

/**
 * Validate a raw value against its definition.
 *
 * The single entry point for "is this value legal for this code", used by the
 * API on write, by the change-request service at apply time, and by the web form
 * before submission — so all three agree by construction rather than by
 * discipline.
 */
export function validateSettingValue(
  code: string,
  value: unknown,
):
  | { ok: true; value: unknown; definition: SettingDefinition }
  | { ok: false; message: string } {
  const definition = getSettingDefinition(code);
  if (!definition) {
    return { ok: false, message: "That setting is not supported by this system" };
  }
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Value is invalid",
    };
  }
  return { ok: true, value: parsed.data, definition };
}

/**
 * Mandatory-field messages come from the Scenario Outline in the spec and are
 * reproduced verbatim, because the outline asserts on the text.
 */
const changeReasonSchema = z
  .string()
  .trim()
  .min(1, "Change Reason is required")
  .max(500, "Change Reason must be 500 characters or fewer");

export const createSettingSchema = z.object({
  settingCode: settingCodeSchema,
  branchId: z.string().uuid().nullish(),
  value: z.unknown(),
  effectiveFrom: isoDateSchema.nullish(),
  effectiveTo: isoDateSchema.nullish(),
  changeReason: changeReasonSchema,
});

export const updateSettingSchema = z.object({
  value: z.unknown(),
  effectiveFrom: isoDateSchema.nullish(),
  effectiveTo: isoDateSchema.nullish(),
  changeReason: changeReasonSchema,
  expectedVersion: versionSchema,
});

export const submitChangeRequestSchema = z.object({
  settingCode: settingCodeSchema,
  branchId: z.string().uuid().nullish(),
  requestedValue: z.unknown(),
  changeReason: changeReasonSchema,
  baseVersion: z.coerce.number().int().min(0),
});

export const approveChangeSchema = z.object({
  /** Optional: an approval needs no justification, a rejection does. */
  note: z.string().trim().max(500).optional(),
});

export const rejectChangeSchema = z.object({
  rejectionReason: z
    .string()
    .trim()
    .min(1, "Rejection Reason is required")
    .max(500, "Rejection Reason must be 500 characters or fewer"),
});

/**
 * The business calendar.
 *
 * Two rules are enforced here and re-asserted server-side, because a rule
 * written only in zod is enforced on the web only — the API is a separate
 * validation surface and a direct caller bypasses this file entirely.
 */
export const businessCalendarSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Calendar Name is required")
      .max(150, "Calendar Name must be 150 characters or fewer"),
    branchId: z.string().uuid().nullish(),
    // Stored, but only one value is accepted (Rule 16). A visible refusal beats
    // a silent hardcode: widening it later becomes a deliberate change.
    timezone: z.literal("Asia/Kolkata", {
      errorMap: () => ({ message: "Only Asia/Kolkata is supported" }),
    }),
    workingDays: z
      .array(z.coerce.number().int().min(1).max(7))
      .min(1, "At least one working day is required")
      .max(7, "There are only seven days in a week")
      .refine((days) => new Set(days).size === days.length, {
        message: "Each working day may appear only once",
      }),
    eodWindowStart: clockTimeSchema.nullish(),
    eodWindowEnd: clockTimeSchema.nullish(),
    allowControlledRerun: formBoolean.optional(),
    expectedVersion: versionSchema.optional(),
  })
  .superRefine((value, ctx) => {
    // Scenario 20. Both-or-neither, and end strictly after start. A window that
    // ends before it begins would silently never open.
    const hasStart = Boolean(value.eodWindowStart);
    const hasEnd = Boolean(value.eodWindowEnd);
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Set both ends of the EOD window, or neither",
        path: [hasStart ? "eodWindowEnd" : "eodWindowStart"],
      });
      return;
    }
    if (hasStart && hasEnd && value.eodWindowEnd! <= value.eodWindowStart!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The EOD window must end after it starts",
        path: ["eodWindowEnd"],
      });
    }
  });

export const holidaySchema = z.object({
  holidayDate: isoDateSchema,
  name: z
    .string()
    .trim()
    .min(1, "Holiday Name is required")
    .max(150, "Holiday Name must be 150 characters or fewer"),
});

export const maintenanceModeSchema = z.object({
  branchId: z.string().uuid().nullish(),
  enabled: formBoolean,
  reason: z
    .string()
    .trim()
    .min(1, "Reason is required")
    .max(500, "Reason must be 500 characters or fewer"),
  expectedEndAt: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "Enter a valid date and time",
    })
    .nullish(),
  allowedPermissions: z.array(z.string().trim().min(1)).optional(),
  blockedOperations: z.array(z.string().trim().min(1)).optional(),
  userMessage: z
    .string()
    .trim()
    .max(500, "Message must be 500 characters or fewer")
    .nullish(),
  expectedVersion: versionSchema.optional(),
});

export const startMaintenanceJobSchema = z.object({
  jobType: z
    .string()
    .trim()
    .min(1, "Job Type is required")
    .max(60, "Job Type must be 60 characters or fewer"),
  branchId: z.string().uuid().nullish(),
  businessDate: isoDateSchema.optional(),
});

export const startEodSchema = z.object({
  branchId: z.string().uuid().nullish(),
  /** Defaults to the calendar's current business date when omitted. */
  businessDate: isoDateSchema.optional(),
});

/**
 * Audit list filters (Scenario 38). Every one of these is applied server-side —
 * the query object is a request, not a trusted `where` clause.
 */
export const listAuditSchema = z.object({
  actorUserId: z.string().uuid().optional(),
  module: z.string().trim().max(100).optional(),
  action: z.string().trim().max(150).optional(),
  entityType: z.string().trim().max(100).optional(),
  entityId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export type CreateSettingInput = z.infer<typeof createSettingSchema>;
export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;
export type SubmitChangeRequestInput = z.infer<typeof submitChangeRequestSchema>;
export type RejectChangeInput = z.infer<typeof rejectChangeSchema>;
export type BusinessCalendarInput = z.infer<typeof businessCalendarSchema>;
export type HolidayInput = z.infer<typeof holidaySchema>;
export type MaintenanceModeInput = z.infer<typeof maintenanceModeSchema>;
export type StartMaintenanceJobInput = z.infer<typeof startMaintenanceJobSchema>;
export type StartEodInput = z.infer<typeof startEodSchema>;
export type ListAuditInput = z.infer<typeof listAuditSchema>;
