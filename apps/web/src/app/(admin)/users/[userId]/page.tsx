import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  UserForm,
  UserRoleAssignment,
  fetchRoles,
  fetchUser,
} from "@/features/users";

export const metadata: Metadata = {
  title: "User Details",
};

export const dynamic = "force-dynamic";

/**
 * Administrator details, edit and role assignment (Scenarios 5, 23, 34).
 *
 * A user outside the caller's branch scope, in another tenant, or reached
 * through the wrong surface all produce the same 404 — matching the API, which
 * refuses all four the same way so record ids cannot be enumerated.
 *
 * Roles are a separate form because they are behind a separate permission.
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const actor = await requirePermissions(PERMISSIONS.USERS_VIEW);
  const { userId } = await params;

  const canAssign = hasPermissions(actor, PERMISSIONS.USERS_ASSIGN_ROLE);

  const [result, roles] = await Promise.all([
    fetchUser(userId),
    fetchRoles({ activeOnly: true }),
  ]);

  if (result.status === "not-found") {
    notFound();
  }

  if (result.status !== "ok") {
    return (
      <div>
        <PageBreadcrumb pageTitle="User Details" />
        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <p role="alert" className="text-error-500 text-sm">
            We could not load this user. Please try again shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageBreadcrumb pageTitle={result.user.name} />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <UserForm
          user={result.user}
          surface="USER"
          branches={[]}
          roles={[]}
          canEdit={hasPermissions(actor, PERMISSIONS.USERS_UPDATE)}
        />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h2 className="mb-4 text-base font-medium text-gray-800 dark:text-white/90">
          Roles &amp; access
        </h2>
        <UserRoleAssignment
          user={result.user}
          roles={roles.status === "ok" ? roles.roles : []}
          canAssign={canAssign}
        />
      </div>
    </div>
  );
}
