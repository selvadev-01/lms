"use client";

import type {
  ApplicationCompleteness,
  ApprovalReadiness,
  CreditAssessmentHistory,
  LoanApplicationDetail,
  LoanApplicationHistoryEntry,
  SanctionLetterDetail,
} from "@lms/types";
import { Alert } from "@lms/ui";
import {
  APPLICATION_DOCUMENT_TYPE_OPTIONS,
  CREDIT_ASSESSMENT_RESULT_OPTIONS,
  INTEREST_TYPE_OPTIONS,
  LOAN_TYPE_OPTIONS,
  REPAYMENT_FREQUENCY_OPTIONS,
  labelFor,
} from "@lms/validation";
import React, { useActionState, useState } from "react";

import { recordCreditAssessmentAction } from "../actions/credit-assessment-actions";
import {
  acceptSanctionAction,
  approveApplicationAction,
  declineSanctionAction,
  deleteDraftAction,
  issueSanctionAction,
  modifyTermsAction,
  recordAgreementAction,
  rejectApplicationAction,
  requestMoreInfoAction,
  startReviewAction,
  submitApplicationAction,
  type ApplicationFormState,
} from "../actions/loan-application-actions";
import {
  uploadApplicationDocumentAction,
  verifyApplicationDocumentAction,
} from "../actions/loan-document-actions";
import CompletenessSummary from "./CompletenessSummary";
import EmiSchedulePanel from "./EmiSchedulePanel";
import { Field, SelectField, SubmitButton, TextAreaField } from "./FormParts";
import {
  ApplicationStatusBadge,
  ApplicationDocumentStatusBadge,
  formatBps,
  formatDate,
  formatPaise,
} from "./LoanBadges";

export interface Capabilities {
  canEdit: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canModifyTerms: boolean;
  canApprove: boolean;
  canReject: boolean;
  canDeleteDraft: boolean;
  canUpload: boolean;
  canVerify: boolean;
  canDownload: boolean;
  // Module 08. `canIssueSanction` is withheld from Branch Admin server-side;
  // the other three are branch work.
  canViewAssessment: boolean;
  canRecordAssessment: boolean;
  canIssueSanction: boolean;
  canRecordSanctionResponse: boolean;
  canRecordAgreement: boolean;
}

/**
 * Application detail and review screen (APP-002).
 *
 * This is also wizard steps 5 and 6 — documents and review-and-submit — because
 * both need an application that exists. See `ApplicationWizard` for why the
 * draft is created after step 4 rather than before step 1.
 *
 * # Which actions appear
 *
 * Two conditions gate every control: the caller's permission, and the
 * application's current status. Both are needed. Permission alone would offer
 * "Approve" on a draft; status alone would offer it to someone who cannot
 * approve. Neither is a security control — the API re-checks both — but an
 * interface that offers an action it knows will be refused is lying to the user.
 */
