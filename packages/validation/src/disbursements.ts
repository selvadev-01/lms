import { z } from "zod";

import { expectedVersionSchema, positivePaise } from "./loans";
import { optionsFrom } from "./options";
import { isoDateSchema, optionalText } from "./primitives";

/**
 * Module 09 schemas — disbursal.
 *
 * Follows `loans.ts` in structure and in all four of its conventions (no scope
 * fields, one field per endpoint, integer paise as digit strings, deliberate
 * refinement order). Imports from `./loans` and `./primitives` rather than
 * `./index` for the cycle reason documented in both.
 *
 * Two things are specific to this module:
 *
 * **Dates are validated, not merely length-capped.** Elsewhere an optional date
 * is `optionalText(10)`, which accepts any ten characters. Here the disbursal
 * and transfer dates are required and land on `@db.Date` columns, so "not a
 * date" has to be a 400 at the edge rather than a Prisma error inside a
 * money-moving transaction.
 *
 * **The amount is never trusted.** `recordTransferSchema` carries one only so
 * the operator's intent can be compared against the sanctioned figure and a
 * mismatch reported (Scenario 6). The server takes the authoritative amount
 * from the sanction letter regardless — see `DisbursementService`.
 */

/**
 * How the money physically moves.
 *
 * The source names Bank and Cash (Rule 10). UPI is carried because the Prisma
 * `PaymentMode` enum has it for Module 13's collections, and a disbursal made
 * by UPI settles through the same bank account — leaving it out here would mean
 * the enum and the schema disagreed about what is representable.
 */
export const disbursementPaymentModeSchema = z.enum(
  ["CASH", "UPI", "BANK_TRANSFER"],
  { errorMap: () => ({ message: "Transfer Method is required" }) },
);

export const disbursementStatusSchema = z.enum([
  "SCHEDULED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

/**
 * Labels for the disbursement lifecycle.
 *
 * "Transfer recorded" rather than "Processing" for PROCESSING: nothing is
 * processing in the background, and the word would suggest an async job the
 * operator should wait for. What the state actually means is that a transfer
 * has been recorded and the disbursement is waiting on a human to confirm it.
 */
export const DISBURSEMENT_STATUS_OPTIONS = optionsFrom(
  disbursementStatusSchema.options,
  {
    SCHEDULED: "Scheduled",
    PROCESSING: "Transfer recorded",
    COMPLETED: "Disbursed",
    FAILED: "Failed",
    CANCELLED: "Cancelled",
  },
);

/** Labels for the transfer method, for the form dropdown and the detail view. */
export const DISBURSEMENT_PAYMENT_MODE_OPTIONS = optionsFrom(
  disbursementPaymentModeSchema.options,
  {
    CASH: "Cash",
    UPI: "UPI",
    BANK_TRANSFER: "Bank transfer",
  },
);

/**
 * A bank or payment-provider reference for the transfer.
 *
 * Capped at the column width (150) and restricted to characters that survive a
 * CSV export and a URL unescaped — a reference is quoted in reconciliation
 * files and searched for by admins.
 */
const transactionReferenceSchema = z
  .string()
  .trim()
  .min(1, "Transaction Reference is required")
  .max(150, "Transaction Reference must be 150 characters or fewer")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9/_-]*$/,
    "Transaction Reference may use letters, digits, hyphen, underscore and slash only",
  );

/**
 * Schedule a disbursement (Scenario 5).
 *
 * Carries no amount. The figure comes from the sanction letter server-side,
 * which is what makes Rule 6 ("the amount must match the approved amount")
 * true by construction rather than by a comparison somebody has to remember.
 * A client that sends one gets a 400 from `forbidNonWhitelisted`.
 */
export const scheduleDisbursementSchema = z.object({
  applicationId: z.string().uuid("Select a loan to disburse"),
  disbursementDate: isoDateSchema("Disbursement Date"),
  disbursementAccountId: z
    .string({
      required_error: "Disbursement Account is required",
      invalid_type_error: "Disbursement Account is required",
    })
    .uuid("Disbursement Account is required"),
  notes: optionalText(1000),
  expectedVersion: expectedVersionSchema,
});

/**
 * Edit a scheduled disbursement before any transfer (Scenario 11).
 *
 * The application is not re-selectable — moving a schedule to a different loan
 * is a cancel and a re-schedule, not an edit, and allowing it here would let
 * one loan's approved terms fund another.
 */
