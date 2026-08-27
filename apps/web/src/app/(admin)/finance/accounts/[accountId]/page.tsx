import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  AccountDangerZone,
  AccountDetailPanel,
  AccountForm,
  fetchAccount,
  fetchAccounts,
} from "@/features/accounting";

export const metadata: Metadata = {
  title: "Account",
};

export const dynamic = "force-dynamic";

/**
 * Account detail (Module 14, Scenarios 3, 7-10).
 *
 * The edit form and the lifecycle controls render only for a caller who holds
 * `accounts.manage`. That is presentation: the API refuses regardless, which is
 * what Scenario 48 asserts.
 */
export default async function AccountPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.ACCOUNTING_ACCOUNTS_VIEW);
  const { accountId } = await params;

  const [account, chart] = await Promise.all([
    fetchAccount(accountId),
    fetchAccounts(),
  ]);

  if (account.status === "not-found") notFound();

  if (account.status !== "ok") {
    return (
      <div>
        <PageBreadcrumb pageTitle="Account" />
        <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          We could not load this account. Please try again.
        </p>
      </div>
    );
  }

  const canManage = hasPermissions(
    user,
    PERMISSIONS.ACCOUNTING_ACCOUNTS_MANAGE,
  );

  // An account cannot be its own parent, so it is excluded from its own
  // candidate list. Deeper cycles are refused by the service and, under
  // concurrency, by the `accounts_hierarchy_acyclic` trigger.
  const parentOptions =
    chart.status === "ok"
      ? chart.accounts.filter(
          (candidate) => candidate.accountId !== account.account.accountId,
        )
      : [];

  return (
    <div>
      <PageBreadcrumb pageTitle={account.account.accountCode} />

      <div className="space-y-6">
        <AccountDetailPanel account={account.account} />

        {canManage && (
          <>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
              <h3 className="mb-5 text-sm font-medium text-gray-700 dark:text-gray-400">
                Edit
              </h3>
              <AccountForm
                account={account.account}
                parentOptions={parentOptions}
              />
            </div>

            <AccountDangerZone account={account.account} />
          </>
        )}
      </div>
    </div>
  );
}
