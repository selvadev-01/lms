import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import {
  DisbursementQueue,
  fetchDisbursalQueue,
  fetchDisbursements,
} from "@/features/disbursements";

export const metadata: Metadata = {
  title: "Disbursement",
};

export const dynamic = "force-dynamic";

/**
 * The disbursal screen (Module 09, Scenarios 1, 3, 4).
 *
 * Two reads in parallel — the action queue and the disbursement record list.
 * They are independent endpoints and neither depends on the other's result, so
 * awaiting them in sequence would double the page's latency for nothing.
 *
 * Search and status come from the URL so a result set is linkable and survives
 * a refresh, and both are passed to the API rather than applied here: the
 * server decides which rows the caller may see, and filtering a list the client
 * already holds would mean the out-of-scope rows had already been sent.
 *
 * There is no branch control, here or in the API. That absence is what makes
 * Scenario 3 structural rather than a check somebody has to remember.
 */
export default async function DisbursementsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  await requirePermissions(PERMISSIONS.LOANS_DISBURSEMENTS_VIEW);
  const params = await searchParams;

  const [queue, list] = await Promise.all([
    fetchDisbursalQueue(),
    fetchDisbursements({ search: params.search, status: params.status }),
  ]);

  return (
    <div>
      <PageBreadcrumb pageTitle="Disbursement" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <DisbursementQueue
          queue={queue.status === "ok" ? queue.loans : []}
          disbursements={list.status === "ok" ? list.disbursements : []}
          queueError={queue.status !== "ok"}
          listError={list.status !== "ok"}
          initialSearch={params.search ?? ""}
          initialStatus={params.status ?? ""}
        />
      </div>
    </div>
  );
}
