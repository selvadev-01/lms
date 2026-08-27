import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  ApplicationDetail,
  fetchApplicationHistory,
  fetchApprovalReadiness,
  fetchCompleteness,
  fetchCreditAssessment,
  fetchLoanApplication,
  fetchSanctionLetter,
} from "@/features/loans";

export const metadata: Metadata = {
  title: "Loan Application",
};

export const dynamic = "force-dynamic";

/**
 * Application detail and review (APP-002), and wizard steps 5 and 6.
 *
 * `notFound()` on anything but a clean read. `fetchLoanApplication` already
 * collapses a 403 into `not-found`, so an application in another branch renders
 * exactly as one that does not exist — which is what keeps an id from being
 * confirmed by the shape of the refusal (Scenarios 3, 4).
 *
 * The completeness read is skipped once the application has left the draft
 * states: it answers "could this be submitted", and there is nothing to submit
 * from SUBMITTED onwards. Skipping it also avoids a pointless guarantor-readiness
 * query on every reviewer's page load.
 */
export default async function LoanApplicationPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.LOANS_APPLICATIONS_VIEW);
  const { applicationId } = await params;

  const result = await fetchLoanApplication(applicationId);

  if (result.status !== "ok") notFound();

  const { application } = result;
  const editable =
    application.status === "DRAFT" ||
    application.status === "MORE_INFO_REQUIRED";

  const reviewable =
    application.status === "UNDER_REVIEW" ||
    application.status === "MORE_INFO_REQUIRED";

  /**
   * A letter exists from SANCTIONED onwards — and also on a REJECTED
   * application that was declined after sanction, which is why the check is on
   * `sanctionedAt` rather than on the status alone. Reading it there is what
   * keeps the decline reason and the letter visible after the decline.
   */
  const sanctionable =
    application.status === "APPROVED" || Boolean(application.sanctionedAt);

  const canViewAssessment = hasPermissions(
    user,
    PERMISSIONS.LOANS_APPLICATIONS_ASSESSMENT_VIEW,
  );

  const [
    completenessResult,
    historyResult,
    assessmentResult,
    sanctionResult,
    readinessResult,
  ] = await Promise.all([
    editable ? fetchCompleteness(applicationId) : Promise.resolve(null),
    fetchApplicationHistory(applicationId),
    // Skipped without the permission rather than fetched and discarded: the
    // read is audited server-side, and auditing a look nobody was shown would
    // put noise in the one record that must stay meaningful.
    canViewAssessment && (reviewable || sanctionable)
      ? fetchCreditAssessment(applicationId)
      : Promise.resolve(null),
    sanctionable ? fetchSanctionLetter(applicationId) : Promise.resolve(null),
    application.status === "UNDER_REVIEW"
      ? fetchApprovalReadiness(applicationId)
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageBreadcrumb
        pageTitle={`Application ${application.applicationNumber}`}
      />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <ApplicationDetail
          application={application}
          completeness={
            completenessResult?.status === "ok"
              ? completenessResult.completeness
              : null
          }
          history={historyResult.status === "ok" ? historyResult.history : []}
          assessment={
            assessmentResult?.status === "ok"
              ? assessmentResult.assessments
              : null
          }
          sanction={
            sanctionResult?.status === "ok" ? sanctionResult.sanction : null
          }
          readiness={
            readinessResult?.status === "ok" ? readinessResult.readiness : null
          }
          capabilities={{
            canEdit: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_CREATE,
            ),
            canSubmit: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_SUBMIT,
            ),
            canReview: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_REVIEW,
            ),
            canModifyTerms: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_MODIFY_TERMS,
            ),
            canApprove: hasPermissions(user, PERMISSIONS.LOANS_APPROVE),
            canReject: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_REJECT,
            ),
            canDeleteDraft: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_DELETE_DRAFT,
            ),
            canUpload: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_DOCUMENTS_UPLOAD,
            ),
            canVerify: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_DOCUMENTS_VERIFY,
            ),
            canDownload: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_DOCUMENTS_DOWNLOAD,
            ),
            canViewAssessment,
            canRecordAssessment: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_ASSESSMENT_RECORD,
            ),
            canIssueSanction: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_SANCTION_ISSUE,
            ),
            canRecordSanctionResponse: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_SANCTION_RECORD_RESPONSE,
            ),
            canRecordAgreement: hasPermissions(
              user,
              PERMISSIONS.LOANS_APPLICATIONS_AGREEMENT_RECORD,
            ),
          }}
        />
      </div>
    </div>
  );
}
