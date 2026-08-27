import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { AccountForm, fetchAccounts } from "@/features/accounting";

export const metadata: Metadata = {
  title: "New Account",
};

export const dynamic = "force-dynamic";

/** Create an account (Module 14, Scenarios 4, 5, 6). */
export default async function NewAccountPage() {
  await requirePermissions(PERMISSIONS.ACCOUNTING_ACCOUNTS_MANAGE);

  const chart = await fetchAccounts();

  return (
    <div>
      <PageBreadcrumb pageTitle="New Account" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <AccountForm
          parentOptions={chart.status === "ok" ? chart.accounts : []}
        />
      </div>
    </div>
  );
}