export default function ApplicationDetail({
  application,
  completeness,
  history,
  capabilities,
  assessment,
  sanction,
  readiness,
}: {
  application: LoanApplicationDetail;
  completeness: ApplicationCompleteness | null;
  history: LoanApplicationHistoryEntry[];
  capabilities: Capabilities;
  assessment: CreditAssessmentHistory | null;
  sanction: SanctionLetterDetail | null;
  readiness: ApprovalReadiness | null;
}) {
  const { status, version, applicationId } = application;

  const isDraft = status === "DRAFT";
  const needsInfo = status === "MORE_INFO_REQUIRED";
  const isSubmitted = status === "SUBMITTED";
  const underReview = status === "UNDER_REVIEW";
  const isApproved = status === "APPROVED";
  const isSanctioned = status === "SANCTIONED";
  const customerAccepted = status === "CUSTOMER_ACCEPTED";
  /**
   * Only the genuinely terminal states.
   *
   * APPROVED was here until Module 08 and must not come back: it is now a step
   * on the way to SANCTIONED, and leaving it in would make `ActionsPanel`
   * early-return on exactly the applications whose next action is "Issue
   * sanction letter" — hiding the whole module behind a message saying the
   * application can no longer be changed.
   */
  const decided = status === "REJECTED" || status === "AGREEMENT_SIGNED";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">
              {application.applicationNumber}
            </h2>
            <ApplicationStatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {application.customerName} ({application.customerCode}) ·{" "}
            {application.branchName}
          </p>
        </div>

        <div className="text-right">
          <p className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            {formatPaise(application.requestedAmountPaise)}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {labelFor(LOAN_TYPE_OPTIONS, application.loanType)} ·{" "}
            {application.schemeName}
          </p>
        </div>
      </header>

      {status === "REJECTED" && application.rejectionReason && (
        <Alert
          variant="error"
          title="Application rejected"
          message={application.rejectionReason}
        />
      )}

      {isApproved && (
        <Alert
          variant="success"
          title="Application approved"
          // Rule 42 / Scenario 30: approval is not disbursement, and saying so
          // here is the difference between a clerk waiting and a clerk paying out.
          message="Approval does not release funds. The sanction letter, customer agreement and signed loan agreement are still required before disbursement."
        />
      )}

      {isSanctioned && (
        <Alert
          variant="info"
          title="Sanction letter issued"
          message="Awaiting the customer's response. Record their acceptance or decline below."
        />
      )}

      {customerAccepted && (
        <Alert
          variant="info"
          title="Customer accepted the sanction"
          message="The signed loan agreement is still required before disbursement."
        />
      )}

      {status === "AGREEMENT_SIGNED" && (
        <Alert
          variant="success"
          title="Agreement signed"
          message="This application is complete and awaiting disbursement."
        />
      )}

      <section className="grid gap-4 rounded-2xl border border-gray-200 p-5 sm:grid-cols-3 dark:border-gray-800">
        <Detail label="Purpose" value={application.purpose ?? "—"} />
        <Detail
          label="Interest"
          value={`${labelFor(INTEREST_TYPE_OPTIONS, application.interestType)} at ${formatBps(application.interestRateBps)}`}
        />
        <Detail
          label="Term"
          value={`${application.durationCount} × ${labelFor(REPAYMENT_FREQUENCY_OPTIONS, application.repaymentFrequency)}`}
        />
        <Detail
          label="Scheme"
          value={`${application.schemeName} (${application.schemeCode})`}
        />
        <Detail label="Submitted" value={formatDate(application.submittedAt)} />
        <Detail label="Approved" value={formatDate(application.approvedAt)} />
        {application.sanctionedAt && (
          <Detail
            label="Sanctioned"
            value={formatDate(application.sanctionedAt)}
          />
        )}
        {application.agreementSignedAt && (
          <Detail
            label="Agreement signed"
            value={formatDate(application.agreementSignedAt)}
          />
        )}
      </section>

      <EmiSchedulePanel schedule={application.emi} title="Repayment Schedule" />

      <DocumentsPanel
        application={application}
        capabilities={capabilities}
        frozen={decided}
      />

      {(isDraft || needsInfo) && completeness && (
        <CompletenessSummary completeness={completeness} />
      )}

      {/* Scenarios 6, 13 — the outstanding requirements stay visible. */}
      {underReview && readiness && !readiness.approvable && (
        <ApprovalReadinessPanel readiness={readiness} />
      )}

      {capabilities.canViewAssessment &&
        (underReview || needsInfo || assessment) && (
          <CreditAssessmentPanel
            applicationId={applicationId}
            assessment={assessment}
            canRecord={
              capabilities.canRecordAssessment && (underReview || needsInfo)
            }
          />
        )}

      {(sanction || isApproved) && (
        <SanctionPanel
          applicationId={applicationId}
          version={version}
          sanction={sanction}
          capabilities={capabilities}
          state={{ isApproved, isSanctioned, customerAccepted }}
        />
      )}

      <ActionsPanel
        applicationId={applicationId}
        version={version}
        capabilities={capabilities}
        state={{ isDraft, needsInfo, isSubmitted, underReview, decided }}
        submittable={completeness?.submittable ?? false}
      />

      {history.length > 0 && <HistoryPanel history={history} />}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-1 text-sm text-gray-800 dark:text-white/90">{value}</dd>
    </div>
  );
}

