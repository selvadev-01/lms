import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  CompanySettingsForm,
  fetchOrganization,
} from "@/features/organizations";

export const metadata: Metadata = {
  title: "Company Settings",
};

/**
 * Super Admin → Company Settings → Organization.
 *
 * `requirePermissions` is a UX guard, not the security boundary: the API
 * re-checks the permission on every request and resolves the organization from
 * the session, so this page cannot reach another tenant even if the guard were
 * bypassed. What it buys is that a user without the permission lands on their
 * dashboard rather than on a screen that renders and then fails.
 *
 * Dynamic: organization status gates new transactions across the system, so a
 * cached view could show an administrator an ACTIVE badge for an organization
 * that was deactivated moments ago.
 */
export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  const user = await requirePermissions(PERMISSIONS.ORGANIZATIONS_VIEW);

  const result = await fetchOrganization();

  return (
    <div>
      <PageBreadcrumb pageTitle="Company Settings" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        {result.status === "ok" ? (
          <CompanySettingsForm
            organization={result.organization}
            canEdit={hasPermissions(user, PERMISSIONS.ORGANIZATIONS_UPDATE)}
          />
        ) : (
          <p role="alert" className="text-error-500 text-sm">
            We could not load your organization. Please try again shortly.
          </p>
        )}
      </div>
    </div>
  );
}
