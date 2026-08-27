import { z } from "zod";

import { expectedVersionSchema } from "./loans";
import { optionsFrom } from "./options";
import { optionalText } from "./primitives";

/**
 * Module 10 schemas — the repayment schedule.
 *
 * Follows `disbursements.ts` in structure and in the same conventions: no scope
 * fields, one schema per endpoint, `expectedVersion` on every mutation, and
 * imports from `./loans` and `./primitives` rather than `./index` for the cycle
 * reason both of those files document.
 *
 * **These schemas are the web app's guard, not the API's.** The API validates
 * again with its own class-validator DTOs, and that second pass is the one that
 * actually protects the database — a rule written only here is enforced only in
 * the browser. The two are kept deliberately in step.
 *
 * Note what is *absent*: there is no schema for editing an installment. Rule 24
 * forbids arbitrary edits of a generated EMI row, and the way to enforce that
 * is to expose no endpoint at all rather than to validate one carefully
 * (Scenario 15).
 */

export const repaymentScheduleStatusSchema = z.enum(
  ["ACTIVE", "SUPERSEDED", "CANCELLED"],
  {
    required_error: "Schedule Status is required",
    invalid_type_error: "Schedule Status is required",
  },
);

export const REPAYMENT_SCHEDULE_STATUS_OPTIONS = optionsFrom(
  repaymentScheduleStatusSchema.options,
  {
    ACTIVE: "Active",
    SUPERSEDED: "Superseded",
    CANCELLED: "Cancelled",
  },
);

/**
 * EMI status as the screen shows it.
 *
 * `PENDING`, `DUE` and `OVERDUE` are derived from the business date rather than
 * stored, so filtering a list by one of them is a filter on a computed value —
 * which is why the list endpoint filters schedules, not installments.
 */
export const emiStatusSchema = z.enum([
  "PENDING",
  "DUE",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "WAIVED",
  "CANCELLED",
]);

export const EMI_STATUS_OPTIONS = optionsFrom(emiStatusSchema.options, {
  PENDING: "Pending",
  DUE: "Due",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  WAIVED: "Waived",
  CANCELLED: "Cancelled",
});

export const listRepaymentSchedulesSchema = z.object({
  search: optionalText(120),
  status: repaymentScheduleStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListRepaymentSchedulesInput = z.infer<
  typeof listRepaymentSchedulesSchema
>;

/**
 * Regenerating supersedes the live schedule with a new version.
 *
 * The reason is **required**, unlike most free-text fields in this codebase.
 * Scenario 43 requires the audit trail to retain why a version was retired, and
 * a reason that may be omitted is a reason that will be, leaving the audit
 * entry unable to answer the only question anyone asks of it later.
 *
 * `@MaxLength`-equivalent goes last so an empty string reports "required"
 * rather than passing a length check it trivially satisfies.
 */
export const regenerateScheduleSchema = z.object({
  reason: z
    .string({
      required_error: "Reason is required",
      invalid_type_error: "Reason is required",
    })
    .trim()
    .min(1, "Reason is required")
    .max(500, "Reason must be 500 characters or fewer"),
  expectedVersion: expectedVersionSchema,
});
export type RegenerateScheduleInput = z.infer<typeof regenerateScheduleSchema>;

/**
 * Retrying a failed generation (Scenario 29).
 *
 * No reason and no `expectedVersion`: a retry runs precisely when there is no
 * schedule to be stale against, and it supersedes nothing. Its idempotency
 * comes from the `(orgId, loanId, version)` unique constraint, not from a token
 * the client holds.
 */
export const retryScheduleGenerationSchema = z.object({});
export type RetryScheduleGenerationInput = z.infer<
  typeof retryScheduleGenerationSchema
>;

/**
 * `errorMap` rather than `invalid_type_error`: a value of the right *type* but
 * outside the enum ("xlsx") raises `invalid_enum_value`, which
 * `invalid_type_error` never sees. Without this the user is shown zod's raw
 * "Invalid enum value. Expected 'csv' | 'pdf'" instead of a field message.
 */
export const scheduleExportFormatSchema = z.enum(["csv", "pdf"], {
  errorMap: () => ({ message: "Format must be csv or pdf" }),
});

export const exportScheduleSchema = z.object({
  format: scheduleExportFormatSchema.default("csv"),
});
export type ExportScheduleInput = z.infer<typeof exportScheduleSchema>;
export type ScheduleExportFormat = z.infer<typeof scheduleExportFormatSchema>;
