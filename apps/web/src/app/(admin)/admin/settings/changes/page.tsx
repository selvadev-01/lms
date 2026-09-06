import { PERMISSIONS } from "@lms/constants";
import type { Metadata } from "next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { ChangeRequestList, fetchChangeRequests } from "@/features/settings";

export const metadata: Metadata = {
  title: "Configuration Changes",
};

export const dynamic = "force-dynamic";

/**
 * The maker-checker queue (Scenarios 9-13).
 *
 * Gated on `settings.changes.view`, which a Branch Admin holds — they may
 * propose changes and must be able to watch them. `settings.changes.approve` is
 * withheld, so the approve control is absent for them and the server refuses it
 * regardless.
 *
 * `currentUserId` drives the "Withdraw" control: only the submitter may cancel,
 * because an approver wanting a request gone should reject it and record why.
 */
export default async function ConfigurationChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.SETTINGS_CHANGES_VIEW);
  const { status } = await searchParams;

  const changes = await fetchChangeRequests({ status });

  return (
    <div>
      <PageBreadcrumb pageTitle="Configuration Changes" />

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          A change cannot be approved by the person who submitted it. Until a
          second administrator approves, the previous configuration stays in
          force.
        </p>

        <ChangeRequestList
          changes={changes.status === "ok" ? changes.changes : []}
          loadError={changes.status !== "ok"}
          canApprove={hasPermissions(
            user,
            PERMISSIONS.SETTINGS_CHANGES_APPROVE,
          )}
          currentUserId={user.id}
        />
      </div>
    </div>
  );
}
