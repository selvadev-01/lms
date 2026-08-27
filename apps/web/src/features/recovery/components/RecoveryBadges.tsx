import type {
  DelinquencyBucket,
  NpaStatus,
  RecoveryCaseStatus,
  RecoveryPriority,
  SettlementStatus,
} from "@lms/types";
import { Badge } from "@lms/ui";
import {
  DELINQUENCY_BUCKET_OPTIONS,
  NPA_STATUS_OPTIONS,
  RECOVERY_CASE_STATUS_OPTIONS,
  RECOVERY_PRIORITY_OPTIONS,
  SETTLEMENT_STATUS_OPTIONS,
  labelFor,
} from "@lms/validation";

/**
 * Status badges for the overdue and recovery surfaces.
 *
 * Server components — no `"use client"`. They render text and colour from props
 * and hold no state, so shipping them to the browser would cost bundle size for
 * nothing. Same reasoning as `CollectionBadges`.
 *
 * Every tone map is a total `Record<...>` rather than a partial one, so a new
 * enum value stops the compiler here instead of falling through to a default
 * colour nobody chose.
 */

/**
 * Delinquency ageing colour.
 *
 * A deliberate ramp rather than a binary: an operator triaging a worklist needs
 * to see *how* late at a glance, and colouring everything past due the same red
 * would flatten the distinction the buckets exist to draw. `CURRENT` is
 * `success` because nothing is owed late.
 */
const BUCKET_TONE: Record<
  DelinquencyBucket,
  "success" | "warning" | "error" | "info" | "light"
> = {
  CURRENT: "success",
  DPD_1_30: "info",
  DPD_31_60: "warning",
  DPD_61_90: "warning",
  DPD_91_180: "error",
  DPD_180_PLUS: "error",
};

/**
 * Asset classification colour.
 *
 * `STANDARD` is not `success`: a standard asset is unremarkable rather than
 * good news, and a green badge on every performing loan would make the colour
 * carry no information. From `SUB_STANDARD` the account is non-performing, which
 * is what the red is for.
 */
const NPA_TONE: Record<
  NpaStatus,
  "success" | "warning" | "error" | "info" | "light"
> = {
  STANDARD: "light",
  SPECIAL_MENTION: "info",
  SUB_STANDARD: "warning",
  DOUBTFUL: "error",
  LOSS: "error",
};

/**
 * Recovery case lifecycle colour.
 *
 * `SETTLED` and `CLOSED` are the two resolutions and both read as `success` —
 * the case is off the worklist either way. `LEGAL_NOTICE` and `LEGAL_ACTION`
 * are `error` because they are the states an operator most needs to notice, not
 * because anything has failed.
 */
const CASE_TONE: Record<
  RecoveryCaseStatus,
  "success" | "warning" | "error" | "info" | "light"
> = {
  OPEN: "warning",
  FIELD_ASSIGNED: "info",
  FIELD_VISIT: "info",
  BRANCH_REVIEW: "warning",
  LEGAL_NOTICE: "error",
  SETTLEMENT_PENDING: "warning",
  SETTLED: "success",
  LEGAL_ACTION: "error",
  CLOSED: "light",
};

const PRIORITY_TONE: Record<
  RecoveryPriority,
  "success" | "warning" | "error" | "info" | "light"
> = {
  LOW: "light",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "error",
};

/**
 * Settlement lifecycle colour.
 *
 * `COMPLETED` is the only `success`: it is the one state in which the waiver
 * has actually been posted. `APPROVED` is `info` rather than green because an
 * approved settlement that never completes has forgiven nothing.
 */
const SETTLEMENT_TONE: Record<
  SettlementStatus,
  "success" | "warning" | "error" | "info" | "light"
> = {
  DRAFT: "light",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  COMPLETED: "success",
  REJECTED: "error",
  CANCELLED: "light",
};

export function DelinquencyBucketBadge({
  bucket,
}: {
  bucket: DelinquencyBucket;
}) {
  return (
    <Badge color={BUCKET_TONE[bucket]}>
      {labelFor(DELINQUENCY_BUCKET_OPTIONS, bucket)}
    </Badge>
  );
}

/**
 * The derived NPA eligibility, or the committed classification.
 *
 * `derived` renders it as what the ageing *supports* rather than what the loan
 * is. Rule 29 makes the classification an authorized act, so showing a derived
 * value as though it were committed would display a decision nobody made.
 */
export function NpaStatusBadge({
  status,
  derived = false,
}: {
  status: NpaStatus;
  derived?: boolean;
}) {
  return (
    <Badge color={NPA_TONE[status]}>
      {labelFor(NPA_STATUS_OPTIONS, status)}
      {derived ? " (indicated)" : ""}
    </Badge>
  );
}

export function RecoveryCaseStatusBadge({
  status,
}: {
  status: RecoveryCaseStatus;
}) {
  return (
    <Badge color={CASE_TONE[status]}>
      {labelFor(RECOVERY_CASE_STATUS_OPTIONS, status)}
    </Badge>
  );
}

export function RecoveryPriorityBadge({
  priority,
}: {
  priority: RecoveryPriority;
}) {
  return (
    <Badge color={PRIORITY_TONE[priority]}>
      {labelFor(RECOVERY_PRIORITY_OPTIONS, priority)}
    </Badge>
  );
}

export function SettlementStatusBadge({
  status,
}: {
  status: SettlementStatus;
}) {
  return (
    <Badge color={SETTLEMENT_TONE[status]}>
      {labelFor(SETTLEMENT_STATUS_OPTIONS, status)}
    </Badge>
  );
}

/**
 * A promise that was not kept (Scenario 16).
 *
 * Rendered only when the server says so — the missed state is derived from the
 * business date and whether a payment landed, and re-deriving it in the browser
 * would let a wrong device clock decide whether a borrower broke their word.
 */
export function PromiseMissedBadge() {
  return <Badge color="error">Promise missed</Badge>;
}
