import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { BranchForm } from "@/features/organizations";

export const metadata: Metadata = {
  title: "Add Branch",
};

/**
 * Branch Management → Add Branch (Scenario 17).
 *
 * Guarded on `branches.create`, so a Branch Admin who navigates here directly
 * is redirected rather than shown a form every submission would refuse
 * (Scenario 34). The API refuses it too — this only avoids the dead end.
 */
export const dynamic = "force-dynamic";

export default async function NewBranchPage() {
  await requirePermissions(PERMISSIONS.BRANCHES_CREATE);

  return (
    <div>
      <PageBreadcrumb pageTitle="Add Branch" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <BranchForm canEdit />
      </div>
    </div>
  );
}
