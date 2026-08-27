import { z } from "zod";

import {
  collectionPaymentModeSchema,
  collectionStatusSchema,
  requireReferenceForBankModes,
  syncCollectionSchema,
} from "./collections";
import { expectedVersionSchema } from "./loans";
import { optionsFrom } from "./options";
import { isoDateSchema, optionalText } from "./primitives";

/**
 * Module 12 schemas — field collection.
 *
 * Same cycle-avoiding rule as `collections.ts`: imports reach `./collections`,
 * `./loans`, `./options` and `./primitives` directly, never `./index`.
 *
 * # Why this file adds so little
 *
 * A field collection **is** a Module 11 collection. It carries the same loan,
 * the same amount, the same server-side allocation and the same idempotency
 * contract, and it posts through the same code path. What makes it a *field*
 * collection is custody — the cash sits with a person rather than a branch
 * drawer — plus the evidence the agent captured while taking it.
 *
 * So these schemas extend the Module 11 bodies with evidence fields and add
 * nothing else. There is no separate amount, no separate allocation and no
 * separate receipt: inventing those would be the duplicate payment record
 * Rule 8 forbids.
 *
 * # What is deliberately absent
 *
 * No `branchId`, `fieldAgentId`, `collectorUserId`, `receiptNumber`,
 * `custodyHandoverId` or `isFieldCollection`. Branch and customer come from the
 * loan, the agent from the JWT, the receipt from the server's sequence, and the
 * custody link from the handover flow. Their absence, plus the API's
 * `forbidNonWhitelisted`, is what makes Scenario 48 — a client submitting
 * another branch's identifiers — structural rather than a check.
 *
 * No latitude, longitude or accuracy either. Those live on a `gps_check_ins`
 * row created by the GPS check-in endpoint, and this schema carries only the
 * *reference* to it. See `fieldEvidenceShape` for why that matters.
 */

/**
 * What the device reports about its GPS capture attempt.
 *
 * A deliberate subset of the server's `GpsVerificationStatus`. `VERIFIED` is a
 * *claim* the server then has to substantiate against a real check-in row;
 * `FAILED` and `PENDING` are self-evident. The values the server alone may
 * decide — `EXPIRED`, `CANCELLED` — are absent, for the same reason the GPS
 * failure DTO restricts which reasons a client may assert: a client that can
 * name any outcome can name a flattering one.
 */
export const gpsCaptureStatusSchema = z.enum(
  ["VERIFIED", "FAILED", "PENDING"],
  {
    errorMap: () => ({ message: "GPS Capture Status is required" }),
  },
);

export const GPS_CAPTURE_STATUS_OPTIONS = optionsFrom(
  gpsCaptureStatusSchema.options,
  {
    VERIFIED: "Location captured",
    FAILED: "Capture failed",
    PENDING: "Not attempted",
  },
);

/**
 * The verification verdict on an offline capture.
 *
 * Mirrors the two terminal values of the Prisma `PaymentVerificationStatus`
 * that a human may choose. `PENDING_VERIFICATION` is where a synced collection
 * starts and `RECONCILED` is set by the cash flow, so neither is offerable
 * here.
 */
export const collectionVerificationDecisionSchema = z.enum(
  ["CONFIRMED", "REJECTED"],
  {
    errorMap: () => ({ message: "Verification Decision is required" }),
  },
);

export const COLLECTION_VERIFICATION_DECISION_OPTIONS = optionsFrom(
  collectionVerificationDecisionSchema.options,
  {
    CONFIRMED: "Confirm collection",
    REJECTED: "Reject collection",
  },
);

/**
 * Evidence the agent captured alongside the money.
 *
 * Every field is optional except the GPS status, because Rule 40 is explicit
 * that GPS is "supporting evidence and does not replace authorization". A
 * collection with no location is valid; a collection that *lies* about having
 * one is not, which is why the status itself is required and why the API
 * refuses `VERIFIED` without a resolvable `gpsCheckInId` (Rule 41,
 * Scenario 55).
 *
 * `gpsCheckInId` points at a row the GPS check-in endpoint already created and
 * the server already verified. Carrying the raw coordinates here instead would
 * let a client assert a position nothing vouches for — the reference is what
 * makes the evidence trustworthy.
 */
const fieldEvidenceShape = {
  gpsCaptureStatus: gpsCaptureStatusSchema,
  gpsCheckInId: z
    .string()
    .uuid("GPS evidence reference must be a check-in id")
    .optional(),
  fieldVisitId: z
    .string()
    .uuid("Visit reference must be a visit id")
    .optional(),
  /**
   * Whatever the customer signed, stamped or acknowledged.
   *
   * Free text on purpose. The source asks for "Customer Acknowledgment
   * Reference" without saying what form it takes, and the answer differs by
   * branch — a signature book page, an SMS confirmation id, a photo filename.
   * Modelling one of those would exclude the others.
   */
  customerAckReference: optionalText(150),
};

