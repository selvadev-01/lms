import { PERMISSIONS } from "@lms/constants";
import type { Metadata } from "next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  RetentionPolicyList,
  fetchRetentionPolicies,
} from "@/features/settings";

export const metadata: Metadata = {
  title: "Data Retention",
};

export const dynamic = "force-dynamic";

/**
 * Data retention policies (Scenarios 55-58).
 *
 * Gated on `retention.policies.view`, never on the manage code. A reader who
 * can see what governs their data but cannot change it is a real role, and the
 * split exists for exactly that.
 *
 * `includeInactive` is always true here: a retired policy is half of the
 * deactivate-then-replace history Scenario 56 requires, and hiding it would
 * make the remaining ACTIVE policy look like the only one there has ever been.
 */
export default async function RetentionPoliciesPage() {
  const user = await requirePermissions(PERMISSIONS.RETENTION_POLICIES_VIEW);

  const policies = await fetchRetentionPolicies({ includeInactive: true });

  return (
    <div>
      <PageBreadcrumb pageTitle="Data Retention" />

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          A policy governs how long one category of record is kept, when it is
          archived and — where permitted — when it is purged. Financial, ledger
          and audit evidence is protected and can never be purged.
        </p>

        <RetentionPolicyList
          policies={policies.status === "ok" ? policies.policies : []}
          loadError={policies.status !== "ok"}
          canManage={hasPermissions(
            user,
            PERMISSIONS.RETENTION_POLICIES_MANAGE,
          )}
        />
      </div>
    </div>
  );
}
