import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import { redirect } from "next/navigation";

import PageShell from "@/components/layout/PageShell";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import {
  DISBURSEMENTS_PAGE_SIZE,
  DisbursementQueue,
  fetchDisbursalQueue,
  fetchDisbursements,
} from "@/features/disbursements";

export const metadata: Metadata = {
  title: "Disbursement",
};

export const dynamic = "force-dynamic";

/**
 * The disbursal screen (Module 09, Scenarios 1, 3, 4).
 *
 * Two reads in parallel — the action queue and the disbursement record list.
 * They are independent endpoints and neither depends on the other's result, so
 * awaiting them in sequence would double the page's latency for nothing.
 *
 * Search and status come from the URL so a result set is linkable and survives
 * a refresh, and both are passed to the API rather than applied here: the
 * server decides which rows the caller may see, and filtering a list the client
 * already holds would mean the out-of-scope rows had already been sent.
 *
 * There is no branch control, here or in the API. That absence is what makes
 * Scenario 3 structural rather than a check somebody has to remember.
 */
export default async function DisbursementsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; page?: string }>;
}) {
  await requirePermissions(PERMISSIONS.LOANS_DISBURSEMENTS_VIEW);
  const params = await searchParams;

  // A junk `?page=abc` falls back to the first page rather than erroring: the
  // URL is a user-editable surface here, and refusing to render is a worse
  // answer than showing them page one.
  const page = Math.max(1, Number(params.page) || 1);

  const [queue, list] = await Promise.all([
    fetchDisbursalQueue(),
    fetchDisbursements({
      search: params.search,
      status: params.status,
      page,
    }),
  ]);

  // A 401 means the session died since the shell rendered. Collapsing it into
  // `listError` would tell a signed-out user their disbursements are
  // unavailable and leave them retrying.
  if (list.status === "unauthenticated" || queue.status === "unauthenticated") {
    redirect("/signin");
  }

  return (
    <PageShell
      title="Disbursement"
      description="Approved loans awaiting disbursal, and the disbursement record."
      breadcrumbs={[
        { label: "Home", href: "/" },
        { label: "Loans", href: "/loans/applications" },
        { label: "Disbursement" },
      ]}
    >
      <DisbursementQueue
        queue={queue.status === "ok" ? queue.loans : []}
        disbursements={list.status === "ok" ? list.disbursements : []}
        queueError={queue.status !== "ok"}
        listError={list.status !== "ok"}
        initialSearch={params.search ?? ""}
        initialStatus={params.status ?? ""}
        page={page}
        pageSize={DISBURSEMENTS_PAGE_SIZE}
        total={list.status === "ok" ? list.total : 0}
      />
    </PageShell>
  );
}
