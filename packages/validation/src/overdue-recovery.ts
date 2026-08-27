import { z } from "zod";

import { gpsCaptureStatusSchema } from "./field-collections";
import { expectedVersionSchema, positivePaise } from "./loans";
import { optionsFrom } from "./options";
import { idSchema, isoDateSchema, optionalText } from "./primitives";

/**
 * Module 13 schemas — overdue identification and recovery.
 *
 * Same cycle-avoiding rule as the rest: imports reach `./loans`, `./options`
 * and `./primitives` directly, never `./index`.
 *
 * # Why the file is not called `recovery.ts`
 *
 * `recovery.test.ts` in this directory already means *password* recovery — the
 * forgot-password and OTP flow of Module 01. Two unrelated domains sharing a
 * filename would make every future search for "the recovery schema" ambiguous,
 * so this one is named for both halves of what it covers.
 *
 * # What is absent, and why that is the point
 *
 * **No overdue schema at all.** Days past due, the ageing bucket, the NPA
 * classification and the four overdue component totals are *derived* server-side
 * from the authoritative schedule and the Asia/Kolkata business date (Rule 4).
 * There is nothing for a client to submit and nothing to validate: accepting a
 * client's overdue figure would let a device's clock decide whether a borrower
 * is late, which is exactly what Rule 14 forbids.
 *
 * **No `branchId` and no `organizationId` on any schema here.** Both come from
 * the JWT and are applied server-side, so a client cannot address another
 * branch's case (Scenarios 45, 46, 47). `main.ts` runs
 * `forbidNonWhitelisted`, so an attempt is a 400 rather than a silent ignore.
 *
 * **No `totalOverduePaise` on the closure schema.** The outstanding figure at
 * closure is read from the loan inside the closing transaction, not accepted
 * from the form — a client that could name what it was closing out could close
 * a case against a figure that was never true.
 *
 * # GPS capture status is imported, not redeclared
 *
 * `gpsCaptureStatusSchema` comes from `./field-collections` rather than being
 * defined again here. It is deliberately narrower than the database enum — a
 * client may claim `VERIFIED`, `FAILED` or `PENDING`, but never `EXPIRED` or
 * `CANCELLED`, because a client that can name any outcome can name a
 * flattering one. That reasoning applies identically to a recovery visit, and a
 * second, wider copy in this file would be a hole in the same control.
 *
 * # Promise to pay is not a payment
 *
 * `recordRecoveryActionSchema` carries a promise amount and date, and recording
 * one moves no money and reduces no balance (Rule 15, Scenario 15). The payment
 * it promises, if it arrives, goes through Module 11's collection schema like
 * every other repayment. There is deliberately no payment schema in this file.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const recoveryCaseStatusSchema = z.enum([
  "OPEN",
  "FIELD_ASSIGNED",
  "FIELD_VISIT",
  "BRANCH_REVIEW",
  "LEGAL_NOTICE",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "LEGAL_ACTION",
  "CLOSED",
]);

export const RECOVERY_CASE_STATUS_OPTIONS = optionsFrom(
  recoveryCaseStatusSchema.options,
  {
    OPEN: "Open",
    FIELD_ASSIGNED: "Field assigned",
    FIELD_VISIT: "Field visit",
    BRANCH_REVIEW: "Branch review",
    LEGAL_NOTICE: "Legal notice",
    SETTLEMENT_PENDING: "Settlement pending",
    SETTLED: "Settled",
    LEGAL_ACTION: "Legal action",
    CLOSED: "Closed",
  },
);

export const recoveryActionTypeSchema = z.enum([
  "REMINDER",
  "PHONE_CALL",
  "FIELD_ASSIGNMENT",
  "FIELD_VISIT",
  "BRANCH_REVIEW",
  "LEGAL_NOTICE",
  "SETTLEMENT",
  "LEGAL_ACTION",
]);

export const RECOVERY_ACTION_TYPE_OPTIONS = optionsFrom(
  recoveryActionTypeSchema.options,
  {
    REMINDER: "Reminder",
    PHONE_CALL: "Phone call",
    FIELD_ASSIGNMENT: "Field assignment",
    FIELD_VISIT: "Field visit",
    BRANCH_REVIEW: "Branch review",
    LEGAL_NOTICE: "Legal notice",
    SETTLEMENT: "Settlement",
    LEGAL_ACTION: "Legal action",
  },
);

/**
 * What came of a contact attempt.
 *
 * Separate from the action type because the two answer different questions —
 * what the officer did, and what happened. Collapsing them would make "phoned,
 * no answer" and "phoned, promised to pay" the same record (Scenario 13).
 */
