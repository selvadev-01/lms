"use client";

import type {
  CustomerDocumentSummary,
  KycDocumentType,
  KycRecord,
} from "@lms/types";
import { Alert, Button } from "@lms/ui";
import { KYC_DOCUMENT_TYPE_OPTIONS, labelFor } from "@lms/validation";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  reviewKycAction,
  submitKycAction,
  uploadDocumentAction,
  verifyDocumentAction,
  type KycFormState,
} from "../actions/kyc-actions";
import { DocumentStatusBadge, KycStatusBadge } from "./CustomerStatusBadge";

/**
 * KYC upload and review (Module 04, Scenarios 6-12).
 *
 * The panel makes the *gap* visible, which is the thing the workflow turns on: a
 * reviewer needs to see which of the three required categories is missing or
 * unverified before deciding, because approval will be refused for exactly that
 * reason (Scenario 7). Listing only what was uploaded would leave them guessing
 * why the server said no.
 *
 * Superseded versions are shown but visibly demoted (Scenario 11). They are not
 * hidden, because the decision a reviewer made earlier referred to them, and an
 * audit trail that points at documents the screen denies exist is not usable.
 *
 * Every control is gated on a capability prop rather than on the role, so a
 * caller who reaches the screen without `customers.kyc.approve` sees the pack
 * and not the decision — which is Scenario 10 rendered rather than merely
 * enforced.
 */

/**
 * All three categories are required for a borrower — unlike a guarantor, where
 * PHOTO is accepted but never demanded. Stated here rather than taken from the
 * option registry because it is a business rule about completeness, not the list
 * of values the field may hold; the two happening to coincide is not a reason to
 * let a change to one silently move the other.
 */
const REQUIRED: KycDocumentType[] = ["ID", "ADDRESS", "PHOTO"];

const initial: KycFormState = {};

