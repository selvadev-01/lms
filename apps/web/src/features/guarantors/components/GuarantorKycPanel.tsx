"use client";

import type {
  GuarantorDetail,
  GuarantorDocumentSummary,
  GuarantorDocumentType,
} from "@lms/types";
import { Alert, Button } from "@lms/ui";
import { GUARANTOR_DOCUMENT_TYPE_OPTIONS, labelFor } from "@lms/validation";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

// Module import, not the barrel: the barrel re-exports `server-only` api code,
// which a client component cannot pull in. See GuarantorDetail for the detail.
import { DocumentStatusBadge } from "@/features/customers/components/CustomerStatusBadge";
import {
  reviewGuarantorKycAction,
  submitGuarantorKycAction,
  uploadGuarantorDocumentAction,
  verifyGuarantorDocumentAction,
  type GuarantorKycState,
} from "../actions/guarantor-kyc-actions";
import { GuarantorKycStatusBadge } from "./GuarantorStatusBadge";

/**
 * Guarantor KYC upload and review (Module 05, Scenarios 20-25).
 *
 * The panel makes the *gap* visible, as the borrower's does: a reviewer needs to
 * see which required category is missing or unverified before deciding, because
 * approval will be refused for exactly that reason (Scenario 21). Listing only
 * what was uploaded would leave them guessing why the server said no.
 *
 * **The required set is ID and ADDRESS — not PHOTO.** This differs from the
 * borrower pack deliberately: Q-GUAR-9 asks whether a guarantor photo is
 * required and the source never answers, so demanding one would block every
 * approval on a document nobody agreed to collect. A photo may still be
 * uploaded; it is simply never outstanding.
 *
 * Superseded versions are shown but visibly demoted. They are not hidden,
 * because the decision a reviewer made earlier referred to them, and an audit
 * trail that points at documents the screen denies exist is not usable.
 */

const REQUIRED: GuarantorDocumentType[] = ["ID", "ADDRESS"];

const initial: GuarantorKycState = {};

function SubmitButton({
  label,
  variant = "primary",
  disabled = false,
}: {
  label: string;
  variant?: "primary" | "outline";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      size="sm"
      variant={variant}
      disabled={pending || disabled}
    >
      {pending ? "Working…" : label}
    </Button>
  );
}