export const recoveryOutcomeSchema = z.enum([
  "CONTACTED_PROMISED",
  "CONTACTED_REFUSED",
  "CONTACTED_DISPUTED",
  "CONTACTED_PARTIAL_PAYMENT",
  "NO_ANSWER",
  "UNREACHABLE",
  "WRONG_CONTACT",
  "CUSTOMER_UNAVAILABLE",
  "ESCALATION_REQUIRED",
  "RESOLVED",
]);

export const RECOVERY_OUTCOME_OPTIONS = optionsFrom(
  recoveryOutcomeSchema.options,
  {
    CONTACTED_PROMISED: "Contacted — promised to pay",
    CONTACTED_REFUSED: "Contacted — refused",
    CONTACTED_DISPUTED: "Contacted — disputed the debt",
    CONTACTED_PARTIAL_PAYMENT: "Contacted — paid in part",
    NO_ANSWER: "No answer",
    UNREACHABLE: "Unreachable",
    WRONG_CONTACT: "Wrong contact details",
    CUSTOMER_UNAVAILABLE: "Customer unavailable",
    ESCALATION_REQUIRED: "Escalation required",
    RESOLVED: "Resolved",
  },
);

export const recoveryPrioritySchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const RECOVERY_PRIORITY_OPTIONS = optionsFrom(
  recoveryPrioritySchema.options,
  {
    LOW: "Low",
    MEDIUM: "Medium",
    HIGH: "High",
    CRITICAL: "Critical",
  },
);

export const delinquencyBucketSchema = z.enum([
  "CURRENT",
  "DPD_1_30",
  "DPD_31_60",
  "DPD_61_90",
  "DPD_91_180",
  "DPD_180_PLUS",
]);

export const DELINQUENCY_BUCKET_OPTIONS = optionsFrom(
  delinquencyBucketSchema.options,
  {
    CURRENT: "Current",
    DPD_1_30: "1–30 days",
    DPD_31_60: "31–60 days",
    DPD_61_90: "61–90 days",
    DPD_91_180: "91–180 days",
    DPD_180_PLUS: "180+ days",
  },
);

export const npaStatusSchema = z.enum([
  "STANDARD",
  "SPECIAL_MENTION",
  "SUB_STANDARD",
  "DOUBTFUL",
  "LOSS",
]);

export const NPA_STATUS_OPTIONS = optionsFrom(npaStatusSchema.options, {
  STANDARD: "Standard",
  SPECIAL_MENTION: "Special mention",
  SUB_STANDARD: "Sub-standard",
  DOUBTFUL: "Doubtful",
  LOSS: "Loss",
});

export const recoveryResolutionTypeSchema = z.enum([
  "RECOVERED_FULL",
  "RECOVERED_PARTIAL",
  "SETTLED",
  "WRITTEN_OFF",
  "RESTRUCTURED",
  "LEGAL_ACTION",
  "NOT_RECOVERABLE",
]);

export const RECOVERY_RESOLUTION_TYPE_OPTIONS = optionsFrom(
  recoveryResolutionTypeSchema.options,
  {
    RECOVERED_FULL: "Recovered in full",
    RECOVERED_PARTIAL: "Recovered in part",
    SETTLED: "Settled",
    WRITTEN_OFF: "Written off",
    RESTRUCTURED: "Restructured",
    LEGAL_ACTION: "Legal action",
    NOT_RECOVERABLE: "Not recoverable",
  },
);

export const settlementStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
]);

export const SETTLEMENT_STATUS_OPTIONS = optionsFrom(
  settlementStatusSchema.options,
  {
    DRAFT: "Draft",
    PENDING_APPROVAL: "Awaiting approval",
    APPROVED: "Approved",
    COMPLETED: "Completed",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
  },
);

// ---------------------------------------------------------------------------
// Recovery cases
// ---------------------------------------------------------------------------

