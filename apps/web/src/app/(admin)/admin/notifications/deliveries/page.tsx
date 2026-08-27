import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import {
  DELIVERY_STATUS_OPTIONS,
  NOTIFICATION_CHANNEL_OPTIONS,
} from "@lms/validation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { hasPermissions } from "@/features/auth/utils/require-permissions";
import { DeliveryList, fetchDeliveries } from "@/features/notifications";

export const metadata: Metadata = { title: "Delivery Monitoring" };
export const dynamic = "force-dynamic";

/**
 * Delivery monitoring (Scenarios 26-31, 40, 45).
 *
 * The one notification screen that spans recipients, which is why it needs a
 * permission the notification centre does not.
 *
 * Two permissions govern it, and the split is Rule 55:
 * `notifications.deliveries.view` opens the screen — statuses, attempt counts,
 * failure classifications — while `notifications.view` is what adds the message
 * bodies. An operator diagnosing why a branch's email is failing needs the
 * attempts; they do not necessarily need to read what was said to whom.
 *
 * `notifications.deliveries.retry` is separate again, so an account can see a
 * failed delivery and be refused the retry (Scenario 45).
 */
export default async function DeliveryMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; channel?: string }>;
}) {
  const user = await requirePermissions(
    PERMISSIONS.NOTIFICATIONS_DELIVERIES_VIEW,
  );
  const params = await searchParams;

  const list = await fetchDeliveries({
    status: params.status,
    channel: params.channel,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Delivery Monitoring" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
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
              {DELIVERY_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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
          <DeliveryList
            deliveries={list.deliveries}
            canRetry={hasPermissions(
              user,
              PERMISSIONS.NOTIFICATIONS_DELIVERIES_RETRY,
            )}
          />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load deliveries. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