export const updateDisbursementScheduleSchema = z.object({
  disbursementDate: isoDateSchema("Disbursement Date"),
  disbursementAccountId: z
    .string({
      required_error: "Disbursement Account is required",
      invalid_type_error: "Disbursement Account is required",
    })
    .uuid("Disbursement Account is required"),
  notes: optionalText(1000),
  expectedVersion: expectedVersionSchema,
});

/**
 * Record that the transfer was made (Scenarios 14-16).
 *
 * The bank-reference rule is expressed with `superRefine` on the object rather
 * than a conditional on the field. A `@ValidateIf`-style conditional applied to
 * a required field skips the presence check entirely and silently accepts a
 * missing value — the exact failure Rule 11 and Scenario 16 are about. Checking
 * at the object level, after both fields have parsed, cannot have that hole.
 *
 * Cash needs no reference (there is no external system to reference), which is
 * why the field stays optional at the field level.
 */
export const recordTransferSchema = z
  .object({
    paymentMode: disbursementPaymentModeSchema,
    /**
     * Compared against the sanctioned amount, never used as the amount.
     * Scenario 6 rejects a mismatch; the server posts the sanctioned figure.
     */
    amountPaise: positivePaise("Amount"),
    transactionReference: optionalText(150).pipe(
      transactionReferenceSchema.optional(),
    ),
    transferDate: isoDateSchema("Transfer Date"),
    expectedVersion: expectedVersionSchema,
  })
  .superRefine((value, ctx) => {
    const needsReference =
      value.paymentMode === "BANK_TRANSFER" || value.paymentMode === "UPI";

    if (needsReference && !value.transactionReference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transactionReference"],
        message: "Transaction Reference is required for a bank transfer",
      });
    }
  });

/**
 * Confirm the disbursement — the irreversible one.
 *
 * `idempotencyKey` is client-minted and required. It is what makes a retried
 * confirmation return the original result rather than move money twice
 * (Scenarios 28, 46), and it must be minted once per form rather than per
 * submit: a key regenerated on retry defeats the entire mechanism.
 */
export const confirmDisbursementSchema = z.object({
  idempotencyKey: z.string().uuid(),
  expectedVersion: expectedVersionSchema,
});

/** Record that the transfer failed (Scenario 26). Retryable afterwards. */
export const failDisbursementSchema = z.object({
  failureReason: z
    .string({
      required_error: "Failure Reason is required",
      invalid_type_error: "Failure Reason is required",
    })
    .trim()
    .min(1, "Failure Reason is required")
    .max(1000, "Failure Reason must be 1000 characters or fewer"),
  expectedVersion: expectedVersionSchema,
});

/**
 * Cancel a scheduled disbursement before any transfer (Scenario 37).
 *
 * A reason is mandatory: cancelling is the one path that ends a disbursement
 * without money moving, and the record has to say why. The row is never
 * deleted — Rules 30 and 31 forbid removing a financial record, and the
 * completed case is refused outright by the service.
 */
export const cancelDisbursementSchema = z.object({
  cancellationReason: z
    .string({
      required_error: "Cancellation Reason is required",
      invalid_type_error: "Cancellation Reason is required",
    })
    .trim()
    .min(1, "Cancellation Reason is required")
    .max(1000, "Cancellation Reason must be 1000 characters or fewer"),
  expectedVersion: expectedVersionSchema,
});

/**
 * The disbursal list filter.
 *
 * Deliberately has no `branchId`. A caller's branch comes from the JWT, and the
 * absence of the parameter is what makes Scenario 3 structural rather than a
 * check the list query has to remember — exactly as in `loans.ts`.
 */
export const listDisbursementsSchema = z.object({
  search: optionalText(120),
  status: disbursementStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type ScheduleDisbursementInput = z.infer<
  typeof scheduleDisbursementSchema
>;
export type UpdateDisbursementScheduleInput = z.infer<
  typeof updateDisbursementScheduleSchema
>;
export type RecordTransferInput = z.infer<typeof recordTransferSchema>;
export type ConfirmDisbursementInput = z.infer<
  typeof confirmDisbursementSchema
>;
export type FailDisbursementInput = z.infer<typeof failDisbursementSchema>;
export type CancelDisbursementInput = z.infer<typeof cancelDisbursementSchema>;
export type ListDisbursementsInput = z.infer<typeof listDisbursementsSchema>;
