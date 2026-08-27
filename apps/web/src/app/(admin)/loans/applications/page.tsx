import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  hasPermissions,
  requirePermissions,
} from "@/features/auth/utils/require-permissions";
import { fetchLoanApplications, LoanApplicationList } from "@/features/loans";

export const metadata: Metadata = {
  title: "Loan Applications",
};

export const dynamic = "force-dynamic";

/**
 * Loan Application list (APP-001, Scenarios 1-4).
 *
 * The search and status filters come from the URL so a result set is linkable
 * and survives a refresh. Both are passed to the API rather than applied here:
 * the server decides which applications the caller may see, and filtering a list
 * the client already holds would mean the out-of-scope rows had already been
 * sent.
 */
export default async function LoanApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const user = await requirePermissions(PERMISSIONS.LOANS_APPLICATIONS_VIEW);
  const params = await searchParams;

  const result = await fetchLoanApplications({
    search: params.search,
    status: params.status,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Loan Applications" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <LoanApplicationList
          applications={result.status === "ok" ? result.applications : []}
          loadError={result.status !== "ok"}
          canCreate={hasPermissions(
            user,
            PERMISSIONS.LOANS_APPLICATIONS_CREATE,
          )}
          initialSearch={params.search ?? ""}
          initialStatus={params.status ?? ""}
        />
      </div>
    </div>
  );
}
