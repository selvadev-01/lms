import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { UserList, fetchEmployees } from "@/features/users";

export const metadata: Metadata = {
  title: "Employee Management",
};

export const dynamic = "force-dynamic";

/**
 * Employee Management — "Add, Assign, Deactivate" (Scenarios 14, 22).
 *
 * Reached by both the Super Admin and the Branch Admin, whose list is confined
 * to their own branch by the API rather than by anything on this page.
 *
 * Note the absence of an `activeOnly` filter: an administrator needs to see the
 * deactivated employees precisely in order to reactivate one. The filter exists
 * for the field-collection selector, which must not offer them.
 */
export default async function EmployeesPage() {
  const user = await requirePermissions(PERMISSIONS.EMPLOYEES_VIEW);
  const result = await fetchEmployees();

  return (
    <div>
      <PageBreadcrumb pageTitle="Employee Management" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <UserList
          users={result.status === "ok" ? result.users : []}
          surface="EMPLOYEE"
          loadError={result.status !== "ok"}
          canCreate={hasPermissions(user, PERMISSIONS.EMPLOYEES_CREATE)}
          canUpdate={hasPermissions(user, PERMISSIONS.EMPLOYEES_UPDATE)}
          canDelete={hasPermissions(user, PERMISSIONS.EMPLOYEES_DELETE)}
          canActivate={hasPermissions(user, PERMISSIONS.EMPLOYEES_ACTIVATE)}
        />
      </div>
    </div>
  );
}
