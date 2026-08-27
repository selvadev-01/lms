import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { fetchBranches } from "@/features/organizations";
import {
  EmployeeAssignmentForm,
  UserForm,
  fetchEmployee,
} from "@/features/users";

export const metadata: Metadata = {
  title: "Employee Details",
};

export const dynamic = "force-dynamic";

/**
 * Employee details, edit and branch assignment (Scenarios 17, 21, 22, 23).
 *
 * An employee outside the caller's branch produces the same 404 as one that does
 * not exist, and so does an administrator's record reached through this route —
 * the surfaces do not leak into each other.
 *
 * Assignment is a separate form because it is behind `employees.assign`, which a
 * Branch Admin does not hold by default (Q-RBAC-21).
 */
export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const actor = await requirePermissions(PERMISSIONS.EMPLOYEES_VIEW);
  const { userId } = await params;

  const [result, branches] = await Promise.all([
    fetchEmployee(userId),
    fetchBranches({ activeOnly: true }),
  ]);

  if (result.status === "not-found") {
    notFound();
  }

  if (result.status !== "ok") {
    return (
      <div>
        <PageBreadcrumb pageTitle="Employee Details" />
        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <p role="alert" className="text-error-500 text-sm">
            We could not load this employee. Please try again shortly.
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
          surface="EMPLOYEE"
          branches={[]}
          roles={[]}
          canEdit={hasPermissions(actor, PERMISSIONS.EMPLOYEES_UPDATE)}
        />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h2 className="mb-4 text-base font-medium text-gray-800 dark:text-white/90">
          Branch assignment
        </h2>
        <EmployeeAssignmentForm
          user={result.user}
          branches={branches.status === "ok" ? branches.branches : []}
          canAssign={hasPermissions(actor, PERMISSIONS.EMPLOYEES_ASSIGN)}
        />
      </div>
    </div>
  );
}