/**
 * Record a field collection taken online.
 *
 * Extends the Module 11 sync body — not the online post body — because a field
 * collection always carries device identity even when the network was up. The
 * device is what holds the cash trail together when it later goes offline, and
 * an agent whose device id appears only sometimes is an agent whose collections
 * cannot be grouped by device at all.
 *
 * # Why `requireReferenceForBankModes` is re-applied here
 *
 * `syncCollectionSchema` is a `ZodEffects` — an object schema *wrapped* in the
 * refinement. `.innerType()` reaches past the wrapper to get at the object so
 * it can be extended, and in doing so **discards the refinement**. Re-applying
 * it is not belt-and-braces: without this line a field collection by UPI or
 * bank transfer would be accepted with no payment reference, while the
 * identical Module 11 body was refused. A test pins this, because the failure
 * is silent — the schema still parses, it just stops enforcing something.
 */
export const recordFieldCollectionSchema = syncCollectionSchema
  .innerType()
  .omit({ offlineTransactionUuid: true, collectedAt: true })
  .extend(fieldEvidenceShape)
  .superRefine(requireReferenceForBankModes)
  .superRefine(requireCheckInForVerifiedGps);

/**
 * Sync a field collection captured offline.
 *
 * The offline identity fields (`offlineTransactionUuid`, `collectedAt`) come
 * from the Module 11 sync contract unchanged. `collectedAt` remains evidence
 * and never authority: the business date is the server's Asia/Kolkata clock,
 * so a device that backdates this changes what the receipt records, not what
 * the ledger posts (Rules 14, 15).
 *
 * `requireReferenceForBankModes` is re-applied for the reason
 * `recordFieldCollectionSchema` documents above: `.innerType()` drops it.
 */
export const syncFieldCollectionSchema = syncCollectionSchema
  .innerType()
  .extend(fieldEvidenceShape)
  .superRefine(requireReferenceForBankModes)
  .superRefine(requireCheckInForVerifiedGps);

/**
 * A claimed GPS success must point at a check-in the server itself verified.
 *
 * Object-level rather than attached to `gpsCheckInId`, for the reason
 * `collections.ts` documents at length: a field-level conditional skips the
 * presence check entirely when the condition is false, so a missing value
 * passes silently. Checked here, the rule sees both fields at once.
 *
 * This is the client-side half of Scenario 55. The API repeats it, and
 * additionally resolves the id — a well-formed uuid for a check-in that does
 * not exist, belongs to another org or is not `VERIFIED` is refused there.
 * A rule written only here is enforced only here.
 */
function requireCheckInForVerifiedGps(
  value: { gpsCaptureStatus: string; gpsCheckInId?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.gpsCaptureStatus === "VERIFIED" && !value.gpsCheckInId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["gpsCheckInId"],
      message:
        "A verified GPS capture must reference the check-in that verified it",
    });
  }
}

/**
 * Confirm or reject a field collection captured offline.
 *
 * Carries `expectedVersion` because — unlike posting, which creates and commits
 * in one act — this acts on a collection row that already exists and that
 * another reviewer may have decided in the meantime.
 *
 * A rejection must say why. A confirmation need not: "it is what it says it is"
 * has no more detail to give, and demanding a sentence for it trains reviewers
 * to type "ok".
 */
export const verifyCollectionSchema = z
  .object({
    decision: collectionVerificationDecisionSchema,
    verificationNotes: optionalText(1000),
    expectedVersion: expectedVersionSchema,
  })
  .superRefine((value, ctx) => {
    if (value.decision === "REJECTED" && !value.verificationNotes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verificationNotes"],
        message: "A reason is required when rejecting a collection",
      });
    }
  });

/**
 * The field collection list filter.
 *
 * No `branchId` and no `fieldAgentId`. Branch scope comes from the session, and
 * an agent's own scope is applied server-side: a Field Employee without
 * verification authority sees only their own collections whatever they ask for
 * (Scenario 2, Rule 4). Accepting either here would mean the server had to
 * decide whether to believe it.
 */
export const listFieldCollectionsSchema = z.object({
  search: optionalText(120),
  status: collectionStatusSchema.optional(),
  paymentMode: collectionPaymentModeSchema.optional(),
  gpsCaptureStatus: gpsCaptureStatusSchema.optional(),
  loanId: z.string().uuid().optional(),
  /** Narrow to cash still in the agent's custody — the handover work list. */
  awaitingHandover: z.coerce.boolean().optional(),
  fromDate: optionalText(10).pipe(isoDateSchema("From Date").optional()),
  toDate: optionalText(10).pipe(isoDateSchema("To Date").optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type GpsCaptureStatus = z.infer<typeof gpsCaptureStatusSchema>;
export type CollectionVerificationDecision = z.infer<
  typeof collectionVerificationDecisionSchema
>;
export type RecordFieldCollectionInput = z.infer<
  typeof recordFieldCollectionSchema
>;
export type SyncFieldCollectionInput = z.infer<
  typeof syncFieldCollectionSchema
>;
export type VerifyCollectionInput = z.infer<typeof verifyCollectionSchema>;
export type ListFieldCollectionsInput = z.infer<
  typeof listFieldCollectionsSchema
>;
