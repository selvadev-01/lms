import { PERMISSIONS } from "@lms/constants";
import type { Metadata } from "next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { fetchBranches } from "@/features/organizations";
import {
  BranchScopePicker,
  SettingsList,
  fetchSettingCatalog,
  fetchSettings,
} from "@/features/settings";

export const metadata: Metadata = {
  title: "Branch Settings",
};

export const dynamic = "force-dynamic";

/**
 * Branch-scoped settings (Scenarios 3, 4).
 *
 * # Which branch is read from differs by who is asking
 *
 * A Branch Admin is pinned to their own branch: `AuthUser.branchId` is the scope
 * their session was issued under, and offering them a picker would imply a
 * choice the API would refuse anyway. A Super Admin has no `branchId` at all,
 * so they must name one — without a selection there is no branch scope to read
 * and the screen says so rather than silently falling back to organization
 * scope, which would show a different set of values under a "Branch" heading.
 *
 * # An unselected Super Admin is not an error
 *
 * No branch chosen yet is the ordinary first state of this page, so it renders
 * the picker and a prompt. Treating it as a load failure would put an error
 * banner in front of someone who has done nothing wrong.
 */
export default async function BranchSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ branchId?: string; category?: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.SETTINGS_VIEW);
  const { branchId: requestedBranchId, category } = await searchParams;

  // A Branch Admin's own scope wins over anything in the query string: the API
  // would refuse a foreign branchId regardless, and honouring the parameter
  // here would suggest the scope is theirs to choose.
  const isScopedToOwnBranch = Boolean(user.branchId);
  const branchId = isScopedToOwnBranch ? user.branchId : requestedBranchId;

  const branches = isScopedToOwnBranch
    ? null
    : await fetchBranches({ activeOnly: true });

  const [settings, catalog] = await Promise.all([
    branchId
      ? fetchSettings({ branchId, category, includeInactive: true })
      : Promise.resolve(null),
    fetchSettingCatalog(),
  ]);

  return (
    <div>
      <PageBreadcrumb pageTitle="Branch Settings" />

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          A branch setting overrides the organization value for that branch
          alone. Where a branch has no value of its own, the organization
          setting is what applies.
        </p>

        {branches ? (
          <BranchScopePicker
            branches={branches.status === "ok" ? branches.branches : []}
            selectedBranchId={branchId}
            loadError={branches.status !== "ok"}
          />
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Showing settings for {user.branchName ?? "your branch"}.
          </p>
        )}

        {branchId ? (
          <SettingsList
            settings={
              settings && settings.status === "ok" ? settings.settings : []
            }
            catalog={catalog.status === "ok" ? catalog.catalog : []}
            loadError={!settings || settings.status !== "ok"}
            canManage={hasPermissions(user, PERMISSIONS.SETTINGS_MANAGE)}
            branchId={branchId}
          />
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Choose a branch to see the settings that apply to it.
          </p>
        )}
      </div>
    </div>
  );
}
