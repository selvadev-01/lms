import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import {
  CashReconciliationDetail,
  fetchCashReconciliation,
} from "@/features/field";

export const metadata: Metadata = {
  title: "Cash Reconciliation",
};

export const dynamic = "force-dynamic";

/**
 * One reconciliation in full, and its resolution where one exists.
 *
 * `canResolve` is deliberately a different permission from the one that reached
 * this page: a Branch Admin counts the cash and sees the shortage, and is
 * refused the authority to forgive it. Scenario 30 needs exactly that account —
 * one that reaches the screen and cannot act.
 */
export default async function CashReconciliationDetailPage({
  params,
}: {
  params: Promise<{ reconciliationId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.CASH_RECONCILIATION_VIEW);
  const { reconciliationId } = await params;

  const detail = await fetchCashReconciliation(reconciliationId);

  if (detail.status === "not-found") notFound();
  if (detail.status !== "ok") throw new Error("Could not load reconciliation");

  return (
    <div>
      <PageBreadcrumb pageTitle="Cash Reconciliation" />

      <CashReconciliationDetail
        reconciliation={detail.reconciliation}
        capabilities={{
          canResolve: hasPermissions(
            user,
            PERMISSIONS.CASH_RECONCILIATION_RESOLVE,
          ),
        }}
      />
    </div>
  );
}
