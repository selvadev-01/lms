import { z } from "zod";

import { expectedVersionSchema, positivePaise } from "./loans";
import { optionsFrom } from "./options";
import { isoDateSchema, optionalText } from "./primitives";

/**
 * Module 11 schemas — EMI collection.
 *
 * Same cycle-avoiding rule as `disbursements.ts`: imports reach `./loans`,
 * `./options` and `./primitives` directly, never `./index`.
 *
 * Three things are specific to this module.
 *
 * **Nothing that decides scope or money is accepted from the client.** There is
 * no `branchId`, `customerId`, `collectorUserId`, `receiptNumber` or allocation
 * field in any schema here. Branch and customer come from the loan, the
 * collector from the JWT, the receipt from the server's sequence, and the
 * allocation from the server's own recomputation. Their absence, plus the API's
 * `forbidNonWhitelisted`, is what makes Scenarios 37, 38 and 39 structural
 * rather than a check somebody has to remember to write.
 *
 * **There is no `expectedVersion` on posting.** A collection is created and
 * posted in one act, so there is no prior row for the request to be stale
 * against. The loan's state is re-read inside the transaction instead. Reversal
 * does carry one, because there the collection row exists.
 *
 * **These schemas run in the browser.** They are not what guards the API — the
 * DTOs are, and the two are deliberately kept in step. A rule written only here
 * is enforced only here.
 */

/**
 * How the money was tendered.
 *
 * Mirrors the Prisma `PaymentMode` enum exactly. The message is on the enum
 * rather than a `.min(1)` because an absent select posts `""`, which fails the
 * enum rather than any length rule.
 */
export const collectionPaymentModeSchema = z.enum(
  ["CASH", "UPI", "BANK_TRANSFER"],
  {
    errorMap: () => ({ message: "Payment Mode is required" }),
  },
);

export const collectionStatusSchema = z.enum([
  "CREATED",
  "SYNCED",
  "POSTED",
  "REVERSED",
  "FAILED",
]);

export const COLLECTION_PAYMENT_MODE_OPTIONS = optionsFrom(
  collectionPaymentModeSchema.options,
  {
    CASH: "Cash",
    UPI: "UPI",
    BANK_TRANSFER: "Bank transfer",
  },
);

export const COLLECTION_STATUS_OPTIONS = optionsFrom(
  collectionStatusSchema.options,
  {
    CREATED: "Created",
    SYNCED: "Synced",
    POSTED: "Posted",
    REVERSED: "Reversed",
    FAILED: "Failed",
  },
);

/**
 * The payer's own reference for a non-cash payment — a UTR, a UPI reference.
 *
 * Same shape as disbursal's `transactionReference`: bounded, and restricted to
 * characters that survive a receipt, a CSV export and a bank statement without
 * needing to be escaped.
 */
const collectionReferenceSchema = z
  .string()
  .trim()
  .max(150, "Payment Reference is too long")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9/_-]*$/,
    "Payment Reference may use letters, numbers, hyphens, underscores and slashes",
  );

/** The modes that settle through a bank and therefore carry a reference. */
const MODES_REQUIRING_REFERENCE = ["UPI", "BANK_TRANSFER"] as const;

/**
 * The money a client sends, and nothing else.
 *
 * `amountPaise` is an integer-paise digit string, never a number:
 * `z.coerce.number()` would round `"1000.50"` silently rather than fail, and a
 * rounded paisa is a real financial error.
 */
const collectionBodyShape = {
  // `required_error` as well as the `.uuid()` message: the latter fires only on
  // a malformed value, so an absent field would otherwise fall through to zod's
  // default "Required" and lose the message the source specifies.
  loanId: z
    .string({
      required_error: "Loan is required",
      invalid_type_error: "Loan is required",
    })
    .uuid("Loan is required"),
  collectionDate: isoDateSchema("Collection Date"),
  paymentMode: collectionPaymentModeSchema,
  amountPaise: positivePaise("Collected Amount"),
  transactionReference: optionalText(150).pipe(
    collectionReferenceSchema.optional(),
  ),
  /**
   * Client-minted, and required (Rule 7).
   *
   * It must be minted once per form *mount*, not per submit: a key regenerated
   * on retry defeats the entire mechanism, because the retry then looks like a
   * different payment and posts a second time.
   */
  idempotencyKey: z
    .string({
      required_error: "Idempotency Key is required",
      invalid_type_error: "Idempotency Key is required",
    })
    .uuid("Idempotency Key is required"),
  notes: optionalText(1000),
};

