import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import {
  fetchDisbursalQueue,
  fetchFundingAccounts,
  ScheduleDisbursementForm,
} from "@/features/disbursements";
import { fetchLoanApplication } from "@/features/loans";
import { Alert } from "@lms/ui";

export const metadata: Metadata = {
  title: "Schedule Disbursement",
};

export const dynamic = "force-dynamic";

/**
 * Schedule a disbursement (Module 09, Scenario 5).
 *
 * The loan is identified by `applicationId` in the query string rather than by
 * a path segment, because at this point no disbursement exists to name — the
 * route creates the first one.
 *
 * # Why the queue is re-read rather than trusted
 *
 * The form needs the loan's summary and the application's current `version`.
 * Both are read fresh here rather than carried from the list page, so a loan
 * that stopped being eligible between the operator clicking "Schedule" and this
 * page rendering is caught now. Finding the entry in the *queue* rather than
 * fetching the application directly is what enforces that: the queue is
 * server-scoped and only ever contains loans this caller may disburse, so an
 * out-of-scope application id resolves to nothing.
 */
export default async function ScheduleDisbursementPage({
  searchParams,
}: {
  searchParams: Promise<{ applicationId?: string }>;
}) {
  await requirePermissions(PERMISSIONS.LOANS_DISBURSEMENTS_SCHEDULE);
  const { applicationId } = await searchParams;

  if (!applicationId) notFound();

  const [queue, accounts, application] = await Promise.all([
    fetchDisbursalQueue(),
    fetchFundingAccounts(),
    fetchLoanApplication(applicationId),
  ]);

  if (queue.status !== "ok" || application.status !== "ok") {
    return (
      <div>
        <PageBreadcrumb pageTitle="Schedule Disbursement" />
        <Alert
          variant="error"
          title="Could not load this loan"
          message="Please go back and try again. If this continues, contact support."
        />
      </div>
    );
  }

  const loan = queue.loans.find(
    (item) => item.applicationId === applicationId && !item.disbursementId,
  );

  // Out of scope, already scheduled, or no longer eligible — deliberately
  // indistinguishable, for the reason `apiGetRecord` collapses a 403.
  if (!loan) notFound();

  return (
    <div>
      <PageBreadcrumb pageTitle="Schedule Disbursement" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        {accounts.status !== "ok" || accounts.accounts.length === 0 ? (
          <Alert
            variant="error"
            title="No disbursement account is available"
            message={
              accounts.status === "ok"
                ? "This organization has no active funding account configured. Contact your administrator."
                : "We could not load the available accounts. Please refresh the page."
            }
          />
        ) : (
          <ScheduleDisbursementForm
            loan={loan}
            accounts={accounts.accounts}
            expectedVersion={application.application.version}
          />
        )}
      </div>
    </div>
  );
}
