"use client";

import { useActionState } from "react";

import {
  archiveNotificationAction,
  markNotificationReadAction,
  markNotificationUnreadAction,
} from "../actions/notification-actions";

/**
 * Per-row read / unread / archive controls.
 *
 * Imports its actions **directly** rather than through the feature barrel: the
 * barrel re-exports `import "server-only"` read modules, and pulling that into
 * a client bundle fails the build.
 *
 * Three separate one-button forms rather than one form with three submitters.
 * `useActionState` binds one action per form, and a shared form would have to
 * branch on which button was pressed — which is how a "mark read" click ends up
 * archiving something after a later edit.
 *
 * There is deliberately no delete: Rules 69 to 71 retain notification history,
 * and archive is the user-visible removal.
 */
export default function NotificationRowActions({
  notificationId,
  readStatus,
  archived,
}: {
  notificationId: string;
  readStatus: boolean;
  archived: boolean;
}) {
  const [readState, readAction] = useActionState(
    markNotificationReadAction,
    {},
  );
  const [unreadState, unreadAction] = useActionState(
    markNotificationUnreadAction,
    {},
  );
  const [archiveState, archiveAction] = useActionState(
    archiveNotificationAction,
    {},
  );

  const failure =
    readState.message ?? unreadState.message ?? archiveState.message;

  return (
    <div className="flex items-center justify-end gap-2">
      {failure ? (
        <span className="text-theme-xs text-error-500" role="alert">
          {failure}
        </span>
      ) : null}

      {readStatus ? (
        <form action={unreadAction}>
          <input type="hidden" name="notificationId" value={notificationId} />
          <button
            type="submit"
            className="text-theme-xs rounded-lg border border-gray-300 px-3 py-1.5 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Mark unread
          </button>
        </form>
      ) : (
        <form action={readAction}>
          <input type="hidden" name="notificationId" value={notificationId} />
          <button
            type="submit"
            className="text-theme-xs rounded-lg border border-gray-300 px-3 py-1.5 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Mark read
          </button>
        </form>
      )}

      {archived ? null : (
        <form action={archiveAction}>
          <input type="hidden" name="notificationId" value={notificationId} />
          <button
            type="submit"
            className="text-theme-xs rounded-lg border border-gray-300 px-3 py-1.5 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Archive
          </button>
        </form>
      )}
    </div>
  );
}
