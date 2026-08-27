import type { NotificationSummary } from "@lms/types";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@lms/ui";
import Link from "next/link";

import { formatDate } from "@/lib/format";
import NotificationRowActions from "./NotificationRowActions";
import {
  EventTypeLabel,
  NotificationPriorityBadge,
} from "./NotificationBadges";

/**
 * The notification centre list.
 *
 * A server component. It receives an already-filtered array — the API filtered
 * it, scoped to the signed-in user, and the page passed the filters through.
 * Nothing here narrows anything, which is the point: a client-side filter would
 * be a control that looks like security and is not (Rule 5).
 *
 * Unread rows are marked by weight and a dot rather than a background colour.
 * A tinted row reads as a warning, and most unread notifications are routine.
 */
export default function NotificationList({
  notifications,
}: {
  notifications: NotificationSummary[];
}) {
  if (notifications.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No notifications match this view.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
          <TableRow>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              Notification
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              Event
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              Received
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-end font-medium text-gray-500 dark:text-gray-400"
            >
              Actions
            </TableCell>
          </TableRow>
        </TableHeader>

        <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
          {notifications.map((row) => (
            <TableRow key={row.notificationId}>
              <TableCell className="px-5 py-4 text-start">
                <div className="flex items-start gap-2">
                  {row.readStatus ? null : (
                    <span
                      className="bg-brand-500 mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      aria-hidden="true"
                    />
                  )}
                  <div>
                    <Link
                      href={`/notifications/${row.notificationId}`}
                      className={`text-sm hover:underline ${
                        row.readStatus
                          ? "text-gray-700 dark:text-gray-300"
                          : "font-semibold text-gray-800 dark:text-white/90"
                      }`}
                    >
                      {row.title}
                      {row.readStatus ? null : (
                        <span className="sr-only"> (unread)</span>
                      )}
                    </Link>
                    <p className="text-theme-xs mt-0.5 line-clamp-1 text-gray-400 dark:text-gray-500">
                      {row.message}
                    </p>
                  </div>
                </div>
              </TableCell>

              <TableCell className="px-5 py-4 text-start text-sm text-gray-700 dark:text-gray-300">
                <div className="flex items-center gap-2">
                  <EventTypeLabel eventType={row.eventType} />
                  <NotificationPriorityBadge priority={row.priority} />
                </div>
              </TableCell>

              <TableCell className="px-5 py-4 text-start text-sm text-gray-700 dark:text-gray-300">
                {formatDate(row.createdAt)}
                {row.archivedAt ? (
                  <p className="text-theme-xs mt-0.5 text-gray-400 dark:text-gray-500">
                    Archived
                  </p>
                ) : null}
              </TableCell>

              <TableCell className="px-5 py-4 text-end">
                <NotificationRowActions
                  notificationId={row.notificationId}
                  readStatus={row.readStatus}
                  archived={Boolean(row.archivedAt)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
