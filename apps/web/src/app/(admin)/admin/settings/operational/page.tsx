import { PERMISSIONS } from "@lms/constants";
import type { Metadata } from "next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  MaintenanceModePanel,
  fetchMaintenanceMode,
} from "@/features/maintenance";

export const metadata: Metadata = {
  title: "Operational Controls",
};

export const dynamic = "force-dynamic";

/**
 * Maintenance mode (Scenarios 32-35).
 *
 * Gated on `maintenance.jobs.view` so a Branch Admin can SEE whether a window is
 * active — being refused a write during maintenance is much less confusing when
 * the reason is visible somewhere.
 */
export default async function OperationalControlsPage() {
  const user = await requirePermissions(PERMISSIONS.MAINTENANCE_JOBS_VIEW);
  const modes = await fetchMaintenanceMode();

  return (
    <div>
      <PageBreadcrumb pageTitle="Operational Controls" />

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <MaintenanceModePanel
          modes={modes.status === "ok" ? modes.modes : []}
          loadError={modes.status !== "ok"}
          canManage={hasPermissions(user, PERMISSIONS.MAINTENANCE_MODE_MANAGE)}
        />
      </div>
    </div>
  );
}