/**
 * Opening a case against an overdue loan.
 *
 * The loan is named and nothing else about the debt is: the branch, the
 * customer, the overdue totals and the opening date all come from the loan and
 * the server's business date. A form that could set its own opened date could
 * backdate a case out of an ageing report.
 *
 * `idempotencyKey` is minted once per form mount, not per submit, so a
 * double-click returns the first case rather than opening a second.
 */
export const openRecoveryCaseSchema = z.object({
  loanId: idSchema,
  priority: recoveryPrioritySchema.default("MEDIUM"),
  notes: optionalText(2000),
  idempotencyKey: z.string().uuid(),
});

/**
 * Assigning or reassigning a case.
 *
 * One schema for both, unlike Module 12's deliberate submit/receive split: the
 * act is identical and the difference — whether anyone held the case before —
 * is a fact the server already knows. Two schemas would let a caller assert it
 * was a first assignment when it was not.
 *
 * `expectedVersion` is what makes Scenario 12 work: two users who open the same
 * case and both assign it cannot both win.
 */
export const assignRecoveryCaseSchema = z.object({
  assigneeUserId: idSchema,
  reason: optionalText(500),
  expectedVersion: expectedVersionSchema,
});

/**
 * Escalating an unresolved case.
 *
 * The reason is required rather than optional: Scenario 38 requires the
 * escalation event *and its reason* be recorded, and an optional field is one
 * nobody fills in.
 */
export const escalateRecoveryCaseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Escalation reason is required")
    .max(2000, "Escalation reason must be 2000 characters or fewer"),
  expectedVersion: expectedVersionSchema,
});

/**
 * Closing a case.
 *
 * Carries the resolution type and reason and **no money at all**. What was
 * outstanding, what was recovered and what remains are read from the loan
 * inside the closing transaction (Scenario 39) — a form that named them could
 * close a case against figures that were never true.
 */
export const closeRecoveryCaseSchema = z.object({
  resolutionType: recoveryResolutionTypeSchema,
  closureReason: z
    .string()
    .trim()
    .min(1, "Closure reason is required")
    .max(2000, "Closure reason must be 2000 characters or fewer"),
  approvalReference: optionalText(150),
  expectedVersion: expectedVersionSchema,
});

// ---------------------------------------------------------------------------
// Recovery actions
// ---------------------------------------------------------------------------

/**
 * Recording a contact attempt, visit, follow-up or promise.
 *
 * # The two cross-field rules
 *
 * Both are `superRefine` rather than field-level checks because each depends on
 * two fields at once, and neither can be expressed by making a field required.
 *
 *  1. A promise is an amount **and** a date, or neither. Half a promise cannot
 *     be followed up or checked against a payment, so it is not a promise
 *     (Scenario 15). The database holds the same rule as a CHECK, because a
 *     rule enforced only here applies only to callers who came through the web.
 *  2. A `FAILED` GPS capture must not carry a check-in reference, and a
 *     `VERIFIED` one must. Rule 40 and Scenario 30: synchronization must never
 *     turn a failure into a success, and a failed capture that pointed at a
 *     verified check-in would be doing exactly that.
 *
 * **If this schema is ever extended, re-apply the refinements.** `.innerType()`
 * silently drops `superRefine`, so an extended schema stops enforcing both
 * rules while still type-checking. That has bitten this codebase before.
 */
export const recordRecoveryActionSchema = z
  .object({
    actionType: recoveryActionTypeSchema,
    actionDate: isoDateSchema("Action Date"),
    outcome: recoveryOutcomeSchema,
    notes: optionalText(4000),
    nextFollowUpDate: isoDateSchema("Next Follow-up Date").optional(),
    promiseToPayDate: isoDateSchema("Promise-to-Pay Date").optional(),
    promiseToPayAmountPaise: positivePaise("Promise-to-Pay Amount").optional(),

    // Field evidence. All optional: a phone call has no GPS and no
    // acknowledgment, and requiring them would make the commonest action the
    // hardest to record.
    offlineActivityUuid: z.string().uuid().optional(),
    deviceId: optionalText(150),
    gpsCaptureStatus: gpsCaptureStatusSchema.optional(),
    gpsCheckInId: idSchema.optional(),
    customerAckReference: optionalText(150),
  })
  .superRefine((value, ctx) => {
    const hasDate = value.promiseToPayDate !== undefined;
    const hasAmount = value.promiseToPayAmountPaise !== undefined;

    if (hasDate !== hasAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasDate ? "promiseToPayAmountPaise" : "promiseToPayDate"],
        message:
          "A promise to pay needs both an amount and a date. Record both, or neither.",
      });
    }

    if (value.gpsCaptureStatus === "FAILED" && value.gpsCheckInId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gpsCheckInId"],
        message:
          "A failed GPS capture cannot cite a verified check-in. Record the failure as it happened.",
      });
    }

    if (value.gpsCaptureStatus === "VERIFIED" && !value.gpsCheckInId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gpsCheckInId"],
        message: "A verified GPS capture must cite the check-in it came from.",
      });
    }
  });