export default function GuarantorKycPanel({
  guarantor,
  documents,
  canUpload = false,
  canVerify = false,
  canSubmit = false,
  canReview = false,
  canDownload = false,
}: {
  guarantor: GuarantorDetail;
  documents: GuarantorDocumentSummary[];
  canUpload?: boolean;
  canVerify?: boolean;
  canSubmit?: boolean;
  canReview?: boolean;
  canDownload?: boolean;
}) {
  const [uploadState, uploadFormAction] = useActionState(
    uploadGuarantorDocumentAction,
    initial,
  );
  const [verifyState, verifyFormAction] = useActionState(
    verifyGuarantorDocumentAction,
    initial,
  );
  const [submitState, submitFormAction] = useActionState(
    submitGuarantorKycAction,
    initial,
  );
  const [reviewState, reviewFormAction] = useActionState(
    reviewGuarantorKycAction,
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
    : verifyState.message
      ? verifyState
      : submitState.message
        ? submitState
        : reviewState;

  const errors = uploadState.errors ?? reviewState.errors ?? {};

  const ids = (
    <>
      <input type="hidden" name="customerId" value={guarantor.customerId} />
      <input type="hidden" name="guarantorId" value={guarantor.guarantorId} />
    </>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
          Guarantor KYC
        </h3>
        <GuarantorKycStatusBadge status={guarantor.kycStatus} />
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
        Scenario 23 — the reason is what the branch acts on, so it is shown
        rather than left in the audit log.
      */}
      {guarantor.kycStatus === "REVISION_REQUIRED" &&
        guarantor.kycRevisionReason && (
          <Alert
            variant="warning"
            title="Revision requested"
            message={guarantor.kycRevisionReason}
          />
        )}

      {/* Scenario 21 — what is still outstanding, named. */}
      {(missing.length > 0 || unverified.length > 0) && (
        <div className="rounded-2xl border border-gray-200 p-4 text-sm dark:border-gray-800">
          {missing.length > 0 && (
            <p className="text-gray-600 dark:text-gray-300">
              Not yet uploaded:{" "}
              {missing
                .map((type) => labelFor(GUARANTOR_DOCUMENT_TYPE_OPTIONS, type))
                .join(", ")}
            </p>
          )}
          {unverified.length > 0 && (
            <p className="mt-1 text-gray-600 dark:text-gray-300">
              Awaiting verification:{" "}
              {unverified
                .map((type) => labelFor(GUARANTOR_DOCUMENT_TYPE_OPTIONS, type))
                .join(", ")}
            </p>
          )}
        </div>
      )}

      {current.length === 0 ? (
        <p
          className="rounded-2xl border border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
          role="status"
        >
          No documents uploaded for this guarantor.
        </p>
      ) : (
        <ul className="space-y-3">
          {current.map((doc) => (
            <li
              key={doc.documentId}
              className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {labelFor(
                      GUARANTOR_DOCUMENT_TYPE_OPTIONS,
                      doc.documentType,
                    )}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {doc.fileName ?? "Stored file"} · v{doc.version}
                  </p>
                  {doc.verificationReason && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {doc.verificationReason}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <DocumentStatusBadge status={doc.verificationStatus} />

                  {canDownload && (
                    <a
                      href={`/api/customers/${guarantor.customerId}/guarantors/${guarantor.guarantorId}/documents/${doc.documentId}/file`}
                      className="text-brand-500 text-sm hover:underline"
                    >
                      Download
                    </a>
                  )}

                  {canVerify && doc.verificationStatus !== "VERIFIED" && (
                    <form action={verifyFormAction}>
                      {ids}
                      <input
                        type="hidden"
                        name="documentId"
                        value={doc.documentId}
                      />
                      <input type="hidden" name="status" value="VERIFIED" />
                      <SubmitButton label="Verify" variant="outline" />
                    </form>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {superseded.length > 0 && (
        <details className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
          <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-300">
            Replaced versions ({superseded.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {superseded.map((doc) => (
              <li
                key={doc.documentId}
                className="text-xs text-gray-500 dark:text-gray-400"
              >
                {labelFor(GUARANTOR_DOCUMENT_TYPE_OPTIONS, doc.documentType)} ·
                v{doc.version} · replaced{" "}
                {doc.supersededAt
                  ? new Date(doc.supersededAt).toLocaleString()
                  : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canUpload && (
        <form
          action={uploadFormAction}
          className="space-y-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-800"
        >
          {ids}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="guarantor-documentType"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Document Type <span className="text-error-500">*</span>
              </label>
              <select
                id="guarantor-documentType"
                name="documentType"
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm dark:border-gray-700 dark:text-white/90"
              >
                {GUARANTOR_DOCUMENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {errors.documentType && (
                <p className="text-error-500 mt-1.5 text-sm">
                  {errors.documentType[0]}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="guarantor-documentNumber"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Document Number
              </label>
              <input
                id="guarantor-documentNumber"
                name="documentNumber"
                maxLength={100}
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm dark:border-gray-700 dark:text-white/90"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="guarantor-file"
              className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
            >
              File <span className="text-error-500">*</span>
            </label>
            <input
              id="guarantor-file"
              type="file"
              name="file"
              accept="image/jpeg,image/png,application/pdf"
              className="w-full text-sm text-gray-600 dark:text-gray-300"
            />
            {errors.file && (
              <p className="text-error-500 mt-1.5 text-sm">{errors.file[0]}</p>
            )}
          </div>

          <div className="flex justify-end">
            <SubmitButton label="Upload Document" />
          </div>
        </form>
      )}

      {canSubmit && guarantor.kycStatus !== "APPROVED" && (
        <form action={submitFormAction} className="flex justify-end">
          {ids}
          <input
            type="hidden"
            name="expectedVersion"
            value={guarantor.version}
          />
          <SubmitButton label="Submit for Review" variant="outline" />
        </form>
      )}

      {canReview && guarantor.kycStatus !== "NOT_REQUIRED" && (
        <form
          action={reviewFormAction}
          className="space-y-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-800"
        >
          {ids}
          <input
            type="hidden"
            name="expectedVersion"
            value={guarantor.version}
          />

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-700 dark:text-gray-400">
              Decision
            </legend>

            {(
              [
                ["APPROVE", "Approve"],
                ["REQUEST_REVISION", "Request revision"],
                ["REJECT", "Reject"],
              ] as const
            ).map(([value, text]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="decision"
                  value={value}
                  checked={decision === value}
                  onChange={() => setDecision(value)}
                  /*
                    Scenario 21 — approval is refused server-side until every
                    required document is verified. Disabling it here explains
                    why before the reviewer meets the error, rather than
                    instead of the check.
                  */
                  disabled={value === "APPROVE" && !approvable}
                />
                <span
                  className={
                    value === "APPROVE" && !approvable
                      ? "text-gray-400 dark:text-gray-600"
                      : "text-gray-700 dark:text-gray-300"
                  }
                >
                  {text}
                </span>
              </label>
            ))}
          </fieldset>

          {decision !== "APPROVE" && (
            <div>
              <label
                htmlFor="guarantor-review-reason"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Reason <span className="text-error-500">*</span>
              </label>
              <textarea
                id="guarantor-review-reason"
                name="reason"
                rows={3}
                maxLength={1000}
                className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2 text-sm dark:border-gray-700 dark:text-white/90"
              />
              {errors.reason && (
                <p className="text-error-500 mt-1.5 text-sm">
                  {errors.reason[0]}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <SubmitButton label="Record Decision" />
          </div>
        </form>
      )}
    </div>
  );
}
