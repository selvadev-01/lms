import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  DisbursementDetail,
  fetchDisbursalReadiness,
  fetchDisbursement,
  fetchDisbursementLedger,
  fetchFundingAccounts,
  fetchRepaymentSchedule,
} from "@/features/disbursements";

export const metadata: Metadata = {
  title: "Disbursement",
};

export const dynamic = "force-dynamic";

/**
 * Disbursement detail (Module 09, Scenario 2).
 *
 * Five reads in parallel. Three of them — readiness, ledger and schedule —
 * legitimately 404 depending on where the disbursement is in its lifecycle, so
 * each is degraded to `null` rather than failing the page: a scheduled
 * disbursement has no ledger entry yet, and that is not an error.
 *
 * # Capabilities
 *
 * Resolved here from the session and passed down, so the component never
 * decides authority for itself. This is presentation only — the API refuses
 * regardless of what is rendered, which is what Scenarios 29 and 30 assert. A
 * Branch Admin sees this page, sees the schedule and transfer panels, and does
 * not see Confirm; calling the endpoint directly still returns 403.
 */
export default async function DisbursementDetailPage({
  params,
}: {
  params: Promise<{ disbursementId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.LOANS_DISBURSEMENTS_VIEW);
  const { disbursementId } = await params;

  const [detail, readiness, ledger, schedule, accounts] = await Promise.all([
    fetchDisbursement(disbursementId),
    fetchDisbursalReadiness(disbursementId),
    fetchDisbursementLedger(disbursementId),
    fetchRepaymentSchedule(disbursementId),
    fetchFundingAccounts(),
  ]);

  // Out of scope, another tenant, or absent — deliberately indistinguishable.
  if (detail.status === "not-found") notFound();
  if (detail.status !== "ok") throw new Error("Could not load disbursement");

  return (
    <div>
      <PageBreadcrumb pageTitle="Disbursement" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <DisbursementDetail
          disbursement={detail.disbursement}
          readiness={readiness.status === "ok" ? readiness.readiness : null}
          ledger={ledger.status === "ok" ? ledger.entry : null}
          schedule={schedule.status === "ok" ? schedule.schedule : null}
          accounts={accounts.status === "ok" ? accounts.accounts : []}
          capabilities={{
            canSchedule: hasPermissions(
              user,
              PERMISSIONS.LOANS_DISBURSEMENTS_SCHEDULE,
            ),
            canRecordTransfer: hasPermissions(
              user,
              PERMISSIONS.LOANS_DISBURSEMENTS_RECORD_TRANSFER,
            ),
            canConfirm: hasPermissions(
              user,
              PERMISSIONS.LOANS_DISBURSEMENTS_CONFIRM,
            ),
            canCancel: hasPermissions(
              user,
              PERMISSIONS.LOANS_DISBURSEMENTS_CANCEL,
            ),
          }}
        />
      </div>
    </div>
  );
}