/**
 * Editing a pending action (Scenario 31).
 *
 * Deliberately not `recordRecoveryActionSchema.partial()`: that would go through
 * `.innerType()` and drop both refinements above, so an edit could split a
 * promise in half or promote a failed GPS capture — precisely the two things
 * the refinements exist to stop. The fields are restated and the rules
 * re-applied.
 *
 * The action type is absent: changing what an officer did is not an edit, it is
 * a different action, and Scenario 32 requires a follow-up rather than a rewrite.
 */
export const updateRecoveryActionSchema = z
  .object({
    outcome: recoveryOutcomeSchema.optional(),
    notes: optionalText(4000),
    nextFollowUpDate: isoDateSchema("Next Follow-up Date").optional(),
    promiseToPayDate: isoDateSchema("Promise-to-Pay Date").optional(),
    promiseToPayAmountPaise: positivePaise("Promise-to-Pay Amount").optional(),
    expectedVersion: expectedVersionSchema,
  })
  .superRefine((value, ctx) => {
    const hasDate = value.promiseToPayDate !== undefined;
    const hasAmount = value.promiseToPayAmountPaise !== undefined;

    if (hasDate !== hasAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasDate ? "promiseToPayAmountPaise" : "promiseToPayDate"],
        message:
          "A promise to pay needs both an amount and a date. Record both, or neither.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Penalties
// ---------------------------------------------------------------------------

/**
 * Assessing penal interest.
 *
 * Carries **no amount**. The figure comes from the configured rule and the
 * authoritative balances and dates (Rule 12, Scenario 18); accepting one from
 * the client would let a form decide what a borrower is charged, and would make
 * the "deterministic and replayable" guarantee meaningless.
 *
 * `asOfDate` is optional and, when given, is validated server-side against the
 * business date — it exists so an assessment can be replayed for a past date
 * during investigation, not so a caller can charge into the future.
 */
export const assessPenaltySchema = z.object({
  loanId: idSchema,
  emiId: idSchema.optional(),
  asOfDate: isoDateSchema("As-of Date").optional(),
  idempotencyKey: z.string().uuid(),
});

/**
 * Waiving or adjusting an assessed penalty (Scenario 20).
 *
 * A reason is required. Forgiving a charge is the act most in need of an
 * explanation, and the original posting is preserved either way — this records
 * a decision, it does not edit history.
 */
export const penaltyActionSchema = z
  .object({
    action: z.enum(["ADJUST", "WAIVE", "CANCEL"]),
    /** Required for ADJUST — the amount to reduce *to*, not by. */
    amountPaise: positivePaise("Adjusted Amount").optional(),
    reason: z
      .string()
      .trim()
      .min(1, "Reason is required")
      .max(2000, "Reason must be 2000 characters or fewer"),
    expectedVersion: expectedVersionSchema,
  })
  .superRefine((value, ctx) => {
    if (value.action === "ADJUST" && value.amountPaise === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountPaise"],
        message: "An adjustment needs the amount to adjust to.",
      });
    }
    if (value.action !== "ADJUST" && value.amountPaise !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountPaise"],
        message: "Only an adjustment carries an amount.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Settlements and legal notices
// ---------------------------------------------------------------------------

/**
 * Proposing a settlement.
 *
 * The settlement amount is what the borrower will pay; what is forgiven is
 * derived server-side from the outstanding balance, not accepted here. A form
 * that named both could propose a settlement whose two halves did not add up to
 * what was owed, and the database's `settlements_waiver_sums` CHECK would
 * refuse it — better to never construct it.
 */
export const proposeSettlementSchema = z.object({
  settlementAmountPaise: positivePaise("Settlement Amount"),
  agreedDate: isoDateSchema("Agreed Date"),
  reason: z
    .string()
    .trim()
    .min(1, "Reason is required")
    .max(2000, "Reason must be 2000 characters or fewer"),
  idempotencyKey: z.string().uuid(),
});

/**
 * Approving or rejecting a proposed settlement.
 *
 * A separate authority from proposing (Scenario 44): the officer who agreed
 * terms with a borrower does not also approve forgiving the remainder.
 */
export const decideSettlementSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  approvalReference: optionalText(150),
  reason: optionalText(2000),
  expectedVersion: expectedVersionSchema,
});

export const issueLegalNoticeSchema = z.object({
  noticeDate: isoDateSchema("Notice Date"),
  noticePeriodDays: z
    .number()
    .int("Notice period must be a whole number of days")
    .min(1, "Notice period must be at least one day")
    .max(365, "Notice period must be 365 days or fewer"),
  noticeReference: optionalText(150),
  documentRef: optionalText(500),
});

/**
 * Writing off an unrecoverable loan.
 *
 * The most irreversible act in the module. It carries no amount for the same
 * reason the penalty assessment does not: what is written off is what is
 * outstanding, read inside the posting transaction.
 */
export const writeOffLoanSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "A write-off reason is required")
    .max(2000, "Reason must be 2000 characters or fewer"),
  approvalReference: optionalText(150),
  idempotencyKey: z.string().uuid(),
  expectedVersion: expectedVersionSchema,
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * The overdue book and recovery case list filters.
 *
 * No `branchId`: the server confines every read to the caller's branch
 * regardless (Scenario 1). Accepting one would be a field that either does
 * nothing or is a vulnerability, and there is no third option.
 */
