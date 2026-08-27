import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { UserList, fetchUsers } from "@/features/users";

export const metadata: Metadata = {
  title: "Admin Management",
};

export const dynamic = "force-dynamic";

/**
 * Admin Management — "Create & Manage Admins" from the Super Admin flow
 * (Scenarios 1, 4).
 *
 * Lists administrator accounts only. Employees live at `/employees` behind their
 * own permission family, because a Branch Admin may reach one and not the other.
 */
export default async function UsersPage() {
  const user = await requirePermissions(PERMISSIONS.USERS_VIEW);
  const result = await fetchUsers();

  return (
    <div>
      <PageBreadcrumb pageTitle="Admin Management" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <UserList
          users={result.status === "ok" ? result.users : []}
          surface="USER"
          loadError={result.status !== "ok"}
          canCreate={hasPermissions(user, PERMISSIONS.USERS_CREATE)}
          canUpdate={hasPermissions(user, PERMISSIONS.USERS_UPDATE)}
          canDelete={hasPermissions(user, PERMISSIONS.USERS_DELETE)}
          canActivate={hasPermissions(user, PERMISSIONS.USERS_ACTIVATE)}
        />
      </div>
    </div>
  );
}
