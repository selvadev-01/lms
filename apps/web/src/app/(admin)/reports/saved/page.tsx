import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { SavedReportList, fetchSavedReports } from "@/features/reports";

export const metadata: Metadata = {
  title: "Saved Reports",
};

export const dynamic = "force-dynamic";

/**
 * Saved report definitions (Scenarios 38-44).
 *
 * The list shows what is visible to the caller — their own definitions plus
 * those shared in the organization — decided by a WHERE clause on the server
 * rather than by filtering after the fact (Scenario 39).
 *
 * Inactive definitions are listed alongside active ones. Scenario 41 keeps
 * their history while blocking new output, and a row that disappeared on
 * deactivation would leave the user unable to see what they had switched off.
 */
export default async function SavedReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; page?: string }>;
}) {
  await requirePermissions(PERMISSIONS.REPORTS_SAVED_VIEW);
  const params = await searchParams;

  const result = await fetchSavedReports({
    search: params.search,
    status: params.status,
    page: params.page ? Number(params.page) : undefined,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Saved Reports" />

      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <form className="flex flex-wrap items-end gap-4" method="get">
            <div className="min-w-[16rem] flex-1">
              <label
                htmlFor="saved-search"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Search
              </label>
              <input
                id="saved-search"
                name="search"
                type="search"
                defaultValue={params.search}
                placeholder="A saved report name"
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
              />
            </div>

            <div>
              <label
                htmlFor="saved-status"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Status
              </label>
              <select
                id="saved-status"
                name="status"
                defaultValue={params.status ?? ""}
                className="h-11 rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
              >
                <option value="">All</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>

            <button
              type="submit"
              className="bg-brand-500 hover:bg-brand-600 h-11 rounded-lg px-5 text-sm font-medium text-white"
            >
              Apply
            </button>
          </form>
        </div>

        {result.status === "ok" ? (
          <SavedReportList result={result.result} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load your saved reports. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