function SubmitButton({
  label,
  variant = "primary",
}: {
  label: string;
  variant?: "primary" | "outline";
}) {
  const { pending } = useFormStatus();

  return (
    <Button size="sm" variant={variant} disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

export default function KycPanel({
  customerId,
  kyc,
  documents,
  canUpload = false,
  canVerify = false,
  canSubmit = false,
  canApprove = false,
  canDownload = false,
}: {
  customerId: string;
  kyc: KycRecord;
  documents: CustomerDocumentSummary[];
  canUpload?: boolean;
  canVerify?: boolean;
  canSubmit?: boolean;
  canApprove?: boolean;
  canDownload?: boolean;
}) {
  const [uploadState, uploadFormAction] = useActionState(
    uploadDocumentAction,
    initial,
  );
  const [reviewState, reviewFormAction] = useActionState(
    reviewKycAction,
    initial,
  );
  const [submitState, submitFormAction] = useActionState(
    submitKycAction,
    initial,
  );
  const [verifyState, verifyFormAction] = useActionState(
    verifyDocumentAction,
    initial,
  );
  const [decision, setDecision] = useState<
    "APPROVE" | "REQUEST_REVISION" | "REJECT"
  >("APPROVE");

  const current = documents.filter((doc) => !doc.supersededAt);
  const superseded = documents.filter((doc) => doc.supersededAt);

  const missing = REQUIRED.filter(
    (type) => !current.some((doc) => doc.documentType === type),
  );
  const unverified = REQUIRED.filter((type) =>
    current.some(
      (doc) =>
        doc.documentType === type && doc.verificationStatus !== "VERIFIED",
    ),
  );
  const approvable = missing.length === 0 && unverified.length === 0;

  const state = uploadState.message
    ? uploadState
    : reviewState.message
      ? reviewState
      : verifyState.message
        ? verifyState
        : submitState;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-400">
            KYC Status
          </span>
          <KycStatusBadge status={kyc.status} />
        </div>

        {canSubmit && kyc.status !== "APPROVED" && (
          <form action={submitFormAction}>
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="expectedVersion" value={kyc.version} />
            <SubmitButton label="Submit for Review" variant="outline" />
          </form>
        )}
      </div>

      {state.message && (
        <Alert
          variant="error"
          title="Could not continue"
          message={state.message}
        />
      )}
      {state.success && (
        <Alert variant="success" title="Done" message={state.success} />
      )}

      {/*
        Scenario 8 — the reason the branch was given. Shown prominently because
        it is the only instruction they have about what to fix.
      */}
      {kyc.status === "REVISION_REQUIRED" && kyc.revisionReason && (
        <Alert
          variant="warning"
          title="Revision requested"
          message={kyc.revisionReason}
        />
      )}

      {kyc.status === "REJECTED" && kyc.revisionReason && (
        <Alert
          variant="error"
          title="KYC rejected"
          message={kyc.revisionReason}
        />
      )}

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
          Required Documents
        </h3>

        {REQUIRED.map((type) => {
          const doc = current.find((d) => d.documentType === type);

          return (
            <div
              key={type}
              className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {labelFor(KYC_DOCUMENT_TYPE_OPTIONS, type)}
                  </p>
                  {doc ? (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {doc.fileName ?? "Uploaded"} · version {doc.version}
                      {doc.documentNumber ? ` · ${doc.documentNumber}` : ""}
                    </p>
                  ) : (
                    <p className="text-warning-600 mt-1 text-xs">
                      Not uploaded yet
                    </p>
                  )}
                  {doc?.verificationReason && (
                    <p className="text-error-500 mt-1 text-xs">
                      {doc.verificationReason}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {doc && (
                    <DocumentStatusBadge status={doc.verificationStatus} />
                  )}
                  {doc && canDownload && (
                    /*
                      A plain link, not a fetch: the endpoint re-checks scope and
                      audits the read, so the browser navigating to it is the
                      authorized path rather than a way around one.
                    */
                    <a
                      href={`/api/customers/${customerId}/documents/${doc.documentId}/file`}
                      className="text-brand-500 text-sm hover:underline"
                    >
                      Download
                    </a>
                  )}
                </div>
              </div>

              {canUpload && kyc.status !== "APPROVED" && (
                <form
                  action={uploadFormAction}
                  className="mt-3 flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="customerId" value={customerId} />
                  <input type="hidden" name="documentType" value={type} />
                  <div>
                    <label
                      htmlFor={`file-${type}`}
                      className="mb-1 block text-xs text-gray-500 dark:text-gray-400"
                    >
                      {doc ? "Replace file" : "Select file"} (JPG, PNG or PDF,
                      max 5 MB)
                    </label>
                    <input
                      id={`file-${type}`}
                      type="file"
                      name="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="text-sm text-gray-600 dark:text-gray-400"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`number-${type}`}
                      className="mb-1 block text-xs text-gray-500 dark:text-gray-400"
                    >
                      Document number (optional)
                    </label>
                    <input
                      id={`number-${type}`}
                      type="text"
                      name="documentNumber"
                      maxLength={100}
                      className="h-9 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:text-white/90"
                    />
                  </div>
                  <SubmitButton label="Upload" variant="outline" />
                </form>
              )}

              {doc && canVerify && doc.verificationStatus !== "VERIFIED" && (
                <form
                  action={verifyFormAction}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="customerId" value={customerId} />
                  <input
                    type="hidden"
                    name="documentId"
                    value={doc.documentId}
                  />
                  <input type="hidden" name="status" value="VERIFIED" />
                  <SubmitButton label="Mark Verified" variant="outline" />
                </form>
              )}
            </div>
          );
        })}
      </div>

      {/*
        Scenario 11 — retained and visible, because an earlier decision referred
        to these versions.
      */}
      {superseded.length > 0 && (
        <details className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
          <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-400">
            Previous versions ({superseded.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {superseded.map((doc) => (
              <li
                key={doc.documentId}
                className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400"
              >
                <span>
                  {labelFor(KYC_DOCUMENT_TYPE_OPTIONS, doc.documentType)} ·
                  version {doc.version} · {doc.fileName ?? "file"}
                </span>
                {canDownload && (
                  <a
                    href={`/api/customers/${customerId}/documents/${doc.documentId}/file`}
                    className="text-brand-500 hover:underline"
                  >
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canApprove && kyc.status !== "APPROVED" && (
        <div className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
          <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
            Review Decision
          </h3>

          {/*
            Scenario 7 — the reviewer is told what blocks approval before they
            try it, rather than being refused after the fact.
          */}
          {!approvable && (
            <p className="text-warning-600 mt-2 text-xs">
              {missing.length > 0
                ? `Cannot approve until these are uploaded: ${missing
                    .map((t) => labelFor(KYC_DOCUMENT_TYPE_OPTIONS, t))
                    .join(", ")}.`
                : `Cannot approve until these are verified: ${unverified
                    .map((t) => labelFor(KYC_DOCUMENT_TYPE_OPTIONS, t))
                    .join(", ")}.`}
            </p>
          )}

          <form action={reviewFormAction} className="mt-3 space-y-3">
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="expectedVersion" value={kyc.version} />

            <div className="flex flex-wrap gap-3">
              {(
                [
                  ["APPROVE", "Approve"],
                  ["REQUEST_REVISION", "Request Revision"],
                  ["REJECT", "Reject"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="decision"
                    value={value}
                    checked={decision === value}
                    onChange={() => setDecision(value)}
                    // Approving an incomplete pack is refused server-side; the
                    // control is disabled so the reviewer is not invited to try.
                    disabled={value === "APPROVE" && !approvable}
                  />
                  <span className="text-gray-700 dark:text-gray-400">
                    {label}
                  </span>
                </label>
              ))}
            </div>

            {decision !== "APPROVE" && (
              <div>
                <label
                  htmlFor="reason"
                  className="mb-1 block text-sm text-gray-700 dark:text-gray-400"
                >
                  Reason <span className="text-error-500">*</span>
                </label>
                <textarea
                  id="reason"
                  name="reason"
                  rows={3}
                  maxLength={1000}
                  placeholder="Tell the branch what needs to change"
                  className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2 text-sm dark:border-gray-700 dark:text-white/90"
                />
                {reviewState.errors?.reason && (
                  <p className="text-error-500 mt-1 text-sm">
                    {reviewState.errors.reason[0]}
                  </p>
                )}
              </div>
            )}

            <SubmitButton label="Record Decision" />
          </form>
        </div>
      )}

      {kyc.reviewedAt && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Last reviewed {new Date(kyc.reviewedAt).toLocaleString()}
          {kyc.reviewedByName ? ` by ${kyc.reviewedByName}` : ""}.
        </p>
      )}
    </div>
  );
}
