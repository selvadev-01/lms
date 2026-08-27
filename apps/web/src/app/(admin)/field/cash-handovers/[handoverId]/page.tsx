import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { CashHandoverDetail, fetchCashHandover } from "@/features/field";

export const metadata: Metadata = {
  title: "Cash Handover",
};

export const dynamic = "force-dynamic";

/**
 * One cash handover in full (Scenario 4).
 *
 * The three capabilities are three separate permissions, and the split is the
 * control: submit and receive are the two sides of one transfer, and reverse
 * undoes a committed posting. Resolving them here means the page renders only
 * the actions this caller may actually take — Scenarios 43 and 44 need an
 * account that reaches the screen and is refused the action.
 */
export default async function CashHandoverPage({
  params,
}: {
  params: Promise<{ handoverId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.CASH_HANDOVERS_VIEW);
  const { handoverId } = await params;

  const detail = await fetchCashHandover(handoverId);

  if (detail.status === "not-found") notFound();
  if (detail.status !== "ok") throw new Error("Could not load handover");

  return (
    <div>
      <PageBreadcrumb pageTitle="Cash Handover" />

      <CashHandoverDetail
        handover={detail.handover}
        capabilities={{
          canSubmit: hasPermissions(user, PERMISSIONS.CASH_HANDOVERS_SUBMIT),
          canReceive: hasPermissions(user, PERMISSIONS.CASH_HANDOVERS_RECEIVE),
          canReverse: hasPermissions(user, PERMISSIONS.CASH_HANDOVERS_REVERSE),
        }}
      />
    </div>
  );
}
