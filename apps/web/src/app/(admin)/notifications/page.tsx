import type { Metadata } from "next";
import { READ_STATUS_FILTER_OPTIONS } from "@lms/validation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requireSession } from "@/features/auth/api/session";
import { fetchNotifications, NotificationList } from "@/features/notifications";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

/**
 * The notification centre.
 *
 * # `requireSession`, not `requirePermissions`
 *
 * The only `(admin)` page in the application that guards on authentication
 * alone, and deliberately so. Rule 53 gives every user the notifications
 * addressed to them, and Rule 47 makes some of them mandatory operational
 * alerts. A permission gate here would mean an unpermissioned user silently
 * missing exactly those — the rule inverted by the check that appears to
 * enforce it.
 *
 * Scope is not enforced by a permission; it is enforced by the API, which
 * filters every read on the session's own user id and offers no parameter that
 * could widen it.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    readStatus?: string;
    includeArchived?: string;
  }>;
}) {
  await requireSession();
  const params = await searchParams;

  const list = await fetchNotifications({
    readStatus: params.readStatus,
    includeArchived: params.includeArchived === "true",
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Notifications" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
          <label className="text-sm">
            <span className="text-theme-xs mb-1 block text-gray-500 dark:text-gray-400">
              Show
            </span>
            <select
              name="readStatus"
              defaultValue={params.readStatus ?? "ALL"}
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            >
              {READ_STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex h-10 items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              name="includeArchived"
              value="true"
              defaultChecked={params.includeArchived === "true"}
              className="text-brand-500 h-4 w-4 rounded border-gray-300 dark:border-gray-700 dark:bg-gray-900"
            />
            Include archived
          </label>

          <button
            type="submit"
            className="bg-brand-500 hover:bg-brand-600 h-10 rounded-lg px-4 text-sm font-medium text-white"
          >
            Apply
          </button>
        </form>

        {list.status === "ok" ? (
          <>
            {list.unreadCount > 0 ? (
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                {list.unreadCount} unread of {list.total}.
              </p>
            ) : null}
            <NotificationList notifications={list.notifications} />
          </>
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load your notifications. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
