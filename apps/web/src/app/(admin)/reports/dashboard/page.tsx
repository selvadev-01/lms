import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { DashboardKpis, fetchDashboard } from "@/features/reports";
import DateField from "@/components/form/DateField";

export const metadata: Metadata = {
  title: "Reporting Dashboard",
};

export const dynamic = "force-dynamic";

/**
 * The reporting dashboard (Scenarios 1-4).
 *
 * Every KPI is computed server-side from the owning module's own helpers, so
 * drilling into one reaches a report that reconciles to it (Scenario 3) rather
 * than a second query that happens to agree. The date range bounds the
 * collection figures only; the portfolio and delinquency groups are as-of-now
 * positions, which is why they are rendered as separate panels rather than one
 * grid (Rule 11).
 */
export default async function ReportingDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fromDate?: string; toDate?: string }>;
}) {
  await requirePermissions(PERMISSIONS.REPORTS_DASHBOARD_VIEW);
  const params = await searchParams;

  const result = await fetchDashboard({
    fromDate: params.fromDate,
    toDate: params.toDate,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Reporting Dashboard" />

      {result.status === "ok" ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
            <form className="flex flex-wrap items-end gap-4" method="get">
              <div>
                <label
                  htmlFor="dashboard-from"
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                >
                  From
                </label>
                <DateField
                  id="dashboard-from"
                  name="fromDate"

                  defaultValue={params.fromDate}
                  bare
                />
              </div>

              <div>
                <label
                  htmlFor="dashboard-to"
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                >
                  To
                </label>
                <DateField
                  id="dashboard-to"
                  name="toDate"

                  defaultValue={params.toDate}
                  bare
                />
              </div>

              <button
                type="submit"
                className="bg-brand-500 hover:bg-brand-600 h-11 rounded-lg px-5 text-sm font-medium text-white"
              >
                Apply
              </button>
            </form>
          </div>

          <DashboardKpis dashboard={result.report} />
        </div>
      ) : (
        <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          We could not load the dashboard. Please try again.
        </p>
      )}
    </div>
  );
}
