import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { fetchRecoveryCase, RecoveryCaseDetail } from "@/features/recovery";

export const metadata: Metadata = { title: "Recovery Case" };
export const dynamic = "force-dynamic";

/**
 * One recovery case.
 *
 * Every action permission is resolved here, server-side, and passed to the
 * detail component as a plain boolean bag — the house `capabilities` pattern.
 * The route guard and the API are the real boundary; hiding a control the
 * caller cannot use is UX, and a viewer who reached a hidden action anyway
 * still receives a 403.
 *
 * The eight capabilities are deliberately separate rather than one
 * "canManage": the source denies them separately (Scenarios 42, 43, 44), and a
 * single flag would grant a Recovery Officer the approval authority's acts.
 */
export default async function RecoveryCaseDetailPage({
  params,
}: {
  params: Promise<{ recoveryCaseId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.RECOVERY_CASES_VIEW);
  const { recoveryCaseId } = await params;

  const detail = await fetchRecoveryCase(recoveryCaseId);

  if (detail.status === "not-found") notFound();
  if (detail.status !== "ok") throw new Error("Could not load recovery case");

  return (
    <div>
      <PageBreadcrumb pageTitle="Recovery Case" />
      <RecoveryCaseDetail
        recoveryCase={detail.recoveryCase}
        capabilities={{
          canAssign: hasPermissions(user, PERMISSIONS.RECOVERY_CASES_ASSIGN),
          canRecordAction: hasPermissions(
            user,
            PERMISSIONS.RECOVERY_ACTIONS_RECORD,
          ),
          canEscalate: hasPermissions(
            user,
            PERMISSIONS.RECOVERY_CASES_ESCALATE,
          ),
          canClose: hasPermissions(user, PERMISSIONS.RECOVERY_CASES_CLOSE),
          canProposeSettlement: hasPermissions(
            user,
            PERMISSIONS.RECOVERY_SETTLEMENTS_PROPOSE,
          ),
          canApproveSettlement: hasPermissions(
            user,
            PERMISSIONS.RECOVERY_SETTLEMENTS_APPROVE,
          ),
          canIssueNotice: hasPermissions(
            user,
            PERMISSIONS.RECOVERY_NOTICES_ISSUE,
          ),
          canWriteOff: hasPermissions(
            user,
            PERMISSIONS.RECOVERY_WRITEOFF_POST,
          ),
        }}
      />
    </div>
  );
}
