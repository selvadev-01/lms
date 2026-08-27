import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import {
  DELINQUENCY_BUCKET_OPTIONS,
  NPA_STATUS_OPTIONS,
} from "@lms/validation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { fetchOverdues, OverdueList } from "@/features/recovery";

export const metadata: Metadata = { title: "Overdue Accounts" };
export const dynamic = "force-dynamic";

/**
 * The overdue book (Module 13).
 *
 * Read-only. There is no "mark overdue" control anywhere on this surface,
 * because overdue status is derived from the authoritative schedule and the
 * Asia/Kolkata business date (Rule 4) and Rule 8 forbids a recovery user
 * asserting it by hand.
 *
 * Filters are applied by the API, never in the browser: the bucket and NPA
 * values are derived per row, and a client-side filter over a paginated
 * response would hide rows the server had already sent.
 */
export default async function OverduesPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    bucket?: string;
    npaStatus?: string;
    minDaysPastDue?: string;
  }>;
}) {
  await requirePermissions(PERMISSIONS.OVERDUE_VIEW);
  const params = await searchParams;

  const list = await fetchOverdues({
    search: params.search,
    bucket: params.bucket,
    npaStatus: params.npaStatus,
    minDaysPastDue: params.minDaysPastDue,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Overdue Accounts" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
          <label className="text-sm">
            <span className="mb-1 block text-theme-xs text-gray-500 dark:text-gray-400">
              Search
            </span>
            <input
              type="search"
              name="search"
              defaultValue={params.search ?? ""}
              placeholder="Loan number or customer"
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-theme-xs text-gray-500 dark:text-gray-400">
              Bucket
            </span>
            <select
              name="bucket"
              defaultValue={params.bucket ?? ""}
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            >
              <option value="">All</option>
              {DELINQUENCY_BUCKET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-theme-xs text-gray-500 dark:text-gray-400">
              NPA indication
            </span>
            <select
              name="npaStatus"
              defaultValue={params.npaStatus ?? ""}
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            >
              <option value="">All</option>
              {NPA_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {/*
            A plain native button. The shared `Button` renders without a `type`
            attribute, which HTML defaults to `submit` — fine here, but the
            native element makes the intent explicit on a filter bar.
          */}
          <button
            type="submit"
            className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600"
          >
            Apply
          </button>
        </form>

        {list.status === "ok" ? (
          <OverdueList overdues={list.overdues} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load overdue accounts. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
