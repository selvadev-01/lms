import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import {
  RECOVERY_CASE_STATUS_OPTIONS,
  RECOVERY_PRIORITY_OPTIONS,
} from "@lms/validation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { fetchRecoveryCases, RecoveryCaseList } from "@/features/recovery";

export const metadata: Metadata = { title: "Recovery Cases" };
export const dynamic = "force-dynamic";

/**
 * The recovery worklist (Module 13).
 *
 * What this shows is already narrowed by the API: a Recovery Officer without
 * assignment authority receives only the cases assigned to them, whatever this
 * page asks for. There is deliberately no "mine only" toggle — a client-side
 * control would suggest the reach were a display preference rather than a
 * server-enforced boundary (Scenario 4).
 */
export default async function RecoveryCasesPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    priority?: string;
  }>;
}) {
  await requirePermissions(PERMISSIONS.RECOVERY_CASES_VIEW);
  const params = await searchParams;

  const list = await fetchRecoveryCases({
    search: params.search,
    status: params.status,
    priority: params.priority,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Recovery Cases" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
          <label className="text-sm">
            <span className="text-theme-xs mb-1 block text-gray-500 dark:text-gray-400">
              Search
            </span>
            <input
              type="search"
              name="search"
              defaultValue={params.search ?? ""}
              placeholder="Case or loan number"
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </label>

          <label className="text-sm">
            <span className="text-theme-xs mb-1 block text-gray-500 dark:text-gray-400">
              Status
            </span>
            <select
              name="status"
              defaultValue={params.status ?? ""}
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            >
              <option value="">All</option>
              {RECOVERY_CASE_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="text-theme-xs mb-1 block text-gray-500 dark:text-gray-400">
              Priority
            </span>
            <select
              name="priority"
              defaultValue={params.priority ?? ""}
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            >
              <option value="">All</option>
              {RECOVERY_PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="bg-brand-500 hover:bg-brand-600 h-10 rounded-lg px-4 text-sm font-medium text-white"
          >
            Apply
          </button>
        </form>

        {list.status === "ok" ? (
          <RecoveryCaseList cases={list.cases} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load recovery cases. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
