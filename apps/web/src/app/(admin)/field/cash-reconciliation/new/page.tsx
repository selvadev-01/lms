import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { ReconcileForm, fetchCashHandovers } from "@/features/field";

export const metadata: Metadata = {
  title: "Count Cash",
};

export const dynamic = "force-dynamic";

/**
 * Count the cash against a received handover (Scenarios 26-28).
 *
 * Only `RECEIVED` handovers are offered: a handover that has not reached the
 * branch has nothing to count, and one already `RECONCILED` has been counted.
 * The API refuses anything else, so this narrowing keeps the form from offering
 * a choice that would be rejected.
 */
export default async function NewReconciliationPage() {
  await requirePermissions(PERMISSIONS.CASH_RECONCILIATION_PERFORM);

  const list = await fetchCashHandovers({ status: "RECEIVED" });

  return (
    <div>
      <PageBreadcrumb pageTitle="Count Cash" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        {list.status === "ok" ? (
          <ReconcileForm handovers={list.handovers} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load the handovers waiting to be counted. Please try
            again — no reconciliation has been recorded.
          </p>
        )}
      </div>
    </div>
  );
}
