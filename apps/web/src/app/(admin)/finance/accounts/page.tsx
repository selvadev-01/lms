import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import Link from "next/link";
import { Button } from "@lms/ui";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { AccountList, fetchAccounts } from "@/features/accounting";

export const metadata: Metadata = {
  title: "Chart of Accounts",
};

export const dynamic = "force-dynamic";

/**
 * The chart of accounts (Module 14, Scenarios 1, 2).
 *
 * Search and filters come from the URL so a result set is linkable and survives
 * a refresh, and all of them are passed to the API rather than applied here:
 * the server decides which rows the caller may see, and filtering a list the
 * client already holds would mean the out-of-scope rows had already been sent.
 *
 * There is no branch control, here or in the API. Accounts are
 * organization-wide by design — which branch a posting belongs to is carried by
 * the journal entry — so Scenario 2 holds because there are no branch-owned
 * accounts to leak rather than because a filter excludes them.
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    accountType?: string;
    status?: string;
  }>;
}) {
  const user = await requirePermissions(PERMISSIONS.ACCOUNTING_ACCOUNTS_VIEW);
  const params = await searchParams;

  const canManage = hasPermissions(
    user,
    PERMISSIONS.ACCOUNTING_ACCOUNTS_MANAGE,
  );

  const list = await fetchAccounts({
    search: params.search,
    accountType: params.accountType,
    status: params.status,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Chart of Accounts" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        {canManage && (
          <div className="mb-5 flex justify-end">
            <Link href="/finance/accounts/new">
              <Button type="button" size="sm">
                Add account
              </Button>
            </Link>
          </div>
        )}

        {list.status === "ok" ? (
          <AccountList accounts={list.accounts} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load the chart of accounts. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