function DocumentsPanel({
  application,
  capabilities,
  frozen,
}: {
  application: LoanApplicationDetail;
  capabilities: Capabilities;
  frozen: boolean;
}) {
  const [uploadState, uploadAction] = useActionState(
    uploadApplicationDocumentAction,
    {},
  );
  const [verifyState, verifyAction] = useActionState(
    verifyApplicationDocumentAction,
    {},
  );

  const byType = new Map(
    application.documents.map((document) => [document.documentType, document]),
  );

  return (
    <section className="space-y-4">
      <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
        Supporting Documents
      </h3>

      {uploadState.message && (
        <Alert
          variant="error"
          title="Upload failed"
          message={uploadState.message}
        />
      )}
      {uploadState.success && (
        <Alert
          variant="success"
          title="Uploaded"
          message={uploadState.success}
        />
      )}
      {verifyState.message && (
        <Alert
          variant="error"
          title="Could not record decision"
          message={verifyState.message}
        />
      )}

      <ul className="divide-y divide-gray-200 rounded-2xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {APPLICATION_DOCUMENT_TYPE_OPTIONS.map(({ value: type, label }) => {
          const document = byType.get(type);

          return (
            <li key={type} className="space-y-3 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {label}
                    {document && (
                      <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                        v{document.version} · {document.fileName ?? "file"}
                      </span>
                    )}
                  </p>
                  {!document && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Not attached
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {document && (
                    <ApplicationDocumentStatusBadge status={document.status} />
                  )}
                  {document && capabilities.canDownload && (
                    <a
                      href={`/api/loan-applications/${application.applicationId}/documents/${document.applicationDocumentId}/file`}
                      className="text-brand-500 text-sm hover:underline"
                    >
                      Download
                    </a>
                  )}
                </div>
              </div>

              {document?.status === "REJECTED" &&
                document.verificationReason && (
                  <p className="text-error-500 text-xs">
                    {document.verificationReason}
                  </p>
                )}

              {capabilities.canUpload && !frozen && (
                <form
                  action={uploadAction}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input
                    type="hidden"
                    name="applicationId"
                    value={application.applicationId}
                  />
                  <input type="hidden" name="documentType" value={type} />
                  <input
                    type="file"
                    name="file"
                    accept="image/jpeg,image/png,application/pdf"
                    aria-label={`Upload ${type} document`}
                    className="text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm dark:text-gray-400 dark:file:bg-white/[0.06] dark:file:text-gray-300"
                  />
                  <SubmitButton
                    label={document ? "Replace" : "Upload"}
                    pendingLabel="Uploading…"
                  />
                </form>
              )}

              {document && capabilities.canVerify && !frozen && (
                <form
                  action={verifyAction}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input
                    type="hidden"
                    name="applicationId"
                    value={application.applicationId}
                  />
                  <input
                    type="hidden"
                    name="documentId"
                    value={document.applicationDocumentId}
                  />
                  <div className="w-44">
                    <SelectField
                      name="status"
                      label="Decision"
                      options={[
                        { value: "VERIFIED", label: "Verify" },
                        { value: "REJECTED", label: "Reject" },
                      ]}
                      errors={verifyState.errors?.status}
                    />
                  </div>
                  <div className="min-w-[14rem] flex-1">
                    <Field
                      name="verificationReason"
                      label="Reason (required to reject)"
                      maxLength={500}
                      errors={verifyState.errors?.verificationReason}
                    />
                  </div>
                  <SubmitButton label="Record" pendingLabel="Recording…" />
                </form>
              )}
            </li>
          );
        })}
      </ul>

      {frozen && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          This application has been decided. Its documents are fixed so the
          evidence the decision rested on cannot change.
        </p>
      )}
    </section>
  );
}

