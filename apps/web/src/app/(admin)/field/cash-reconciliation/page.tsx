import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import Link from "next/link";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  CashReconciliationList,
  fetchCashReconciliations,
} from "@/features/field";

export const metadata: Metadata = {
  title: "Cash Reconciliation",
};

export const dynamic = "force-dynamic";

/**
 * Reconciliations within the caller's branch (Scenario 5).
 *
 * Distinct from `/finance/reconciliation`, which compares every source
 * transaction in the organization against the journal. This one counts physical
 * cash against what a branch recorded receiving from one agent — a different
 * question, a different scope, and a different permission.
 */
export default async function CashReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    discrepancyType?: string;
    fromDate?: string;
    toDate?: string;
  }>;
}) {
  const user = await requirePermissions(PERMISSIONS.CASH_RECONCILIATION_VIEW);
  const params = await searchParams;

  const list = await fetchCashReconciliations({
    search: params.search,
    status: params.status,
    discrepancyType: params.discrepancyType,
    fromDate: params.fromDate,
    toDate: params.toDate,
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageBreadcrumb pageTitle="Cash Reconciliation" />

        {hasPermissions(user, PERMISSIONS.CASH_RECONCILIATION_PERFORM) ? (
          <Link
            href="/field/cash-reconciliation/new"
            className="bg-brand-500 hover:bg-brand-600 rounded-lg px-4 py-2.5 text-sm font-medium text-white"
          >
            Count cash
          </Link>
        ) : null}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        {list.status === "ok" ? (
          <CashReconciliationList reconciliations={list.reconciliations} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load reconciliations. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