/**
 * Requires a payment reference for the modes that settle through a bank
 * (Scenario 45).
 *
 * An object-level refinement rather than a field-level `@ValidateIf`-style
 * conditional, for the reason `recordTransferSchema` documents: a conditional
 * attached to the field itself skips the presence check entirely when the
 * condition is false, so a missing value passes silently. Checking at the object
 * level sees both fields at once and cannot.
 */
export function requireReferenceForBankModes(
  value: { paymentMode: string; transactionReference?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  const needsReference = (
    MODES_REQUIRING_REFERENCE as readonly string[]
  ).includes(value.paymentMode);

  if (needsReference && !value.transactionReference) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transactionReference"],
      message: "Payment Reference is required for this payment mode",
    });
  }
}

/** Record and post a collection in one act. */
export const postCollectionSchema = z
  .object(collectionBodyShape)
  .superRefine(requireReferenceForBankModes);

/**
 * Ask what a given amount would settle, without posting anything.
 *
 * Computed server-side even though `@lms/emi` is importable in the browser: the
 * preview has to agree with what posting will actually do, and the only way to
 * guarantee that is for both to run the same code against the same
 * server-held balances.
 */
export const previewAllocationSchema = z.object({
  loanId: z
    .string({
      required_error: "Loan is required",
      invalid_type_error: "Loan is required",
    })
    .uuid("Loan is required"),
  amountPaise: positivePaise("Collected Amount"),
});

/**
 * Reverse a posted collection.
 *
 * Full reversal only — there is no amount here. A partial reversal needs
 * per-component unwind arithmetic and a remaining-reversible concept, and half
 * of that built is worse than none.
 */
export const reverseCollectionSchema = z.object({
  reversalReason: z
    .string({
      required_error: "Reversal Reason is required",
      invalid_type_error: "Reversal Reason is required",
    })
    .trim()
    .min(1, "Reversal Reason is required")
    .max(1000, "Reversal Reason is too long"),
  expectedVersion: expectedVersionSchema,
});

/**
 * Sync a collection captured offline.
 *
 * Extends the online body with the device's identity. Module 11 owns this
 * contract; the device-side queue that produces it is Module 12's.
 *
 * `collectedAt` is when the device says it took the money. It is retained
 * because it is genuinely useful evidence, and it is never authoritative: the
 * business date comes from the server's Asia/Kolkata clock (Rules 34, 35). A
 * client that backdates this changes what the receipt records, not what the
 * ledger posts.
 */
export const syncCollectionSchema = z
  .object({
    ...collectionBodyShape,
    offlineTransactionUuid: z
      .string()
      .uuid("A stable offline transaction id is required"),
    deviceId: z
      .string({
        required_error: "Device id is required",
        invalid_type_error: "Device id is required",
      })
      .trim()
      .min(1, "Device id is required")
      .max(150, "Device id is too long"),
    collectedAt: z
      .string()
      .datetime({ offset: true, message: "Captured time must be a timestamp" }),
  })
  .superRefine(requireReferenceForBankModes);

/**
 * The collection list filter.
 *
 * No `branchId`: a Branch Admin's scope comes from their session, and accepting
 * one here would mean the server had to decide whether to believe it
 * (Scenario 1).
 */
export const listCollectionsSchema = z.object({
  search: optionalText(120),
  status: collectionStatusSchema.optional(),
  loanId: z.string().uuid().optional(),
  fromDate: optionalText(10).pipe(isoDateSchema("From Date").optional()),
  toDate: optionalText(10).pipe(isoDateSchema("To Date").optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PostCollectionInput = z.infer<typeof postCollectionSchema>;
export type PreviewAllocationInput = z.infer<typeof previewAllocationSchema>;
export type ReverseCollectionInput = z.infer<typeof reverseCollectionSchema>;
export type SyncCollectionInput = z.infer<typeof syncCollectionSchema>;
export type ListCollectionsInput = z.infer<typeof listCollectionsSchema>;
