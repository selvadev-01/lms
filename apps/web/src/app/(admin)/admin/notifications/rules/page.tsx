import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { NOTIFICATION_CHANNEL_OPTIONS } from "@lms/validation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { fetchRules, RuleList } from "@/features/notifications";

export const metadata: Metadata = { title: "Event Rules" };
export const dynamic = "force-dynamic";

/**
 * Notification event rules (Scenarios 14-17).
 *
 * A rule decides who hears about an event, on which channel, using which
 * template — and whether a user may switch it off at all.
 *
 * A branch-confined administrator sees their own branch's rules and the
 * organization-wide ones that also govern their branch, and is refused every
 * write by the API (Scenario 41).
 */
export default async function NotificationRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; search?: string }>;
}) {
  await requirePermissions(PERMISSIONS.NOTIFICATIONS_RULES_VIEW);
  const params = await searchParams;

  const list = await fetchRules({
    channel: params.channel,
    search: params.search,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Event Rules" />

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
              placeholder="Rule name"
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </label>

          <label className="text-sm">
            <span className="text-theme-xs mb-1 block text-gray-500 dark:text-gray-400">
              Channel
            </span>
            <select
              name="channel"
              defaultValue={params.channel ?? ""}
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            >
              <option value="">All</option>
              {NOTIFICATION_CHANNEL_OPTIONS.map((option) => (
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
          <RuleList rules={list.rules} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load event rules. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
