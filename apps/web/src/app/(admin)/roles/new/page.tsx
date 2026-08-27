import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { RoleForm } from "@/features/users";

export const metadata: Metadata = {
  title: "Create Role",
};

export const dynamic = "force-dynamic";

/**
 * Create Role — the first step of Create Role → Assign Module Permissions →
 * Save & Activate (Scenarios 27, 28).
 *
 * Deliberately carries no permission editor. The role is created DRAFT and
 * empty; permissions are assigned on its detail page and activation follows
 * that, which is the source-defined sequence made literal in the navigation.
 */
export default async function NewRolePage() {
  await requirePermissions(PERMISSIONS.ROLES_CREATE);

  return (
    <div>
      <PageBreadcrumb pageTitle="Create Role" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <RoleForm canEdit />
      </div>
    </div>
  );
}