/**
 * What is still standing between this application and approval.
 *
 * Rendered only while something is outstanding, and only under review — a green
 * "nothing is blocking you" panel would be noise on every other screen. The
 * server re-runs each of these gates twice during the approval itself, so this
 * is advisory: it exists so a reviewer learns what is missing before pressing
 * Approve rather than from a refusal afterwards (Scenarios 6, 13).
 */
function ApprovalReadinessPanel({
  readiness,
}: {
  readiness: ApprovalReadiness;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-500/30 dark:bg-amber-500/10">
      <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
        Before this can be approved
      </h3>

      <ul className="space-y-2">
        {readiness.blockers.map((blocker) => (
          <li
            key={blocker.key}
            className="flex gap-2 text-sm text-gray-700 dark:text-gray-300"
          >
            <span aria-hidden="true">•</span>
            <span>
              {blocker.reason}
              {blocker.key === "DOCUMENTS" &&
                Array.isArray(blocker.details?.missingDocumentTypes) && (
                  <>
                    {": "}
                    {(blocker.details.missingDocumentTypes as string[]).join(
                      ", ",
                    )}
                  </>
                )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Credit assessment — CIBIL and income check (Scenarios 7, 8, 9).
 *
 * Recording supersedes rather than edits, so the form always starts empty
 * rather than pre-filled with the current finding: pre-filling would suggest
 * the reviewer is amending a record, when in fact they are making a new one
 * that displaces it. The superseded findings stay visible below.
 */
function CreditAssessmentPanel({
  applicationId,
  assessment,
  canRecord,
}: {
  applicationId: string;
  assessment: CreditAssessmentHistory | null;
  canRecord: boolean;
}) {
  const [state, action] = useActionState(recordCreditAssessmentAction, {});
  const [showForm, setShowForm] = useState(false);
  const current = assessment?.current ?? null;
  const superseded = assessment?.superseded ?? [];

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
          Credit Assessment
        </h3>

        {canRecord && (
          <button
            type="button"
            onClick={() => setShowForm((open) => !open)}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
          >
            {showForm
              ? "Cancel"
              : current
                ? "Record New Assessment"
                : "Record Assessment"}
          </button>
        )}
      </div>

      <Feedback states={[state]} />

      {current ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Detail
            label="Result"
            value={labelFor(
              CREDIT_ASSESSMENT_RESULT_OPTIONS,
              current.assessmentResult ?? "",
            )}
          />
          <Detail
            label="CIBIL Score"
            value={current.cibilScore?.toString() ?? "—"}
          />
          <Detail
            label="Income Check"
            value={
              current.incomeVerified === undefined
                ? "Not checked"
                : current.incomeVerified
                  ? "Verified"
                  : "Not verified"
            }
          />
          <Detail label="Assessed by" value={current.assessorName ?? "—"} />
          <Detail label="Assessed" value={formatDate(current.assessedAt)} />
          {current.incomeMonthlyPaise && (
            <Detail
              label="Monthly Income"
              value={formatPaise(current.incomeMonthlyPaise)}
            />
          )}
          {current.assessmentNotes && (
            <div className="sm:col-span-3">
              <Detail label="Notes" value={current.assessmentNotes} />
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No credit assessment has been recorded. Approval is blocked until one
          is.
        </p>
      )}

      {showForm && canRecord && (
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="applicationId" value={applicationId} />

          <Field
            name="cibilScore"
            label="CIBIL Score"
            type="number"
            inputMode="numeric"
            errors={state.errors?.cibilScore}
            hint="300–900. Leave blank if not obtained."
          />

          <SelectField
            name="incomeVerified"
            label="Income Check"
            required
            options={[
              { value: "true", label: "Verified" },
              { value: "false", label: "Not verified" },
            ]}
            errors={state.errors?.incomeVerified}
          />

          <SelectField
            name="assessmentResult"
            label="Assessment Result"
            required
            options={CREDIT_ASSESSMENT_RESULT_OPTIONS}
            errors={state.errors?.assessmentResult}
            hint="Only a Pass allows approval. Manual review blocks it."
          />

          <Field
            name="incomeMonthlyPaise"
            label="Monthly Income (paise)"
            inputMode="numeric"
            errors={state.errors?.incomeMonthlyPaise}
          />

          <div className="sm:col-span-2">
            <TextAreaField
              name="assessmentNotes"
              label="Assessment Notes"
              maxLength={2000}
              errors={state.errors?.assessmentNotes}
            />
          </div>

          <div className="sm:col-span-2">
            <SubmitButton label="Record Assessment" pendingLabel="Recording…" />
          </div>
        </form>
      )}

      {superseded.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500 dark:text-gray-400">
            {superseded.length} earlier assessment
            {superseded.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-3 space-y-2">
            {superseded.map((entry) => (
              <li
                key={entry.assessmentId}
                className="rounded-lg border border-gray-200 p-3 dark:border-gray-800"
              >
                <p className="text-gray-700 dark:text-gray-300">
                  {labelFor(
                    CREDIT_ASSESSMENT_RESULT_OPTIONS,
                    entry.assessmentResult ?? "",
                  )}
                  {entry.cibilScore ? ` · CIBIL ${entry.cibilScore}` : ""}
                  {" · "}
                  {formatDate(entry.assessedAt)}
                  {entry.assessorName ? ` · ${entry.assessorName}` : ""}
                </p>
                {entry.assessmentNotes && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {entry.assessmentNotes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * Sanction letter, customer response and agreement signing (Scenarios 30-34).
 *
 * The letter's terms are read-only: they are snapshotted server-side from the
 * approved application, so there is nothing here to edit. Offering fields would
 * imply a reviewer could sanction terms other than the ones approved.
 *
 * Decline sits behind a disclosure toggle rather than beside Accept, mirroring
 * how Reject is handled in `ActionsPanel`: the reason is mandatory, and a
 * one-click destructive control next to the ordinary one invites the misclick.
 */
function SanctionPanel({
  applicationId,
  version,
  sanction,
  capabilities,
  state,
}: {
  applicationId: string;
  version: string;
  sanction: SanctionLetterDetail | null;
  capabilities: Capabilities;
  state: {
    isApproved: boolean;
    isSanctioned: boolean;
    customerAccepted: boolean;
  };
}) {
  const [issueState, issueAction] = useActionState(issueSanctionAction, {});
  const [acceptState, acceptAction] = useActionState(acceptSanctionAction, {});
  const [declineState, declineAction] = useActionState(
    declineSanctionAction,
    {},
  );
  const [agreementState, agreementAction] = useActionState(
    recordAgreementAction,
    {},
  );
  const [showDecline, setShowDecline] = useState(false);

  const hidden = (
    <>
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="expectedVersion" value={version} />
    </>
  );

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
      <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
        Sanction
      </h3>

      <Feedback
        states={[issueState, acceptState, declineState, agreementState]}
      />

      {sanction && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Detail label="Sanction Number" value={sanction.sanctionNumber} />
          <Detail
            label="Sanctioned Amount"
            value={formatPaise(sanction.sanctionedAmountPaise)}
          />
          <Detail
            label="Installment"
            value={formatPaise(sanction.installmentAmountPaise)}
          />
          <Detail
            label="Total Payable"
            value={formatPaise(sanction.totalPayablePaise)}
          />
          <Detail label="Issued" value={formatDate(sanction.issuedAt)} />
          <Detail
            label="Valid Until"
            value={sanction.validUntil ? formatDate(sanction.validUntil) : "—"}
          />
          <Detail
            label="Customer Response"
            value={
              sanction.customerResponse === "PENDING"
                ? "Awaiting response"
                : sanction.customerResponse === "ACCEPTED"
                  ? "Accepted"
                  : "Declined"
            }
          />
          {sanction.customerRespondedAt && (
            <Detail
              label="Responded"
              value={formatDate(sanction.customerRespondedAt)}
            />
          )}
          {sanction.agreementReference && (
            <Detail
              label="Agreement Reference"
              value={sanction.agreementReference}
            />
          )}
          {sanction.declineReason && (
            <div className="sm:col-span-3">
              <Detail label="Decline Reason" value={sanction.declineReason} />
            </div>
          )}
          {sanction.notes && (
            <div className="sm:col-span-3">
              <Detail label="Notes" value={sanction.notes} />
            </div>
          )}
        </div>
      )}

      {state.isApproved && capabilities.canIssueSanction && (
        <form action={issueAction} className="grid gap-4 sm:grid-cols-2">
          {hidden}

          <Field
            name="validUntil"
            label="Valid Until"
            type="date"
            errors={issueState.errors?.validUntil}
            hint="Optional. Recorded on the letter; not enforced."
          />

          <div className="sm:col-span-2">
            <TextAreaField
              name="notes"
              label="Notes"
              maxLength={1000}
              errors={issueState.errors?.notes}
            />
          </div>

          <p className="text-xs text-gray-500 sm:col-span-2 dark:text-gray-400">
            The letter carries the approved terms exactly. They cannot be
            changed here.
          </p>

          <div className="sm:col-span-2">
            <SubmitButton
              label="Issue Sanction Letter"
              pendingLabel="Issuing…"
            />
          </div>
        </form>
      )}

      {state.isSanctioned && capabilities.canRecordSanctionResponse && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <form action={acceptAction}>
              {hidden}
              <SubmitButton
                label="Record Acceptance"
                pendingLabel="Recording…"
              />
            </form>

            <button
              type="button"
              onClick={() => setShowDecline((open) => !open)}
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
            >
              {showDecline ? "Cancel" : "Record Decline"}
            </button>
          </div>

          {showDecline && (
            <form action={declineAction} className="space-y-4">
              {hidden}

              <TextAreaField
                name="declineReason"
                label="Decline Reason"
                required
                maxLength={1000}
                errors={declineState.errors?.declineReason}
              />

              <p className="text-xs text-gray-500 dark:text-gray-400">
                Recording a decline rejects the application. The reason is kept
                as its rejection reason.
              </p>

              <SubmitButton label="Confirm Decline" pendingLabel="Recording…" />
            </form>
          )}
        </div>
      )}

      {state.customerAccepted && capabilities.canRecordAgreement && (
        <form action={agreementAction} className="grid gap-4 sm:grid-cols-2">
          {hidden}

          <Field
            name="signedDate"
            label="Signed Date"
            type="date"
            errors={agreementState.errors?.signedDate}
            hint="Optional. Defaults to today."
          />

          <Field
            name="agreementReference"
            label="Agreement Reference"
            maxLength={100}
            errors={agreementState.errors?.agreementReference}
          />

          <div className="sm:col-span-2">
            <SubmitButton
              label="Record Signed Agreement"
              pendingLabel="Recording…"
            />
          </div>
        </form>
      )}
    </section>
  );
}

function ActionsPanel({
  applicationId,
  version,
  capabilities,
  state,
  submittable,
}: {
  applicationId: string;
  version: string;
  capabilities: Capabilities;
  state: {
    isDraft: boolean;
    needsInfo: boolean;
    isSubmitted: boolean;
    underReview: boolean;
    decided: boolean;
  };
  submittable: boolean;
}) {
  const [submitState, submitAction] = useActionState(
    submitApplicationAction,
    {},
  );
  const [reviewState, reviewAction] = useActionState(startReviewAction, {});
  const [infoState, infoAction] = useActionState(requestMoreInfoAction, {});
  const [termsState, termsAction] = useActionState(modifyTermsAction, {});
  const [approveState, approveAction] = useActionState(
    approveApplicationAction,
    {},
  );
  const [rejectState, rejectAction] = useActionState(
    rejectApplicationAction,
    {},
  );
  const [deleteState, deleteAction] = useActionState(deleteDraftAction, {});

  const [showTerms, setShowTerms] = useState(false);
  const [showReject, setShowReject] = useState(false);

  if (state.decided) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        This application has been decided and can no longer be changed.
      </p>
    );
  }

  const hidden = (
    <>
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="expectedVersion" value={version} />
    </>
  );

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
      <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
        Actions
      </h3>

      <Feedback
        states={[
          submitState,
          reviewState,
          infoState,
          termsState,
          approveState,
          rejectState,
          deleteState,
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        {(state.isDraft || state.needsInfo) && capabilities.canSubmit && (
          <form action={submitAction}>
            {hidden}
            <SubmitButton
              label={
                state.needsInfo ? "Return to Review" : "Submit Application"
              }
              pendingLabel="Submitting…"
            />
          </form>
        )}

        {state.isSubmitted && capabilities.canReview && (
          <form action={reviewAction}>
            {hidden}
            <SubmitButton label="Start Review" pendingLabel="Starting…" />
          </form>
        )}

        {state.underReview && capabilities.canModifyTerms && (
          <button
            type="button"
            onClick={() => setShowTerms((open) => !open)}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
          >
            {showTerms ? "Cancel" : "Modify Terms"}
          </button>
        )}

        {state.underReview && capabilities.canApprove && (
          <form action={approveAction}>
            {hidden}
            <SubmitButton label="Approve" pendingLabel="Approving…" />
          </form>
        )}

        {(state.underReview || state.isSubmitted) && capabilities.canReject && (
          <button
            type="button"
            onClick={() => setShowReject((open) => !open)}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
          >
            {showReject ? "Cancel" : "Reject"}
          </button>
        )}

        {state.isDraft && capabilities.canDeleteDraft && (
          <form action={deleteAction}>
            <input type="hidden" name="applicationId" value={applicationId} />
            <SubmitButton
              label="Delete Draft"
              pendingLabel="Deleting…"
              variant="outline"
            />
          </form>
        )}
      </div>

      {(state.isDraft || state.needsInfo) &&
        capabilities.canSubmit &&
        !submittable && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Submission is blocked until every check in the validation summary
            passes.
          </p>
        )}

      {state.underReview && capabilities.canReview && (
        <form
          action={infoAction}
          className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-800"
        >
          {hidden}
          <TextAreaField
            name="comments"
            label="Request more information"
            required
            maxLength={1000}
            placeholder="Say exactly what is needed — a request without specifics is a round trip that helps nobody."
            errors={infoState.errors?.comments}
          />
          <SubmitButton
            label="Request More Info"
            pendingLabel="Sending…"
            variant="outline"
          />
        </form>
      )}

      {showTerms && (
        <form
          action={termsAction}
          className="grid gap-4 border-t border-gray-200 pt-4 sm:grid-cols-2 dark:border-gray-800"
        >
          {hidden}
          <SelectField
            name="interestType"
            label="Interest Type"
            required
            options={INTEREST_TYPE_OPTIONS}
            errors={termsState.errors?.interestType}
          />
          <Field
            name="interestRateBps"
            label="Interest Rate (basis points)"
            required
            inputMode="numeric"
            hint="1200 is 12% a year."
            errors={termsState.errors?.interestRateBps}
          />
          <SelectField
            name="repaymentFrequency"
            label="Frequency"
            required
            options={REPAYMENT_FREQUENCY_OPTIONS}
            errors={termsState.errors?.repaymentFrequency}
          />
          <Field
            name="durationCount"
            label="Duration (periods)"
            required
            inputMode="numeric"
            errors={termsState.errors?.durationCount}
          />
          <div className="sm:col-span-2">
            <TextAreaField
              name="comments"
              label="Why the terms changed"
              required
              maxLength={1000}
              errors={termsState.errors?.comments}
            />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton
              label="Save Terms & Recalculate"
              pendingLabel="Saving…"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              The previous terms are kept in the review history, and the EMI is
              recalculated before the change is stored.
            </p>
          </div>
        </form>
      )}

      {showReject && (
        <form
          action={rejectAction}
          className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-800"
        >
          {hidden}
          <TextAreaField
            name="rejectionReason"
            label="Rejection Reason"
            required
            maxLength={1000}
            placeholder="Recorded against the application permanently."
            errors={rejectState.errors?.rejectionReason}
          />
          <SubmitButton
            label="Reject Application"
            pendingLabel="Rejecting…"
            variant="outline"
          />
        </form>
      )}
    </section>
  );
}

/** Renders whichever action last said something, so messages do not stack. */
function Feedback({ states }: { states: ApplicationFormState[] }) {
  const failed = states.find((state) => state.message);
  const succeeded = states.find((state) => state.success);
  // A validation failure sets `errors` and no `message`. Without this branch the
  // panel would render nothing at all, and a user who had scrolled past the form
  // would see their click do nothing — the field-level messages are below the
  // fold. Reported here as a summary; the fields still carry their own text.
  const invalid = states.find(
    (state) =>
      !state.message && state.errors && Object.keys(state.errors).length > 0,
  );

  if (failed) {
    return (
      <div className="space-y-2">
        <Alert
          variant="error"
          title="Could not complete that action"
          message={failed.message ?? ""}
        />
        {failed.failedChecks && failed.failedChecks.length > 0 && (
          <ul className="text-error-500 list-inside list-disc text-sm">
            {failed.failedChecks.map((check) => (
              <li key={check.key}>
                {check.key.replace(/_/g, " ").toLowerCase()}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (invalid) {
    const fields = Object.values(invalid.errors ?? {})
      .flatMap((messages) => messages ?? [])
      .filter(Boolean);

    return (
      <Alert
        variant="warning"
        title="Check the highlighted fields"
        message={fields[0] ?? "Some required information is missing."}
      />
    );
  }

  if (succeeded) {
    return (
      <Alert variant="success" title="Done" message={succeeded.success ?? ""} />
    );
  }

  return null;
}

function HistoryPanel({ history }: { history: LoanApplicationHistoryEntry[] }) {
  return (
    <section className="space-y-3">
      <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
        Review History
      </h3>

      <ol className="divide-y divide-gray-200 rounded-2xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {history.map((entry) => (
          <li key={entry.reviewId} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-800 dark:text-white/90">
                {entry.decision.replace(/_/g, " ").toLowerCase()} —{" "}
                {entry.reviewerName}
              </p>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {formatDate(entry.createdAt)}
              </span>
            </div>

            {entry.comments && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {entry.comments}
              </p>
            )}

            {entry.rejectionReason && (
              <p className="text-error-500 mt-1 text-xs">
                {entry.rejectionReason}
              </p>
            )}

            {/* The pre-change terms, which is what makes the whole history
                reconstructible — the earliest of these rows carries the terms the
                application was originally submitted with (Scenario 60). */}
            {entry.previousDurationCount !== undefined && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Previously {entry.previousDurationCount} ×{" "}
                {(entry.previousFrequency ?? "").toLowerCase()} at{" "}
                {entry.previousInterestRateBps
                  ? formatBps(entry.previousInterestRateBps)
                  : "—"}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
