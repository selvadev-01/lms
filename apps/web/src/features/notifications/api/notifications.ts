import "server-only";

import type {
  DeliveryAttempt,
  DeliveryMonitorResult as DeliveryMonitorPayload,
  DeliveryMonitorRow,
  NotificationDetail,
  NotificationEventRuleDetail,
  NotificationEventRuleListResult as RuleListPayload,
  NotificationEventRuleSummary,
  NotificationListResult as NotificationListPayload,
  NotificationPreferences,
  NotificationSummary,
  NotificationTemplateDetail,
  NotificationTemplateListResult as TemplateListPayload,
  NotificationTemplateSummary,
} from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Notifications data layer (Module 16).
 *
 * # The notification centre is never filtered here
 *
 * `fetchNotifications` sends the user's filters and returns what the API gave
 * back. It does not narrow the result to the current user, because the API
 * already did: every query there is bounded by `recipientUserId` taken from the
 * session, and there is no parameter that could widen it.
 *
 * That distinction matters. A client-side filter would be a control that looks
 * like security and is not — anyone can call the API directly. Rule 5 says
 * exactly this, and the reason these functions look thin is that the boundary
 * they cross has already done the work.
 *
 * # Reads only
 *
 * Marking read, archiving and saving preferences are mutations and live in
 * `../actions/notification-actions`. This module is imported by server
 * components; that one is `"use server"`.
 */

export type NotificationListResult =
  | {
      status: "ok";
      notifications: NotificationSummary[];
      total: number;
      /** The badge count, so the bell needs one request rather than two. */
      unreadCount: number;
    }
  | FetchFailure;

export type NotificationDetailResult =
  | { status: "ok"; notification: NotificationDetail }
  /** Another user's, archived away, or absent — deliberately indistinguishable. */
  | { status: "not-found" }
  | FetchFailure;

export type UnreadCountResult =
  | { status: "ok"; unreadCount: number }
  | FetchFailure;

export type PreferencesResult =
  | { status: "ok"; preferences: NotificationPreferences }
  | FetchFailure;

export type TemplateListResult =
  | { status: "ok"; templates: NotificationTemplateSummary[]; total: number }
  | FetchFailure;

export type TemplateDetailResult =
  | { status: "ok"; template: NotificationTemplateDetail }
  | { status: "not-found" }
  | FetchFailure;

export type RuleListResult =
  | { status: "ok"; rules: NotificationEventRuleSummary[]; total: number }
  | FetchFailure;

export type RuleDetailResult =
  | { status: "ok"; rule: NotificationEventRuleDetail }
  | { status: "not-found" }
  | FetchFailure;

export type DeliveryListResult =
  | { status: "ok"; deliveries: DeliveryMonitorRow[]; total: number }
  | FetchFailure;

export type DeliveryAttemptsResult =
  | { status: "ok"; attempts: DeliveryAttempt[] }
  | { status: "not-found" }
  | FetchFailure;

// ---------------------------------------------------------------------------
// Notification centre
// ---------------------------------------------------------------------------

export async function fetchNotifications(params?: {
  readStatus?: string;
  eventType?: string;
  sourceModule?: string;
  includeArchived?: boolean;
  page?: number;
}): Promise<NotificationListResult> {
  const query = new URLSearchParams();
  if (params?.readStatus && params.readStatus !== "ALL") {
    query.set("readStatus", params.readStatus);
  }
  if (params?.eventType) query.set("eventType", params.eventType);
  if (params?.sourceModule) query.set("sourceModule", params.sourceModule);
  if (params?.includeArchived) query.set("includeArchived", "true");
  if (params?.page && params.page > 1) query.set("page", String(params.page));

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const result = await apiGet<NotificationListPayload>(
    `/notifications${suffix}`,
  );

  if (result.status !== "ok") return result;
  return {
    status: "ok",
    notifications: result.data.items,
    total: result.data.total,
    unreadCount: result.data.unreadCount,
  };
}

export async function fetchNotification(
  notificationId: string,
): Promise<NotificationDetailResult> {
  const result = await apiGetRecord<NotificationDetail>(
    `/notifications/${notificationId}`,
  );

  if (result.status !== "ok") return result;
  return { status: "ok", notification: result.data };
}

/** What the header bell polls. Cheaper than the list. */
export async function fetchUnreadCount(): Promise<UnreadCountResult> {
  const result = await apiGet<{ unreadCount: number }>(
    "/notifications/unread-count",
  );

  if (result.status !== "ok") return result;
  return { status: "ok", unreadCount: result.data.unreadCount };
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * The caller's own preferences.
 *
 * There is no `userId` parameter, and there is no route that would accept one:
 * Scenario 19 holds because the capability does not exist, not because this
 * function declines to use it.
 */
export async function fetchPreferences(): Promise<PreferencesResult> {
  const result = await apiGet<NotificationPreferences>(
    "/notifications/preferences",
  );

  if (result.status !== "ok") return result;
  return { status: "ok", preferences: result.data };
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function fetchTemplates(params?: {
  status?: string;
  channel?: string;
  search?: string;
}): Promise<TemplateListResult> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.channel) query.set("channel", params.channel);
  if (params?.search) query.set("search", params.search);

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const result = await apiGet<TemplateListPayload>(
    `/admin/notifications/templates${suffix}`,
  );

  if (result.status !== "ok") return result;
  return {
    status: "ok",
    templates: result.data.items,
    total: result.data.total,
  };
}

export async function fetchTemplate(
  templateId: string,
): Promise<TemplateDetailResult> {
  const result = await apiGetRecord<NotificationTemplateDetail>(
    `/admin/notifications/templates/${templateId}`,
  );

  if (result.status !== "ok") return result;
  return { status: "ok", template: result.data };
}

export async function fetchRules(params?: {
  eventType?: string;
  channel?: string;
  search?: string;
}): Promise<RuleListResult> {
  const query = new URLSearchParams();
  if (params?.eventType) query.set("eventType", params.eventType);
  if (params?.channel) query.set("channel", params.channel);
  if (params?.search) query.set("search", params.search);

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const result = await apiGet<RuleListPayload>(
    `/admin/notifications/rules${suffix}`,
  );

  if (result.status !== "ok") return result;
  return { status: "ok", rules: result.data.items, total: result.data.total };
}

export async function fetchRule(ruleId: string): Promise<RuleDetailResult> {
  const result = await apiGetRecord<NotificationEventRuleDetail>(
    `/admin/notifications/rules/${ruleId}`,
  );

  if (result.status !== "ok") return result;
  return { status: "ok", rule: result.data };
}

export async function fetchDeliveries(params?: {
  status?: string;
  channel?: string;
  eventType?: string;
}): Promise<DeliveryListResult> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.channel) query.set("channel", params.channel);
  if (params?.eventType) query.set("eventType", params.eventType);

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const result = await apiGet<DeliveryMonitorPayload>(
    `/admin/notifications/deliveries${suffix}`,
  );

  if (result.status !== "ok") return result;
  return {
    status: "ok",
    deliveries: result.data.items,
    total: result.data.total,
  };
}

/** Rule 15: the attempt history behind one notification. */
export async function fetchDeliveryAttempts(
  notificationId: string,
): Promise<DeliveryAttemptsResult> {
  const result = await apiGetRecord<DeliveryAttempt[]>(
    `/admin/notifications/deliveries/${notificationId}/attempts`,
  );

  if (result.status !== "ok") return result;
  return { status: "ok", attempts: result.data };
}
