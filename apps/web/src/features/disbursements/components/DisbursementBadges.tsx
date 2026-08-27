import type { DisbursementStatus } from "@lms/types";
import { Badge } from "@lms/ui";
import {
  DISBURSEMENT_PAYMENT_MODE_OPTIONS,
  DISBURSEMENT_STATUS_OPTIONS,
  labelFor,
} from "@lms/validation";

/**
 * Status badges for the disbursal surfaces.
 *
 * Server components — no `"use client"`. They render text and colour from
 * props and hold no state, so shipping them to the browser would cost bundle
 * size for nothing. Same reasoning as `LoanBadges`.
 */

/**
 * Disbursement lifecycle colour.
 *
 * COMPLETED is the only success: it is the one state in which money has
 * actually moved. SCHEDULED and PROCESSING are both `warning` because both mean
 * the borrower is owed money that has not reached them — to an operator working
 * a queue that is the same call to action, and two colours would imply a
 * distinction they do not act on.
 *
 * CANCELLED is `light` rather than `error`: it is a deliberate decision, not a
 * failure, and colouring it red would make a tidy queue look like a broken one.
 *
 * `Record<DisbursementStatus, ...>` rather than a partial map, so a new status
 * stops the compiler here.
 */
const DISBURSEMENT_TONE: Record<
  DisbursementStatus,
  "success" | "warning" | "error" | "info" | "light"
> = {
  SCHEDULED: "warning",
  PROCESSING: "warning",
  COMPLETED: "success",
  FAILED: "error",
  CANCELLED: "light",
};

export function DisbursementStatusBadge({
  status,
}: {
  status: DisbursementStatus;
}) {
  return (
    <Badge size="sm" color={DISBURSEMENT_TONE[status]}>
      {labelFor(DISBURSEMENT_STATUS_OPTIONS, status)}
    </Badge>
  );
}

export function paymentModeLabel(mode: string): string {
  return labelFor(DISBURSEMENT_PAYMENT_MODE_OPTIONS, mode);
}
