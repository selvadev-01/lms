import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { BranchList, fetchBranches } from "@/features/organizations";

export const metadata: Metadata = {
  title: "Branch Management",
};

/**
 * Super Admin → Branch Management, and the Branch Admin's read-only view of it.
 *
 * Both roles reach this page; what differs is what comes back. The API confines
 * a caller carrying a branchId to that one branch, so a Branch Admin's list is
 * one row long — enforced server-side, not by a filter here (Scenarios 15, 38).
 *
 * The permission flags passed down decide which controls render. They are a
 * courtesy: the API refuses the action regardless.
 */
export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  const user = await requirePermissions(PERMISSIONS.BRANCHES_VIEW);

  // Deliberately not `activeOnly`: an administrator must see inactive branches
  // in order to reactivate one. The filter exists for operational selectors.
  const result = await fetchBranches();

  return (
    <div>
      <PageBreadcrumb pageTitle="Branch Management" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <BranchList
          branches={result.status === "ok" ? result.branches : []}
          loadError={result.status !== "ok"}
          canCreate={hasPermissions(user, PERMISSIONS.BRANCHES_CREATE)}
          canUpdate={hasPermissions(user, PERMISSIONS.BRANCHES_UPDATE)}
          canDelete={hasPermissions(user, PERMISSIONS.BRANCHES_DELETE)}
          canActivate={hasPermissions(user, PERMISSIONS.BRANCHES_ACTIVATE)}
        />
      </div>
    </div>
  );
}
