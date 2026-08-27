import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  PermissionEditor,
  RoleForm,
  fetchPermissionCatalog,
  fetchRole,
} from "@/features/users";

export const metadata: Metadata = {
  title: "Role Details",
};

export const dynamic = "force-dynamic";

/**
 * Role details, rename and permission assignment (Scenarios 29, 30, 38, 39).
 *
 * The permission editor is a separate form behind `roles.assign_permissions`,
 * distinct from the `roles.update` that governs the rename above it. Changing
 * what a role grants is an authorization change; renaming it is not, and the two
 * are not the same trust.
 *
 * The catalog is fetched even for a caller who cannot edit, because it is what
 * renders the role's current grants as a readable list.
 */
export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const actor = await requirePermissions(PERMISSIONS.ROLES_VIEW);
  const { roleId } = await params;

  const canEditPermissions =
    hasPermissions(actor, PERMISSIONS.ROLES_ASSIGN_PERMISSIONS) &&
    hasPermissions(actor, PERMISSIONS.PERMISSIONS_VIEW);

  const [result, catalog] = await Promise.all([
    fetchRole(roleId),
    fetchPermissionCatalog(),
  ]);

  if (result.status === "not-found") {
    notFound();
  }

  if (result.status !== "ok") {
    return (
      <div>
        <PageBreadcrumb pageTitle="Role Details" />
        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <p role="alert" className="text-error-500 text-sm">
            We could not load this role. Please try again shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageBreadcrumb pageTitle={result.role.name} />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <RoleForm
          role={result.role}
          canEdit={
            hasPermissions(actor, PERMISSIONS.ROLES_UPDATE) &&
            !result.role.isSystem
          }
        />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h2 className="mb-4 text-base font-medium text-gray-800 dark:text-white/90">
          Module permissions
        </h2>
        {catalog.status === "ok" ? (
          <PermissionEditor
            role={result.role}
            permissions={catalog.permissions}
            canEdit={canEditPermissions}
          />
        ) : (
          <p role="alert" className="text-error-500 text-sm">
            We could not load the permission catalog. Please try again shortly.
          </p>
        )}
      </div>
    </div>
  );
}
