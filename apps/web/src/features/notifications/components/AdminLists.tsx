import type {
  DeliveryMonitorRow,
  NotificationEventRuleSummary,
  NotificationTemplateSummary,
} from "@lms/types";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@lms/ui";
import { labelFor, NOTIFICATION_EVENT_OPTIONS } from "@lms/validation";

import { formatDate } from "@/lib/format";
import RetryDeliveryForm from "./RetryDeliveryForm";
import {
  DeliveryStatusBadge,
  MandatoryBadge,
  NotificationChannelBadge,
  NotificationStatusBadge,
  TemplateStatusBadge,
} from "./NotificationBadges";

/**
 * The three administrative lists.
 *
 * One file because they are one screen's worth of concern and share every class
 * convention; three components because they render different things.
 *
 * All server components. Each receives an already-filtered array — the API
 * applied the branch scope, and the page passed the filters through.
 */

const HEADER_CLASS =
  "text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400";
const CELL_CLASS =
  "px-5 py-4 text-start text-sm text-gray-700 dark:text-gray-300";
const EMPTY_CLASS =
  "rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400";

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function TemplateList({
  templates,
}: {
  templates: NotificationTemplateSummary[];
}) {
  if (templates.length === 0) {
    return <p className={EMPTY_CLASS}>No templates match this view.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
          <TableRow>
            <TableCell isHeader className={HEADER_CLASS}>
              Template
            </TableCell>
            <TableCell isHeader className={HEADER_CLASS}>
              Event
            </TableCell>
            <TableCell isHeader className={HEADER_CLASS}>
              Channel
            </TableCell>
            <TableCell isHeader className={HEADER_CLASS}>
              Status
            </TableCell>
            <TableCell isHeader className={HEADER_CLASS}>
              Version
            </TableCell>
          </TableRow>
        </TableHeader>

        <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
          {templates.map((row) => (
            <TableRow key={row.templateId}>
              <TableCell className="px-5 py-4 text-start">
                <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {row.name}
                </span>
                <p className="text-theme-xs mt-0.5 text-gray-400 dark:text-gray-500">
                  {row.code}
                  {row.isSystem ? " · system" : ""}
                  {row.containsPii ? " · contains personal detail" : ""}
                </p>
              </TableCell>
              <TableCell className={CELL_CLASS}>
                {labelFor(NOTIFICATION_EVENT_OPTIONS, row.eventType)}
              </TableCell>
              <TableCell className="px-5 py-4 text-start">
                <NotificationChannelBadge channel={row.channel} />
              </TableCell>
              <TableCell className="px-5 py-4 text-start">
                <TemplateStatusBadge status={row.status} />
              </TableCell>
              <TableCell className={CELL_CLASS}>v{row.version}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event rules
// ---------------------------------------------------------------------------

export function RuleList({
  rules,
}: {
  rules: NotificationEventRuleSummary[];
}) {
  if (rules.length === 0) {
    return <p className={EMPTY_CLASS}>No event rules match this view.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
          <TableRow>
            <TableCell isHeader className={HEADER_CLASS}>
              Rule
            </TableCell>
            <TableCell isHeader className={HEADER_CLASS}>
              Event
            </TableCell>
            <TableCell isHeader className={HEADER_CLASS}>
              Recipients
            </TableCell>
            <TableCell isHeader className={HEADER_CLASS}>
              Channel
            </TableCell>
            <TableCell isHeader className={HEADER_CLASS}>
              Scope
            </TableCell>
          </TableRow>
        </TableHeader>

        <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
          {rules.map((row) => (
            <TableRow key={row.ruleId}>
              <TableCell className="px-5 py-4 text-start">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm ${
                      row.isActive
                        ? "font-medium text-gray-800 dark:text-white/90"
                        : "text-gray-400 line-through dark:text-gray-500"
                    }`}
                  >
                    {row.name}
                  </span>
                  {row.isMandatory ? <MandatoryBadge /> : null}
                </div>
                <p className="text-theme-xs mt-0.5 text-gray-400 dark:text-gray-500">
                  {row.templateName ?? "—"}
                </p>
              </TableCell>
              <TableCell className={CELL_CLASS}>
                {labelFor(NOTIFICATION_EVENT_OPTIONS, row.eventType)}
              </TableCell>
              <TableCell className={CELL_CLASS}>
                {RECIPIENT_LABELS[row.recipientStrategy] ??
                  row.recipientStrategy}
              </TableCell>
              <TableCell className="px-5 py-4 text-start">
                <NotificationChannelBadge channel={row.channel} />
              </TableCell>
              <TableCell className={CELL_CLASS}>
                {/* Null is organization-wide authority, not missing data. */}
                {row.branchName ?? "All branches"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const RECIPIENT_LABELS: Record<string, string> = {
  ROLE: "Everyone holding a role",
  ASSIGNED_USER: "The assigned user",
  RECORD_OWNER: "The record owner",
  BRANCH_USER_GROUP: "Branch users with a permission",
  EXPLICIT: "A named list",
};

// ---------------------------------------------------------------------------
// Delivery monitoring
// ---------------------------------------------------------------------------

export function DeliveryList({
  deliveries,
  canRetry,
}: {
  deliveries: DeliveryMonitorRow[];
  /** Scenario 45: an account can see this screen and be refused the retry. */
  canRetry: boolean;
}) {
  if (deliveries.length === 0) {
    return <p className={EMPTY_CLASS}>No deliveries match this view.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
          <TableRow>
            <TableCell isHeader className={HEADER_CLASS}>
              Notification
            </TableCell>
            <TableCell isHeader className={HEADER_CLASS}>
              Recipient
            </TableCell>
            <TableCell isHeader className={HEADER_CLASS}>
              Last attempt
            </TableCell>
            <TableCell isHeader className={HEADER_CLASS}>
              Attempts
            </TableCell>
            <TableCell isHeader className="text-theme-xs px-5 py-3 text-end font-medium text-gray-500 dark:text-gray-400">
              Actions
            </TableCell>
          </TableRow>
        </TableHeader>

        <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
          {deliveries.map((row) => (
            <TableRow key={row.notificationId}>
              <TableCell className="px-5 py-4 text-start">
                {/*
                  `title` is present only for a caller holding
                  `notifications.view` — Rule 55 minimises other users' content
                  by permission. Without it the row still shows its status,
                  which is what an operator diagnosing a failure needs.
                */}
                <span className="text-sm text-gray-800 dark:text-white/90">
                  {row.title ?? (
                    <span className="text-gray-400 italic dark:text-gray-500">
                      Content hidden
                    </span>
                  )}
                </span>
                <p className="text-theme-xs mt-0.5 text-gray-400 dark:text-gray-500">
                  {labelFor(NOTIFICATION_EVENT_OPTIONS, row.eventType)}
                  {row.branchName ? ` · ${row.branchName}` : ""}
                </p>
              </TableCell>

              <TableCell className={CELL_CLASS}>
                {row.recipientName ?? "—"}
              </TableCell>

              <TableCell className="px-5 py-4 text-start">
                {row.lastAttempt ? (
                  <>
                    <DeliveryStatusBadge status={row.lastAttempt.status} />
                    {row.lastAttempt.failureReason ? (
                      <p className="text-theme-xs mt-0.5 line-clamp-1 text-gray-400 dark:text-gray-500">
                        {row.lastAttempt.failureCode}:{" "}
                        {row.lastAttempt.failureReason}
                      </p>
                    ) : null}
                    {row.lastAttempt.nextRetryAt ? (
                      <p className="text-theme-xs mt-0.5 text-gray-400 dark:text-gray-500">
                        Next try {formatDate(row.lastAttempt.nextRetryAt)}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <NotificationStatusBadge status={row.status} />
                )}
              </TableCell>

              <TableCell className={CELL_CLASS}>{row.attemptCount}</TableCell>

              <TableCell className="px-5 py-4 text-end">
                {canRetry &&
                (row.status === "FAILED" || row.status === "RETRYING") ? (
                  <RetryDeliveryForm notificationId={row.notificationId} />
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
