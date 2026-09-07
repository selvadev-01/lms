import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { fetchCollectionReadiness, fetchLoanCollections } from "@/features/collections";
import { fetchLoan, fetchLoanSchedule, LoanDetail } from "@/features/loans";
import { fetchOverdue } from "@/features/recovery";

export const metadata: Metadata = {
  title: "Loan",
};

export const dynamic = "force-dynamic";

/**
 * One loan, in full.
 *
 * # Why this route did not exist
 *
 * Every loan surface in the API hangs off a `loanId`, and nothing in the web app
 * ever linked to a loan — collections, overdue and the customer portfolio all
 * showed loan numbers with nowhere to send them. `/loans/{id}` was a 404.
 *
 * # The loan is read through the list
 *
 * There is no `GET /loans/:loanId`; `LoanService` exposes `findInScope` for
 * other modules and a list for the portfolio. Rather than add a near-duplicate
 * endpoint, the list is filtered to this loan — it is already scoped, already
 * mapped, and returns the same row a detail route would.
 *
 * # Each panel is separately permissioned
 *
 * Schedules, collections and overdue each carry their own grant, and the reads
 * are deliberately skipped rather than fetched-and-discarded when the caller
 * lacks one: a refusal here would be an audited read of data nobody was shown.
 * The panels simply do not render, which is the honest presentation.
 */
export default async function LoanPage({
  params,
}: {
  params: Promise<{ loanId: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.LOANS_VIEW);
  const { loanId } = await params;

  const canSeeSchedule = hasPermissions(user, PERMISSIONS.LOANS_SCHEDULES_VIEW);
  const canSeeCollections = hasPermissions(user, PERMISSIONS.COLLECTIONS_VIEW);
  const canSeeOverdue = hasPermissions(user, PERMISSIONS.OVERDUE_VIEW);

  const [loan, readiness, schedule, collections, overdue] = await Promise.all([
    fetchLoan(loanId),
    canSeeCollections
      ? fetchCollectionReadiness(loanId)
      : Promise.resolve({ status: "not-found" as const }),
    canSeeSchedule ? fetchLoanSchedule(loanId) : Promise.resolve(null),
    canSeeCollections
      ? fetchLoanCollections(loanId)
      : Promise.resolve({ status: "not-found" as const }),
    canSeeOverdue
      ? fetchOverdue(loanId)
      : Promise.resolve({ status: "not-found" as const }),
  ]);

  // Out of scope, another tenant, or absent — deliberately the same answer, so
  // a loan id cannot be confirmed by the shape of the refusal.
  if (!loan) notFound();

  return (
    <div>
      <PageBreadcrumb pageTitle={`Loan ${loan.loanNumber}`} />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <LoanDetail
          loan={loan}
          readiness={readiness.status === "ok" ? readiness.readiness : null}
          schedule={schedule}
          collections={
            collections.status === "ok" ? collections.collections : null
          }
          overdue={overdue.status === "ok" ? overdue.overdue : null}
        />
      </div>
    </div>
  );
}
