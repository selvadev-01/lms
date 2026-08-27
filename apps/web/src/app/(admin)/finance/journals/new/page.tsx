import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { JournalForm, fetchPostableAccounts } from "@/features/accounting";

export const metadata: Metadata = {
  title: "New Journal",
};

export const dynamic = "force-dynamic";

/**
 * Author a manual journal (Module 14, Scenario 12).
 *
 * The account picker is narrowed to accounts open to manual posting, so a
 * control account such as Loan Receivable never appears in it. The server
 * refuses one independently — this is convenience, not the control.
 */
export default async function NewJournalPage() {
  await requirePermissions(PERMISSIONS.ACCOUNTING_JOURNALS_CREATE);

  const accounts = await fetchPostableAccounts();

  return (
    <div>
      <PageBreadcrumb pageTitle="New Journal" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        {accounts.status === "ok" ? (
          <JournalForm accounts={accounts.accounts} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load the chart of accounts, so a journal cannot be
            written right now. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
