import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requireSession } from "@/features/auth/api/session";
import { fetchNotification, NotificationDetail } from "@/features/notifications";

export const metadata: Metadata = { title: "Notification" };
export const dynamic = "force-dynamic";

/**
 * One notification.
 *
 * A notification belonging to another user comes back as `not-found` and
 * renders the 404 — deliberately indistinguishable from one that never existed.
 * A distinct "forbidden" screen would confirm the row exists, which is the
 * disclosure Scenario 1 forbids.
 *
 * Opening this page does not mark the notification read. Rule 51 and Scenario
 * 2: viewing changes nothing, and on a mandatory alert acknowledgement is
 * evidence — so it stays an explicit act.
 */
export default async function NotificationPage({
  params,
}: {
  params: Promise<{ notificationId: string }>;
}) {
  await requireSession();
  const { notificationId } = await params;

  const result = await fetchNotification(notificationId);

  if (result.status === "not-found") notFound();

  return (
    <div>
      <PageBreadcrumb pageTitle="Notification" />

      {result.status === "ok" ? (
        <NotificationDetail notification={result.notification} />
      ) : (
        <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          We could not load this notification. Please try again.
        </p>
      )}
    </div>
  );
}
