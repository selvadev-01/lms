import type {
  DeliveryStatus,
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  NotificationTemplateStatus,
} from "@lms/types";
import { Badge } from "@lms/ui";
import {
  DELIVERY_STATUS_OPTIONS,
  NOTIFICATION_CHANNEL_OPTIONS,
  NOTIFICATION_EVENT_OPTIONS,
  NOTIFICATION_STATUS_OPTIONS,
  labelFor,
} from "@lms/validation";

/**
 * Status badges for the notification surfaces.
 *
 * Server components — no `"use client"`.
 *
 * Every tone map is a total `Record<...>` rather than a partial one, so a new
 * enum value stops the compiler here instead of falling through to a default
 * colour nobody chose.
 */

const CHANNEL_TONE: Record<
  NotificationChannel,
  "success" | "warning" | "error" | "info" | "light"
> = {
  IN_APP: "info",
  EMAIL: "light",
  SMS: "light",
};

export function NotificationChannelBadge({
  channel,
}: {
  channel: NotificationChannel;
}) {
  return (
    <Badge color={CHANNEL_TONE[channel]}>
      {labelFor(NOTIFICATION_CHANNEL_OPTIONS, channel)}
    </Badge>
  );
}

const STATUS_TONE: Record<
  NotificationStatus,
  "success" | "warning" | "error" | "info" | "light"
> = {
  CREATED: "light",
  QUEUED: "info",
  PROCESSING: "info",
  SENT: "success",
  FAILED: "error",
  RETRYING: "warning",
  // Not a failure: the system decided not to send, and the reason is recorded.
  SUPPRESSED: "light",
  ARCHIVED: "light",
};

export function NotificationStatusBadge({
  status,
}: {
  status: NotificationStatus;
}) {
  return (
    <Badge color={STATUS_TONE[status]}>
      {labelFor(NOTIFICATION_STATUS_OPTIONS, status)}
    </Badge>
  );
}

/**
 * Delivery-attempt outcomes.
 *
 * `ACCEPTED_BY_PROVIDER` is deliberately *not* green. Rule 17 and Scenario 27:
 * a provider taking custody is not delivery, and colouring it as success would
 * tell an operator the message arrived when the system cannot know that. Only
 * `DELIVERED` — reachable in-app alone — earns the success tone.
 */
const DELIVERY_TONE: Record<
  DeliveryStatus,
  "success" | "warning" | "error" | "info" | "light"
> = {
  PENDING: "light",
  ACCEPTED_BY_PROVIDER: "info",
  DELIVERED: "success",
  FAILED: "error",
  RETRY_SCHEDULED: "warning",
  PERMANENT_FAILURE: "error",
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <Badge color={DELIVERY_TONE[status]}>
      {labelFor(DELIVERY_STATUS_OPTIONS, status)}
    </Badge>
  );
}

const PRIORITY_TONE: Record<
  NotificationPriority,
  "success" | "warning" | "error" | "info" | "light"
> = {
  LOW: "light",
  NORMAL: "light",
  HIGH: "warning",
  CRITICAL: "error",
};

/**
 * Rendered only for HIGH and CRITICAL.
 *
 * A badge on every row is a badge nobody reads; NORMAL is the overwhelming
 * majority and saying so adds noise rather than information.
 */
export function NotificationPriorityBadge({
  priority,
}: {
  priority: NotificationPriority;
}) {
  if (priority === "LOW" || priority === "NORMAL") return null;

  return (
    <Badge color={PRIORITY_TONE[priority]}>
      {priority === "CRITICAL" ? "Critical" : "High"}
    </Badge>
  );
}

const TEMPLATE_TONE: Record<
  NotificationTemplateStatus,
  "success" | "warning" | "error" | "info" | "light"
> = {
  DRAFT: "warning",
  ACTIVE: "success",
  INACTIVE: "light",
};

export function TemplateStatusBadge({
  status,
}: {
  status: NotificationTemplateStatus;
}) {
  return (
    <Badge color={TEMPLATE_TONE[status]}>
      {labelFor(
        [
          { value: "DRAFT", label: "Draft" },
          { value: "ACTIVE", label: "Active" },
          { value: "INACTIVE", label: "Inactive" },
        ],
        status,
      )}
    </Badge>
  );
}

/** A rule an organization has marked unsuppressible (Rules 47, 48). */
export function MandatoryBadge() {
  return <Badge color="info">Mandatory</Badge>;
}

/** The event a notification came from, as a human label. */
export function EventTypeLabel({ eventType }: { eventType: string }) {
  return <>{labelFor(NOTIFICATION_EVENT_OPTIONS, eventType)}</>;
}
