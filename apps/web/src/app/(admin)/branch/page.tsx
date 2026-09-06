import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { PERMISSIONS } from "@lms/constants";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Branch Dashboard",
};

/**
 * Branch Admin landing page (Sign-In story, Scenario 5).
 *
 * Placeholder content — the point here is the scope guarantee: the session is
 * validated server-side and the branch shown is the one bound at sign-in, never
 * a value supplied by the client (Scenarios 9 and 18).
 *
 * Gated on `dashboard.view` rather than a branch-specific code because none
 * exists: the `branches.*` family covers branch *administration* in Company
 * Settings, not this landing page. `dashboard.view` is what the API's dashboard
 * controller requires, and it carries the same "open the dashboard for the
 * assigned scope" meaning this page relies on.
 */
export default async function BranchDashboardPage() {
  const user = await requirePermissions(PERMISSIONS.DASHBOARD_VIEW);

  return (
    <div>
      <PageBreadcrumb pageTitle="Branch Dashboard" />
      <div className="min-h-screen rounded-2xl border border-gray-200 bg-white px-5 py-7 xl:px-10 xl:py-12 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mx-auto w-full max-w-[630px] text-center">
          <h3 className="text-theme-xl mb-4 font-semibold text-gray-800 sm:text-2xl dark:text-white/90">
            Welcome, {user.name}
          </h3>
          <p className="text-sm text-gray-500 sm:text-base dark:text-gray-400">
            Organization {user.orgCode}
            {user.branchName ? ` · Branch ${user.branchName}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
