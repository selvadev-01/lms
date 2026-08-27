import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { fetchBranches } from "@/features/organizations";
import { UserForm, fetchRoles } from "@/features/users";

export const metadata: Metadata = {
  title: "Add User",
};

export const dynamic = "force-dynamic";

/**
 * Create an administrator (Scenarios 2, 3, 4).
 *
 * Both selectors are filtered to what can actually be chosen: an inactive branch
 * cannot receive anyone (Scenario 16) and an inactive role grants nothing
 * (Scenario 35), so offering either would invite a submission the API refuses.
 */
export default async function NewUserPage() {
  await requirePermissions(PERMISSIONS.USERS_CREATE);

  const [branches, roles] = await Promise.all([
    fetchBranches({ activeOnly: true }),
    fetchRoles({ activeOnly: true }),
  ]);

  return (
    <div>
      <PageBreadcrumb pageTitle="Add User" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <UserForm
          surface="USER"
          branches={branches.status === "ok" ? branches.branches : []}
          roles={roles.status === "ok" ? roles.roles : []}
          canEdit
        />
      </div>
    </div>
  );
}
