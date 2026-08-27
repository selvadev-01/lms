import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { BranchForm, fetchBranch } from "@/features/organizations";

export const metadata: Metadata = {
  title: "Branch Details",
};

export const dynamic = "force-dynamic";

/**
 * Branch details / edit (Scenarios 14, 16, 20, 35).
 *
 * A branch outside the caller's scope produces the same 404 as one that does
 * not exist. That is deliberate and matches the API: distinguishing them would
 * let a Branch Admin discover which branch ids are real by watching which ones
 * answer differently.
 */
export default async function BranchDetailPage({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.BRANCHES_VIEW);
  const { branchId } = await params;

  const result = await fetchBranch(branchId);

  if (result.status === "not-found") {
    notFound();
  }

  if (result.status !== "ok") {
    return (
      <div>
        <PageBreadcrumb pageTitle="Branch Details" />
        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <p role="alert" className="text-error-500 text-sm">
            We could not load this branch. Please try again shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageBreadcrumb pageTitle={result.branch.name} />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <BranchForm
          branch={result.branch}
          canEdit={hasPermissions(user, PERMISSIONS.BRANCHES_UPDATE)}
        />
      </div>
    </div>
  );
}
