import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import {
  GeneralLedgerTable,
  fetchAccounts,
  fetchGeneralLedger,
} from "@/features/accounting";

export const metadata: Metadata = {
  title: "General Ledger",
};

export const dynamic = "force-dynamic";

/**
 * One account's postings (Module 14, Scenarios 32, 34).
 *
 * `accountId` is required by the API, and that is a design decision rather than
 * an omission: a ledger with no account filter is a journal listing, which
 * `/finance/journals` already is. Without one this page offers the picker
 * instead of guessing.
 *
 * There is no branch control. Confinement comes from the caller's scope, and
 * the absence of the parameter is what makes Scenario 34 structural.
 */
export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{
    accountId?: string;
    fromDate?: string;
    toDate?: string;
    page?: string;
  }>;
}) {
  await requirePermissions(PERMISSIONS.ACCOUNTING_LEDGER_VIEW);
  const params = await searchParams;

  const chart = await fetchAccounts();

  const ledger = params.accountId
    ? await fetchGeneralLedger({
        accountId: params.accountId,
        fromDate: params.fromDate,
        toDate: params.toDate,
        page: params.page ? Number(params.page) : undefined,
      })
    : null;

  return (
    <div>
      <PageBreadcrumb pageTitle="General Ledger" />

      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <form className="flex flex-wrap items-end gap-4" method="get">
            <div>
              <label
                htmlFor="ledger-account"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Account <span className="text-error-500">*</span>
              </label>
              <select
                id="ledger-account"
                name="accountId"
                defaultValue={params.accountId ?? ""}
                className="h-11 w-72 rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
              >
                <option value="">Select an account…</option>
                {chart.status === "ok" &&
                  chart.accounts.map((account) => (
                    <option key={account.accountId} value={account.accountId}>
                      {account.accountCode} — {account.accountName}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="ledger-from"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                From
              </label>
              <input
                id="ledger-from"
                name="fromDate"
                type="date"
                defaultValue={params.fromDate}
                className="h-11 rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
              />
            </div>

            <div>
              <label
                htmlFor="ledger-to"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                To
              </label>
              <input
                id="ledger-to"
                name="toDate"
                type="date"
                defaultValue={params.toDate}
                className="h-11 rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
              />
            </div>

            <button
              type="submit"
              className="bg-brand-500 hover:bg-brand-600 h-11 rounded-lg px-5 text-sm font-medium text-white"
            >
              View ledger
            </button>
          </form>
        </div>

        {ledger && (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            {ledger.status === "ok" ? (
              <GeneralLedgerTable ledger={ledger.ledger} />
            ) : (
              <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                {ledger.status === "not-found"
                  ? "That account is not available."
                  : "We could not load the ledger. Please try again."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
