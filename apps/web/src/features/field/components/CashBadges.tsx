import type {
  CashDiscrepancyType,
  CashHandoverStatus,
  CashReconciliationStatus,
  GpsCaptureStatus,
} from "@lms/types";
import { Badge } from "@lms/ui";
import {
  CASH_DISCREPANCY_TYPE_OPTIONS,
  CASH_HANDOVER_STATUS_OPTIONS,
  CASH_RECONCILIATION_STATUS_OPTIONS,
  GPS_CAPTURE_STATUS_OPTIONS,
  labelFor,
} from "@lms/validation";

/**
 * Status badges for the Module 12 surfaces.
 *
 * Server components — no `"use client"`. They render text and colour from props
 * and hold no state, so shipping them to the browser would cost bundle size for
 * nothing. Same reasoning as `CollectionBadges`.
 *
 * Every map is a total `Record<Status, ...>` rather than a partial one, so a
 * new status stops the compiler here instead of rendering an undefined colour.
 */

type Tone = "success" | "warning" | "error" | "info" | "light";

/**
 * Handover lifecycle colour.
 *
 * RECEIVED and RECONCILED are the successes: the cash has reached the branch
 * and, in the second case, been counted. SUBMITTED is `warning` because cash is
 * in transit between two people — the state most worth an operator's attention.
 * CREATED is `info`: a draft commits nothing.
 *
 * REVERSED is `light` rather than `error`, for the reason `CollectionBadges`
 * gives: a reversal is an authorized correction, and colouring it red would
 * make a correctly-handled mistake look like a system failure.
 */
const HANDOVER_TONE: Record<CashHandoverStatus, Tone> = {
  CREATED: "info",
  SUBMITTED: "warning",
  RECEIVED: "success",
  RECONCILED: "success",
  CANCELLED: "light",
  REVERSED: "light",
};

export function HandoverStatusBadge({
  status,
}: {
  status: CashHandoverStatus;
}) {
  return (
    <Badge color={HANDOVER_TONE[status]}>
      {labelFor(CASH_HANDOVER_STATUS_OPTIONS, status)}
    </Badge>
  );
}

/**
 * Reconciliation colour.
 *
 * DISCREPANCY_PENDING is `error`, not `warning`: unreconciled cash is missing
 * money until proven otherwise, and Rule 34 forbids it being quietly absorbed.
 * RESOLVED is `info` rather than `success` — a resolved shortage is closed, not
 * recovered, and green would imply the money came back.
 */
const RECONCILIATION_TONE: Record<CashReconciliationStatus, Tone> = {
  PENDING: "warning",
  MATCHED: "success",
  DISCREPANCY_PENDING: "error",
  RESOLVED: "info",
};

export function ReconciliationStatusBadge({
  status,
}: {
  status: CashReconciliationStatus;
}) {
  return (
    <Badge color={RECONCILIATION_TONE[status]}>
      {labelFor(CASH_RECONCILIATION_STATUS_OPTIONS, status)}
    </Badge>
  );
}

export function DiscrepancyBadge({ type }: { type: CashDiscrepancyType }) {
  return (
    <Badge color="error">{labelFor(CASH_DISCREPANCY_TYPE_OPTIONS, type)}</Badge>
  );
}

/**
 * What the device reported about its GPS capture.
 *
 * FAILED is `warning`, not `error`: Rule 40 makes GPS supporting evidence
 * rather than a gate, so a failed capture does not invalidate the collection.
 * Colouring it red would imply the payment is in doubt when only the location
 * is. What must never happen is a failure rendering as a success — hence the
 * exhaustive map rather than a truthiness check on the presence of coordinates.
 */
const GPS_TONE: Record<GpsCaptureStatus, Tone> = {
  VERIFIED: "success",
  FAILED: "warning",
  PENDING: "light",
};

export function GpsEvidenceBadge({ status }: { status: GpsCaptureStatus }) {
  return (
    <Badge color={GPS_TONE[status]}>
      {labelFor(GPS_CAPTURE_STATUS_OPTIONS, status)}
    </Badge>
  );
}

/**
 * Whether an agent still holds this cash.
 *
 * The single most useful thing on a field collection row: absent means the cash
 * is in somebody's pocket and counts toward their balance.
 */
export function CustodyBadge({
  handoverNumber,
}: {
  handoverNumber?: string | undefined;
}) {
  return handoverNumber ? (
    <Badge color="success">Handed over · {handoverNumber}</Badge>
  ) : (
    <Badge color="warning">With agent</Badge>
  );
}
