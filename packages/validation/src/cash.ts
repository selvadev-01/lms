import { z } from "zod";

import { expectedVersionSchema, positivePaise } from "./loans";
import { optionsFrom } from "./options";
import { isoDateSchema, optionalText } from "./primitives";

/**
 * Module 12 schemas — cash handover and reconciliation.
 *
 * Same cycle-avoiding rule as the rest: imports reach `./loans`, `./options`
 * and `./primitives` directly, never `./index`.
 *
 * # The two halves of one transfer
 *
 * A handover moves cash custody from an agent to a branch, and it is
 * deliberately two authorities and two schemas: the agent submits
 * (`submitCashHandoverSchema`) and the branch receives
 * (`receiveCashHandoverSchema`). One schema with a status field would let one
 * person do both, which is the control this module exists to provide.
 *
 * # What is absent, and why that is the point
 *
 * No `branchId` and no `fieldAgentId` anywhere. The branch is derived from the
 * agent's own branch and the agent from the JWT, so a client cannot hand cash
 * to a branch it does not belong to (Scenarios 46, 48). No `expectedCashPaise`
 * either: the expected balance is *derived* server-side from posted collections
 * minus claimed ones (Rule 24), and accepting a client's arithmetic would make
 * the whole reconciliation circular — the system would be checking the client's
 * number against the client's number.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * The handover lifecycle.
 *
 * `CANCELLED` and `REVERSED` are not in the source's four-state diagram. They
 * are added because the diagram has no terminal failure state, and without them
 * an agent who drafted a handover in error would have to submit it and a branch
 * that received cash in error would have no way to say so (Scenario 53).
 */
export const cashHandoverStatusSchema = z.enum([
  "CREATED",
  "SUBMITTED",
  "RECEIVED",
  "RECONCILED",
  "CANCELLED",
  "REVERSED",
]);

export const CASH_HANDOVER_STATUS_OPTIONS = optionsFrom(
  cashHandoverStatusSchema.options,
  {
    CREATED: "Draft",
    SUBMITTED: "Awaiting branch",
    RECEIVED: "Received",
    RECONCILED: "Reconciled",
    CANCELLED: "Cancelled",
    REVERSED: "Reversed",
  },
);

/**
 * The reconciliation lifecycle, flattened.
 *
 * The source draws `RECONCILED` as a parent with `MATCHED` and
 * `DISCREPANCY_PENDING` beneath it. Persisted as a parent plus a child, every
 * query filters on two columns and a row can hold an incoherent pair —
 * `PENDING` alongside `MATCHED`. One four-value enum cannot express the
 * incoherent state at all, so `RECONCILED` is not a persisted value.
 *
 * `PENDING` exists for Scenario 54: a reconciliation whose expected balance
 * could not be derived is not finalised, and must stay visible for retry
 * rather than silently becoming a match.
 */
export const cashReconciliationStatusSchema = z.enum([
  "PENDING",
  "MATCHED",
  "DISCREPANCY_PENDING",
  "RESOLVED",
]);

export const CASH_RECONCILIATION_STATUS_OPTIONS = optionsFrom(
  cashReconciliationStatusSchema.options,
  {
    PENDING: "Pending",
    MATCHED: "Matched",
    DISCREPANCY_PENDING: "Discrepancy pending",
    RESOLVED: "Resolved",
  },
);

/**
 * What kind of discrepancy this is.
 *
 * Six values, answering the source's own list. `SHORTAGE` and `EXCESS` are the
 * arithmetic cases; the other four describe *why* the count came out wrong and
 * are what makes a shortage caused by a counterfeit note distinguishable from
 * one caused by theft. Rule 34 forbids silent auto-correction, and a single
 * "difference" with no cause is how a system ends up silently correcting.
 */
export const cashDiscrepancyTypeSchema = z.enum([
  "SHORTAGE",
  "EXCESS",
  "COUNTERFEIT",
  "DAMAGED_NOTES",
  "DISPUTED_COLLECTION",
  "OTHER",
]);

export const CASH_DISCREPANCY_TYPE_OPTIONS = optionsFrom(
  cashDiscrepancyTypeSchema.options,
  {
    SHORTAGE: "Shortage",
    EXCESS: "Excess",
    COUNTERFEIT: "Counterfeit notes",
    DAMAGED_NOTES: "Damaged notes",
    DISPUTED_COLLECTION: "Disputed collection",
    OTHER: "Other",
  },
);

