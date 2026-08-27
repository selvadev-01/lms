"use client";

import type { GuarantorKycStatus, GuarantorStatus } from "@lms/types";
import { Badge } from "@lms/ui";
import React from "react";

/**
 * Colour vocabulary for Module 05's guarantor states.
 *
 * Separate from `CustomerStatusBadge`'s scales for the same reason those are
 * separate from each other: the states answer different questions, and a shared
 * palette would imply they are comparable. A guarantor whose KYC is
 * `NOT_REQUIRED` is in a legitimate, complete state; a customer's KYC never has
 * that value at all.
 *
 * `NOT_REQUIRED` is rendered neutral rather than as a warning: no loan product
 * has asked this guarantor for KYC, which is not something anyone needs to act
 * on (Q-GUAR-11). Showing it as outstanding would put every guarantor ever
 * created into a queue nobody created.
 */
const GUARANTOR_COLOR: Record<GuarantorStatus, "success" | "light"> = {
  ACTIVE: "success",
  /** Withdrawn from future use; historical loan relationships are untouched. */
  INACTIVE: "light",
};

const GUARANTOR_KYC_COLOR: Record<
  GuarantorKycStatus,
  "success" | "warning" | "error" | "light"
> = {
  APPROVED: "success",
  /** Awaiting a reviewer. */
  SUBMITTED: "warning",
  /** Nothing assembled yet — waiting on the branch, not on a decision. */
  PENDING: "light",
  /** Actionable: the branch can fix this and resubmit. */
  REVISION_REQUIRED: "warning",
  REJECTED: "error",
  /** No loan product has asked for KYC on this guarantor. Complete, not pending. */
  NOT_REQUIRED: "light",
};

const LABEL: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  APPROVED: "Approved",
  SUBMITTED: "Submitted",
  PENDING: "Pending",
  REVISION_REQUIRED: "Revision required",
  REJECTED: "Rejected",
  NOT_REQUIRED: "Not required",
};

function label(status: string): string {
  return LABEL[status] ?? status;
}

export function GuarantorStatusBadge({ status }: { status: GuarantorStatus }) {
  return (
    <Badge color={GUARANTOR_COLOR[status] ?? "light"}>{label(status)}</Badge>
  );
}

export function GuarantorKycStatusBadge({
  status,
}: {
  status: GuarantorKycStatus;
}) {
  return (
    <Badge color={GUARANTOR_KYC_COLOR[status] ?? "light"}>
      {label(status)}
    </Badge>
  );
}