export const overdueFilterSchema = z.object({
  search: optionalText(150),
  bucket: delinquencyBucketSchema.optional(),
  npaStatus: npaStatusSchema.optional(),
  minDaysPastDue: z.coerce.number().int().min(0).optional(),
});

export const recoveryCaseFilterSchema = z.object({
  search: optionalText(150),
  status: recoveryCaseStatusSchema.optional(),
  priority: recoveryPrioritySchema.optional(),
  assigneeUserId: idSchema.optional(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type RecoveryCaseStatus = z.infer<typeof recoveryCaseStatusSchema>;
export type RecoveryActionType = z.infer<typeof recoveryActionTypeSchema>;
export type RecoveryOutcome = z.infer<typeof recoveryOutcomeSchema>;
export type RecoveryPriority = z.infer<typeof recoveryPrioritySchema>;
export type DelinquencyBucket = z.infer<typeof delinquencyBucketSchema>;
export type NpaStatus = z.infer<typeof npaStatusSchema>;
export type RecoveryResolutionType = z.infer<
  typeof recoveryResolutionTypeSchema
>;
export type SettlementStatus = z.infer<typeof settlementStatusSchema>;
export type OpenRecoveryCaseInput = z.infer<typeof openRecoveryCaseSchema>;
export type AssignRecoveryCaseInput = z.infer<typeof assignRecoveryCaseSchema>;
export type EscalateRecoveryCaseInput = z.infer<
  typeof escalateRecoveryCaseSchema
>;
export type CloseRecoveryCaseInput = z.infer<typeof closeRecoveryCaseSchema>;
export type RecordRecoveryActionInput = z.infer<
  typeof recordRecoveryActionSchema
>;
export type UpdateRecoveryActionInput = z.infer<
  typeof updateRecoveryActionSchema
>;
export type AssessPenaltyInput = z.infer<typeof assessPenaltySchema>;
export type PenaltyActionInput = z.infer<typeof penaltyActionSchema>;
export type ProposeSettlementInput = z.infer<typeof proposeSettlementSchema>;
export type DecideSettlementInput = z.infer<typeof decideSettlementSchema>;
export type IssueLegalNoticeInput = z.infer<typeof issueLegalNoticeSchema>;
export type WriteOffLoanInput = z.infer<typeof writeOffLoanSchema>;
export type OverdueFilterInput = z.infer<typeof overdueFilterSchema>;
export type RecoveryCaseFilterInput = z.infer<typeof recoveryCaseFilterSchema>;
