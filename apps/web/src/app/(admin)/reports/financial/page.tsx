import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import {
  requirePermissions,
  hasPermissions,
} from "@/features/auth/utils/require-permissions";
import {
  ReportFilters,
  FinancialReportTable,
  fetchFinancialReport,
} from "@/features/reports";

export const metadata: Metadata = {
  title: "Financial Report",
};

export const dynamic = "force-dynamic";

/**
 * Financial Report.
 *
 * A server component reading its filters from `searchParams`. That is what
 * keeps the whole round-trip on the server: there is no client-side fetch whose
 * response could arrive out of order, so Scenario 58 — a stale response must
 * not overwrite a newer visible result — holds without any guarding code.
 *
 * The permission gate here mirrors the API's, and is UX rather than the
 * boundary: the API re-checks on every request, including the export.
 */
export default async function FinancialPage({
  searchParams,
}: {
  searchParams: Promise<{
    fromDate?: string;
    toDate?: string;
    search?: string;
    page?: string;
  }>;
}) {
  const user = await requirePermissions(PERMISSIONS.REPORTS_FINANCIAL_VIEW);
  const params = await searchParams;
  const canExport = hasPermissions(user, PERMISSIONS.REPORTS_EXPORT);

  const result = await fetchFinancialReport({
    fromDate: params.fromDate,
    toDate: params.toDate,
    search: params.search,
    page: params.page ? Number(params.page) : undefined,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Financial Report" />

      {result.status === "ok" ? (
        <div className="space-y-6">
          <ReportFilters
            meta={result.report.meta}
            fromDate={params.fromDate}
            toDate={params.toDate}
            search={params.search}
            searchLabel="Account code or name"
            searchPlaceholder="1100 or Cash in Hand"
            exportPath="reports/financial/export"
            canExport={canExport}
          />

          <FinancialReportTable report={result.report} />
        </div>
      ) : (
        <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          We could not load this report. Please try again.
        </p>
      )}
    </div>
  );
}
