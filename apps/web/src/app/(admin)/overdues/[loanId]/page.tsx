import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { fetchOverdue, OverdueDetail } from "@/features/recovery";

export const metadata: Metadata = { title: "Overdue Account" };
export const dynamic = "force-dynamic";

/**
 * One loan's overdue position.
 *
 * Keyed by loan, not by an overdue-case id: the position is derived on read, so
 * there is no row with an identity of its own. The loan is the only thing here
 * that has one.
 *
 * `fetchOverdue` collapses a 403 into `not-found`, so a loan id cannot be
 * confirmed to exist by the shape of the refusal (Scenarios 45, 47).
 */
export default async function OverdueDetailPage({
  params,
}: {
  params: Promise<{ loanId: string }>;
}) {
  await requirePermissions(PERMISSIONS.OVERDUE_VIEW);
  const { loanId } = await params;

  const detail = await fetchOverdue(loanId);

  if (detail.status === "not-found") notFound();
  if (detail.status !== "ok") throw new Error("Could not load overdue account");

  return (
    <div>
      <PageBreadcrumb pageTitle="Overdue Account" />
      <OverdueDetail overdue={detail.overdue} />
    </div>
  );
}
