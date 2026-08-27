import type { NotificationDetail as NotificationDetailPayload } from "@lms/types";

import { formatDate } from "@/lib/format";
import NotificationRowActions from "./NotificationRowActions";
import {
  EventTypeLabel,
  NotificationPriorityBadge,
  NotificationStatusBadge,
} from "./NotificationBadges";

/**
 * One notification, as its recipient sees it.
 *
 * # The content shown is the content that was sent
 *
 * `title` and `message` come from the row, where they were frozen at creation.
 * Rendering them from the current template instead would show a message that
 * was never delivered — Rule 40 and Scenario 8 exist because that difference
 * matters when someone is asked what they were told and when.
 *
 * `templateVersion` is displayed for the same reason: it is the evidence of
 * which version produced this text.
 *
 * # Opening it changes nothing
 *
 * Rule 51 and Scenario 2: viewing a notification does not modify the source
 * business transaction, and it does not mark itself read either. Acknowledgement
 * is an explicit act, because on a mandatory operational alert it is evidence.
 */
export default function NotificationDetail({
  notification,
}: {
  notification: NotificationDetailPayload;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {notification.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-theme-xs text-gray-500 dark:text-gray-400">
                <EventTypeLabel eventType={notification.eventType} />
              </span>
              <NotificationPriorityBadge priority={notification.priority} />
              <NotificationStatusBadge status={notification.status} />
            </div>
          </div>

          <NotificationRowActions
            notificationId={notification.notificationId}
            readStatus={notification.readStatus}
            archived={Boolean(notification.archivedAt)}
          />
        </div>

        <p className="mt-5 text-sm whitespace-pre-line text-gray-700 dark:text-gray-300">
          {notification.message}
        </p>

        {notification.suppressionReason ? (
          <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-800/50 dark:text-gray-400">
            This notification was not delivered:{" "}
            {SUPPRESSION_REASONS[notification.suppressionReason] ??
              notification.suppressionReason}
          </p>
        ) : null}
      </div>

      <dl className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-5 sm:grid-cols-2 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <Detail label="Received" value={formatDate(notification.createdAt)} />
        <Detail
          label="Read"
          value={
            notification.readAt ? formatDate(notification.readAt) : "Unread"
          }
        />
        {notification.sourceModule ? (
          <Detail label="Source" value={notification.sourceModule} />
        ) : null}
        {notification.templateVersion ? (
          <Detail
            label="Template version"
            value={`v${notification.templateVersion}`}
            hint="Which version of the template produced this text."
          />
        ) : null}
        {notification.recipientRoleSnapshot ? (
          <Detail
            label="Your roles at the time"
            value={notification.recipientRoleSnapshot}
            hint="What recipient resolution saw when this was raised."
          />
        ) : null}
        {notification.archivedAt ? (
          <Detail
            label="Archived"
            value={formatDate(notification.archivedAt)}
          />
        ) : null}
      </dl>
    </div>
  );
}

/** Why a notification was created but never sent (Scenario 20). */
const SUPPRESSION_REASONS: Record<string, string> = {
  USER_PREFERENCE: "you have turned this kind of notification off.",
  INACTIVE_TEMPLATE: "the template it would have used is inactive.",
  INACTIVE_RECIPIENT: "the recipient account was inactive.",
  NO_ELIGIBLE_RECIPIENT: "no eligible recipient could be resolved.",
};

function Detail({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-theme-xs text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-gray-800 dark:text-white/90">
        {value}
      </dd>
      {hint ? (
        <p className="text-theme-xs mt-0.5 text-gray-400 dark:text-gray-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