/**
 * What was decided about the difference.
 *
 * None of these post a journal. Rule 36 and Scenario 29 both say an accounting
 * adjustment "follows a separately authorized financial rule" — Module 14's
 * manual journal is that rule, and `approvalReference` below is where its entry
 * number is recorded. These values say what was decided, not what was posted.
 */
export const cashDiscrepancyResolutionSchema = z.enum([
  "RECOVERED_FROM_AGENT",
  "WRITTEN_OFF",
  "ADJUSTED_NEXT_HANDOVER",
  "ESCALATED",
  "NO_ACTION",
]);

export const CASH_DISCREPANCY_RESOLUTION_OPTIONS = optionsFrom(
  cashDiscrepancyResolutionSchema.options,
  {
    RECOVERED_FROM_AGENT: "Recovered from agent",
    WRITTEN_OFF: "Written off",
    ADJUSTED_NEXT_HANDOVER: "Adjusted against next handover",
    ESCALATED: "Escalated",
    NO_ACTION: "No action",
  },
);

// ---------------------------------------------------------------------------
// Cash handover
// ---------------------------------------------------------------------------

/**
 * Create a draft handover.
 *
 * `handedOverCashPaise` is the only money the agent supplies, and it must equal
 * the sum of some oldest-first prefix of their unclaimed collections — the
 * server refuses any other amount. That constraint is not expressible here (it
 * depends on server-held balances), so it is enforced at the API; this schema
 * only guarantees the value is a positive integer-paise digit string.
 *
 * No `businessDate`: the server's Asia/Kolkata date is authoritative and
 * backdating is not permitted (Rule 15).
 */
export const createCashHandoverSchema = z.object({
  handedOverCashPaise: positivePaise("Cash Handed Over"),
  notes: optionalText(1000),
  /**
   * Client-minted, and required.
   *
   * Minted once per form *mount*, never per submit: a key regenerated on retry
   * defeats the mechanism entirely, because the retry then looks like a second
   * handover and opens a second custody transfer.
   */
  idempotencyKey: z
    .string({
      required_error: "Idempotency Key is required",
      invalid_type_error: "Idempotency Key is required",
    })
    .uuid("Idempotency Key is required"),
});

/**
 * Submit a draft for the branch to receive.
 *
 * Carries only a version. The amount was fixed at creation and re-deriving the
 * agent's balance is the server's job at submit time — letting the amount
 * change here would mean the balance check ran against one number and the
 * custody claim against another.
 */
export const submitCashHandoverSchema = z.object({
  acknowledgmentReference: optionalText(150),
  expectedVersion: expectedVersionSchema,
});

/**
 * Receive the cash at the branch — the act that posts the custody journal.
 *
 * `receivedCashPaise` is what the branch actually counted, which is not
 * necessarily what the agent said they were handing over. Recording the counted
 * figure separately is what lets the difference be non-zero and traceable
 * instead of assumed away (Scenario 24).
 *
 * The idempotency key for this act travels as an `Idempotency-Key` **header**,
 * not a body field, because it identifies a retry of an operation against a row
 * that already exists. That is the same split Module 14 draws between creating
 * a journal and posting one.
 */
export const receiveCashHandoverSchema = z.object({
  receivedCashPaise: positivePaise("Cash Received"),
  notes: optionalText(1000),
  expectedVersion: expectedVersionSchema,
});

/**
 * Reverse a received handover.
 *
 * Full reversal only, matching Module 11's stance: a partial reversal needs a
 * per-collection unwind and a remaining-reversible concept, and half of that
 * built is worse than none.
 */
