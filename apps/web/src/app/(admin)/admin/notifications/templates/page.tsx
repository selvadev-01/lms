import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import {
  NOTIFICATION_CHANNEL_OPTIONS,
  NOTIFICATION_TEMPLATE_STATUS_OPTIONS,
} from "@lms/validation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { fetchTemplates, TemplateList } from "@/features/notifications";

export const metadata: Metadata = { title: "Notification Templates" };
export const dynamic = "force-dynamic";

/**
 * Notification templates (Scenarios 6-12).
 *
 * Gated on the *view* permission. A Branch Admin holds it and is refused every
 * mutation by the API, which is what makes Scenario 43 provable through the UI:
 * an account that reaches the screen and cannot act on it.
 */
export default async function NotificationTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; channel?: string; search?: string }>;
}) {
  await requirePermissions(PERMISSIONS.NOTIFICATIONS_TEMPLATES_VIEW);
  const params = await searchParams;

  const list = await fetchTemplates({
    status: params.status,
    channel: params.channel,
    search: params.search,
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Notification Templates" />

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
              placeholder="Name or code"
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
              {NOTIFICATION_TEMPLATE_STATUS_OPTIONS.map((option) => (
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
          <TemplateList templates={list.templates} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load templates. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
