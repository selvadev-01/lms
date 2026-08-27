import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { TrialBalanceTable, fetchTrialBalance } from "@/features/accounting";

export const metadata: Metadata = {
  title: "Trial Balance",
};

export const dynamic = "force-dynamic";

/**
 * Every account's balance, and the assertion that they sum to zero.
 *
 * Derived from the journal lines at query time rather than from a stored
 * balance: a materialized total is a second source of truth, and the failure
 * mode of a second source of truth is that it drifts silently.
 */
export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ asOfDate?: string; includeZero?: string }>;
}) {
  await requirePermissions(PERMISSIONS.ACCOUNTING_LEDGER_VIEW);
  const params = await searchParams;

  const result = await fetchTrialBalance({
    asOfDate: params.asOfDate,
    includeZero: params.includeZero === "true",
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Trial Balance" />

      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <form className="flex flex-wrap items-end gap-4" method="get">
            <div>
              <label
                htmlFor="tb-as-of"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                As of
              </label>
              <input
                id="tb-as-of"
                name="asOfDate"
                type="date"
                defaultValue={params.asOfDate}
                className="h-11 rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
              />
            </div>

            <label className="flex items-center gap-2 pb-3 text-sm text-gray-700 dark:text-gray-400">
              <input
                type="checkbox"
                name="includeZero"
                value="true"
                defaultChecked={params.includeZero === "true"}
              />
              Include zero balances
            </label>

            <button
              type="submit"
              className="bg-brand-500 hover:bg-brand-600 h-11 rounded-lg px-5 text-sm font-medium text-white"
            >
              Refresh
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          {result.status === "ok" ? (
            <TrialBalanceTable trialBalance={result.trialBalance} />
          ) : (
            <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
              We could not load the trial balance. Please try again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
