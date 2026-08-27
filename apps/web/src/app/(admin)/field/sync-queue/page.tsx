import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { SyncQueueList, fetchSyncQueue } from "@/features/field";

export const metadata: Metadata = {
  title: "Sync Queue",
};

export const dynamic = "force-dynamic";

/**
 * What devices report they are holding (Scenario 13, and the retry of 16).
 *
 * # Why this screen exists rather than a device-side queue
 *
 * This is a server-rendered admin application: every route resolves permissions
 * against the API, so a page cannot render at all without a network. A
 * browser-local queue here would be one that could never be flushed from a page
 * that could never load.
 *
 * So the honest surface is this one — the server knows what a device says it
 * has, and an operator can drive a retry. A real device queue needs a PWA shell
 * and belongs with the mobile client; that is deferred, not forgotten.
 */
export default async function SyncQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requirePermissions(PERMISSIONS.FIELD_COLLECTIONS_VIEW);
  const params = await searchParams;

  const list = await fetchSyncQueue({ status: params.status });

  return (
    <div>
      <PageBreadcrumb pageTitle="Sync Queue" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        {list.status === "ok" ? (
          <SyncQueueList items={list.items} />
        ) : (
          <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            We could not load the sync queue. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
