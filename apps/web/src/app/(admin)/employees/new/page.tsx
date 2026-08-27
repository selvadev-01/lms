import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { fetchBranches } from "@/features/organizations";
import { UserForm, fetchRoles } from "@/features/users";

export const metadata: Metadata = {
  title: "Add Employee",
};

export const dynamic = "force-dynamic";

/**
 * Add an employee (Scenarios 15, 16).
 *
 * The branch list carries only ACTIVE branches, which is Scenario 16 handled
 * before the submit rather than after: an employee cannot be added to an
 * inactive branch, and the API refuses it independently.
 */
export default async function NewEmployeePage() {
  await requirePermissions(PERMISSIONS.EMPLOYEES_CREATE);

  const [branches, roles] = await Promise.all([
    fetchBranches({ activeOnly: true }),
    fetchRoles({ activeOnly: true }),
  ]);

  return (
    <div>
      <PageBreadcrumb pageTitle="Add Employee" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <UserForm
          surface="EMPLOYEE"
          branches={branches.status === "ok" ? branches.branches : []}
          roles={roles.status === "ok" ? roles.roles : []}
          canEdit
        />
      </div>
    </div>
  );
}