export const reverseCashHandoverSchema = z.object({
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

export const listCashHandoversSchema = z.object({
  search: optionalText(120),
  status: cashHandoverStatusSchema.optional(),
  fromDate: optionalText(10).pipe(isoDateSchema("From Date").optional()),
  toDate: optionalText(10).pipe(isoDateSchema("To Date").optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Cash reconciliation
// ---------------------------------------------------------------------------

/**
 * Count the cash and record the result.
 *
 * `actualCashPaise` is the physical count and the only figure supplied. The
 * expected side is copied from the handover the server already recorded, and
 * the difference is computed from the two — a client-supplied difference would
 * let a reconciliation assert a match it had not actually counted.
 *
 * Note this uses `positivePaise` rather than an allow-zero variant. A count of
 * zero against a received handover means the cash vanished entirely between
 * receipt and count, which is an incident to raise rather than a reconciliation
 * to file.
 */
export const createReconciliationSchema = z.object({
  handoverId: z
    .string({
      required_error: "Handover is required",
      invalid_type_error: "Handover is required",
    })
    .uuid("Handover is required"),
  actualCashPaise: positivePaise("Actual Cash Counted"),
  notes: optionalText(1000),
  idempotencyKey: z
    .string({
      required_error: "Idempotency Key is required",
      invalid_type_error: "Idempotency Key is required",
    })
    .uuid("Idempotency Key is required"),
});

/**
 * Resolve a pending shortage or excess.
 *
 * Every field except the notes is required, because Rule 35 says a discrepancy
 * "requires a recorded reason and an authorized resolution" and an optional
 * reason is how that becomes a blank one.
 *
 * `approvalReference` is where a Module 14 journal entry number goes when the
 * resolution needed an accounting adjustment. It is optional because several
 * resolutions legitimately post nothing — `NO_ACTION` and `ESCALATED` most
 * obviously.
 */
export const resolveDiscrepancySchema = z.object({
  discrepancyType: cashDiscrepancyTypeSchema,
  discrepancyReason: z
    .string({
      required_error: "Reason is required",
      invalid_type_error: "Reason is required",
    })
    .trim()
    .min(1, "Reason is required")
    .max(1000, "Reason is too long"),
  resolutionAction: cashDiscrepancyResolutionSchema,
  resolutionNotes: optionalText(1000),
  approvalReference: optionalText(150),
  expectedVersion: expectedVersionSchema,
});

export const listReconciliationsSchema = z.object({
  search: optionalText(120),
  status: cashReconciliationStatusSchema.optional(),
  discrepancyType: cashDiscrepancyTypeSchema.optional(),
  fromDate: optionalText(10).pipe(isoDateSchema("From Date").optional()),
  toDate: optionalText(10).pipe(isoDateSchema("To Date").optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Offline sync queue
// ---------------------------------------------------------------------------

/**
 * The device's report that it is holding a captured collection.
 *
 * This is not the collection itself — syncing that is
 * `syncFieldCollectionSchema`. This records that a device *has* one queued, so
 * an operator can see unflushed work and drive a retry. `clientTransactionId`
 * is the device's own stable id and is unique per organization, which makes
 * re-reporting the same item idempotent for free.
 */
export const enqueueSyncItemSchema = z.object({
  clientTransactionId: z
    .string({
      required_error: "Client Transaction Id is required",
      invalid_type_error: "Client Transaction Id is required",
    })
    .trim()
    .min(1, "Client Transaction Id is required")
    .max(150, "Client Transaction Id is too long"),
  entityType: z
    .string({
      required_error: "Entity Type is required",
      invalid_type_error: "Entity Type is required",
    })
    .trim()
    .min(1, "Entity Type is required")
    .max(50, "Entity Type is too long"),
  payload: z.record(z.unknown()),
  queuedAt: z
    .string()
    .datetime({ offset: true, message: "Queued time must be a timestamp" }),
});

export const listSyncItemsSchema = z.object({
  status: z
    .enum(["QUEUED", "SYNCING", "SYNCED", "FAILED", "CONFLICT"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CashHandoverStatus = z.infer<typeof cashHandoverStatusSchema>;
export type CashReconciliationStatus = z.infer<
  typeof cashReconciliationStatusSchema
>;
export type CashDiscrepancyType = z.infer<typeof cashDiscrepancyTypeSchema>;
export type CashDiscrepancyResolution = z.infer<
  typeof cashDiscrepancyResolutionSchema
>;
export type CreateCashHandoverInput = z.infer<typeof createCashHandoverSchema>;
export type SubmitCashHandoverInput = z.infer<typeof submitCashHandoverSchema>;
export type ReceiveCashHandoverInput = z.infer<
  typeof receiveCashHandoverSchema
>;
export type ReverseCashHandoverInput = z.infer<
  typeof reverseCashHandoverSchema
>;
export type ListCashHandoversInput = z.infer<typeof listCashHandoversSchema>;
export type CreateReconciliationInput = z.infer<
  typeof createReconciliationSchema
>;
export type ResolveDiscrepancyInput = z.infer<typeof resolveDiscrepancySchema>;
export type ListReconciliationsInput = z.infer<
  typeof listReconciliationsSchema
>;
export type EnqueueSyncItemInput = z.infer<typeof enqueueSyncItemSchema>;
export type ListSyncItemsInput = z.infer<typeof listSyncItemsSchema>;
