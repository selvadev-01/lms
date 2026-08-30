import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import {
  ReconciliationReportPanel,
  fetchReconciliation,
} from "@/features/accounting";
import DateField from "@/components/form/DateField";

export const metadata: Metadata = {
  title: "Reconciliation",
};

export const dynamic = "force-dynamic";

/**
 * Source-to-journal reconciliation (Module 14, Scenarios 58-60).
 *
 * Behind its own permission, which a Branch Admin does not hold: reconciliation
 * spans every branch and every source module, and scoping its findings to one
 * branch would report every other branch's postings as missing.
 *
 * Both dates are required by the API. An unbounded run would scan the two
 * largest tables in the system, and "reconcile everything since inception" is
 * not a question anyone asks by accident — so this page shows the form and
 * waits rather than choosing a window on the operator's behalf.
 */
export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ fromDate?: string; toDate?: string }>;
}) {
  await requirePermissions(PERMISSIONS.ACCOUNTING_LEDGER_RECONCILE);
  const params = await searchParams;

  const ready = Boolean(params.fromDate && params.toDate);

  const result = ready
    ? await fetchReconciliation({
        fromDate: params.fromDate!,
        toDate: params.toDate!,
      })
    : null;

  return (
    <div>
      <PageBreadcrumb pageTitle="Reconciliation" />

      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <form className="flex flex-wrap items-end gap-4" method="get">
            <div>
              <label
                htmlFor="rec-from"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                From <span className="text-error-500">*</span>
              </label>
              <DateField
                id="rec-from"
                name="fromDate"
                required
                defaultValue={params.fromDate}
                bare
              />
            </div>

            <div>
              <label
                htmlFor="rec-to"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                To <span className="text-error-500">*</span>
              </label>
              <DateField
                id="rec-to"
                name="toDate"
                required
                defaultValue={params.toDate}
                bare
              />
            </div>

            <button
              type="submit"
              className="bg-brand-500 hover:bg-brand-600 h-11 rounded-lg px-5 text-sm font-medium text-white"
            >
              Run reconciliation
            </button>
          </form>

          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            Reconciliation reads only. It flags an inconsistency for
            investigation and never repairs one — a correction is posted as a
            journal like any other.
          </p>
        </div>

        {result && (
          <>
            {result.status === "ok" ? (
              <ReconciliationReportPanel report={result.report} />
            ) : (
              <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                We could not run reconciliation. Please try again.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
