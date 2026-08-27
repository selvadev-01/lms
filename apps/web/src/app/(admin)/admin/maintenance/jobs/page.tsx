import { PERMISSIONS } from "@lms/constants";
import type { Metadata } from "next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  MaintenanceJobTable,
  fetchMaintenanceJobs,
} from "@/features/maintenance";

export const metadata: Metadata = {
  title: "Maintenance Jobs",
};

export const dynamic = "force-dynamic";

/**
 * Maintenance runs (Scenarios 26-31, 45).
 *
 * Gated on `maintenance.jobs.view`, which a Branch Admin holds and the seeded
 * MAINT_OPERATOR holds too. The retry control appears for whoever holds
 * `maintenance.jobs.retry` — and a branch-confined operator holding it is still
 * refused another branch's job by the server, which is the scope half of
 * Scenario 45 and the reason that role exists.
 */
export default async function MaintenanceJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; jobType?: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.MAINTENANCE_JOBS_VIEW);
  const { status, jobType } = await searchParams;

  const jobs = await fetchMaintenanceJobs({ status, jobType });

  return (
    <div>
      <PageBreadcrumb pageTitle="Maintenance Jobs" />

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <MaintenanceJobTable
          jobs={jobs.status === "ok" ? jobs.jobs : []}
          loadError={jobs.status !== "ok"}
          canRetry={hasPermissions(user, PERMISSIONS.MAINTENANCE_JOBS_RETRY)}
        />
      </div>
    </div>
  );
}
