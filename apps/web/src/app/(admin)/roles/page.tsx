import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { RoleList, fetchRoles } from "@/features/users";

export const metadata: Metadata = {
  title: "Roles & Permissions",
};

export const dynamic = "force-dynamic";

/**
 * Role & Permission Management (Scenario 26).
 *
 * Unfiltered: an administrator has to see DRAFT and INACTIVE roles here in order
 * to activate one. The `activeOnly` filter belongs to the role pickers on the
 * user and employee forms, where an inactive role would be an invalid choice.
 */
export default async function RolesPage() {
  const user = await requirePermissions(PERMISSIONS.ROLES_VIEW);
  const result = await fetchRoles();

  return (
    <div>
      <PageBreadcrumb pageTitle="Roles & Permissions" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <RoleList
          roles={result.status === "ok" ? result.roles : []}
          loadError={result.status !== "ok"}
          canCreate={hasPermissions(user, PERMISSIONS.ROLES_CREATE)}
          canUpdate={hasPermissions(user, PERMISSIONS.ROLES_UPDATE)}
          canDelete={hasPermissions(user, PERMISSIONS.ROLES_DELETE)}
          canActivate={hasPermissions(user, PERMISSIONS.ROLES_ACTIVATE)}
        />
      </div>
    </div>
  );
}
