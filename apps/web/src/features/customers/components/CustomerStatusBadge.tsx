"use client";

import type {
  ConsentStatus,
  CustomerLifecycleStatus,
  CustomerType,
  DocumentVerificationStatus,
  KycLifecycleStatus,
} from "@lms/types";
import { Badge } from "@lms/ui";
import React from "react";

/**
 * The colour vocabulary for Module 04's lifecycle states.
 *
 * Four separate scales rather than one, because the states answer different
 * questions and a shared palette would imply they are comparable. A customer who
 * is `PENDING` and a KYC record that is `PENDING` mean different things — the
 * first is waiting on the branch, the second on a reviewer.
 *
 * `REVISION_REQUIRED` is warning rather than error on purpose: it is a request
 * to the branch, not a refusal. Rendering it the same as `REJECTED` would tell
 * staff to give up on a customer who is one document away from approval.
 */
const CUSTOMER_COLOR: Record<
  CustomerLifecycleStatus,
  "success" | "warning" | "error" | "light"
> = {
  ACTIVE: "success",
  /** Registered but not yet activated — waiting on KYC or verification. */
  PENDING: "warning",
  INACTIVE: "light",
  /** A deliberate hold, distinct from simply switched off. */
  BLOCKED: "error",
};

const KYC_COLOR: Record<
  KycLifecycleStatus,
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
};

const DOCUMENT_COLOR: Record<
  DocumentVerificationStatus,
  "success" | "warning" | "error"
> = {
  VERIFIED: "success",
  PENDING: "warning",
  REJECTED: "error",
};

const CONSENT_COLOR: Record<ConsentStatus, "success" | "warning" | "error"> = {
  GIVEN: "success",
  PENDING: "warning",
  REJECTED: "error",
};

/** Human wording for the enum values, which read as shouting otherwise. */
const LABEL: Record<string, string> = {
  REVISION_REQUIRED: "Revision required",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PENDING: "Pending",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  BLOCKED: "Blocked",
  VERIFIED: "Verified",
  GIVEN: "Given",
};

function label(status: string): string {
  return LABEL[status] ?? status;
}

export function CustomerStatusBadge({
  status,
}: {
  status: CustomerLifecycleStatus;
}) {
  return (
    <Badge color={CUSTOMER_COLOR[status] ?? "light"}>{label(status)}</Badge>
  );
}

/**
 * A LOCAL customer has no KYC record, which is a legitimate state rather than
 * missing data — so it is rendered as "Not required" instead of an empty cell
 * that would read as something failing to load.
 */
export function KycStatusBadge({ status }: { status?: KycLifecycleStatus }) {
  if (!status) return <Badge color="light">Not required</Badge>;

  return <Badge color={KYC_COLOR[status] ?? "light"}>{label(status)}</Badge>;
}

export function DocumentStatusBadge({
  status,
}: {
  status: DocumentVerificationStatus;
}) {
  return (
    <Badge color={DOCUMENT_COLOR[status] ?? "warning"}>{label(status)}</Badge>
  );
}

export function ConsentStatusBadge({ status }: { status: ConsentStatus }) {
  return (
    <Badge color={CONSENT_COLOR[status] ?? "warning"}>{label(status)}</Badge>
  );
}

/**
 * Customer type is shown as a badge everywhere rather than only on the profile,
 * because it changes which rules apply to the record — Rule 5 makes it explicit,
 * and a list that hid it would leave staff unable to tell why one customer needs
 * documents and another does not.
 */
export function CustomerTypeBadge({ type }: { type: CustomerType }) {
  return (
    <Badge color={type === "KYC" ? "info" : "light"}>
      {type === "KYC" ? "KYC" : "Local"}
    </Badge>
  );
}
