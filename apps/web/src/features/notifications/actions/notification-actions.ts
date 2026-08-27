"use server";

import type { NotificationPreferences } from "@lms/types";
import { revalidatePath } from "next/cache";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Notification mutations (Module 16).
 *
 * # What is absent, and why
 *
 * **No delete.** Rules 69 to 71 and Scenario 47 retain notification history for
 * audit; archiving is the user-visible removal and it is a timestamp. An action
 * whose only correct implementation is a refusal is not worth having.
 *
 * **No `userId` on the preferences action.** The route it calls has no slot for
 * one, so Scenario 19 holds structurally rather than by this file declining to
 * send it.
 *
 * **No "mark all read".** Rule 47 makes some notifications mandatory
 * operational alerts, and a single click that clears every one of them is how a
 * user misses the one that mattered. Each is acknowledged on its own.
 */

export interface NotificationFormState extends ActionState {
  /** Populated when the API refused a template or rule deletion (Scenario 11). */
  blockers?: { key: string; reason: string }[];
  /**
   * Populated on a preference conflict (Scenarios 21, 51) — the current server
   * state, so the form can show what it was actually up against rather than
   * asking the user to guess.
   */
  current?: NotificationPreferences;
}

const SERVICE = "Notifications";

/**
 * Carries the API's refusal detail through to the form.
 *
 * Read narrowly off the state rather than casting the whole thing, so a shape
 * change in the error body surfaces as a missing list rather than a runtime
 * throw inside a server action.
 */
function withRefusalDetail(state: ActionState): NotificationFormState {
  const blockers = (state as { blockers?: unknown }).blockers;
  const current = (state as { current?: unknown }).current;

  return {
    ...state,
    ...(Array.isArray(blockers)
      ? { blockers: blockers as { key: string; reason: string }[] }
      : {}),
    ...(current ? { current: current as NotificationPreferences } : {}),
  };
}

function revalidateCentre(notificationId?: string): void {
  if (notificationId) revalidatePath(`/notifications/${notificationId}`);
  revalidatePath("/notifications");
  // The header bell renders on every admin page, so its count is stale
  // everywhere until the layout re-renders.
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Notification centre
// ---------------------------------------------------------------------------

/**
 * Scenarios 3 and 4.
 *
 * Changes this recipient's row only. The same event's notification to another
 * user is a different row and stays unread.
 */
export async function markNotificationReadAction(
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const notificationId = String(formData.get("notificationId") ?? "");

  const outcome = await call(
    `/notifications/${notificationId}/read`,
    { method: "PATCH" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCentre(notificationId);
  return { success: "Marked as read." };
}

export async function markNotificationUnreadAction(
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const notificationId = String(formData.get("notificationId") ?? "");

  const outcome = await call(
    `/notifications/${notificationId}/unread`,
    { method: "PATCH" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCentre(notificationId);
  return { success: "Marked as unread." };
}

/** Scenario 46. Removes it from the active list; never deletes it. */
export async function archiveNotificationAction(
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const notificationId = String(formData.get("notificationId") ?? "");

  const outcome = await call(
    `/notifications/${notificationId}/archive`,
    { method: "PATCH" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCentre(notificationId);
  return { success: "Archived." };
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * Scenario 18, with Scenarios 21 and 51 on the failure path.
 *
 * The `version` the form read travels back with the save. A mismatch is a 409
 * carrying the current server state, which this forwards so the screen can show
 * what it was up against instead of silently overwriting it.
 *
 * The nine category checkboxes are read by name: an unchecked box sends nothing
 * at all, so `has()` is what distinguishes "off" from "absent" — reading
 * `get()` would make every unchecked box look like a field the form forgot.
 */
export async function updatePreferencesAction(
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const version = Number(formData.get("version"));
  if (!Number.isFinite(version) || version < 1) {
    return { message: "Reload the page and try again." };
  }

  const categories = [
    "APPLICATION",
    "APPROVAL",
    "DISBURSAL",
    "EMI",
    "COLLECTION",
    "FIELD_COLLECTION",
    "OVERDUE",
    "RECOVERY",
    "SECURITY",
  ] as const;

  const eventPreferences: Record<string, boolean> = {};
  for (const category of categories) {
    eventPreferences[category] = formData.has(`event_${category}`);
  }

  const outcome = await call(
    "/notifications/preferences",
    {
      method: "PUT",
      body: {
        inAppEnabled: formData.has("inAppEnabled"),
        emailEnabled: formData.has("emailEnabled"),
        smsEnabled: formData.has("smsEnabled"),
        eventPreferences,
        version,
      },
    },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidatePath("/notifications/preferences");
  return {
    success:
      "Preferences saved. Mandatory operational alerts are always delivered.",
  };
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

/** Scenario 10: the sanctioned way to retire a referenced template. */
export async function setTemplateStatusAction(
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const templateId = String(formData.get("templateId") ?? "");
  const activate = formData.get("activate") === "true";

  const outcome = await call(
    `/admin/notifications/templates/${templateId}/${activate ? "activate" : "deactivate"}`,
    { method: "PATCH" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidatePath("/admin/notifications/templates");
  return { success: activate ? "Template activated." : "Template deactivated." };
}

export async function setRuleActiveAction(
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const ruleId = String(formData.get("ruleId") ?? "");
  const activate = formData.get("activate") === "true";

  const outcome = await call(
    `/admin/notifications/rules/${ruleId}/${activate ? "activate" : "deactivate"}`,
    { method: "PATCH" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidatePath("/admin/notifications/rules");
  return { success: activate ? "Rule activated." : "Rule deactivated." };
}

/**
 * Scenario 45.
 *
 * A separate permission from viewing the delivery, and still bounded by the
 * rule's attempt cap — this re-enqueues, it does not bypass Rules 19 and 20.
 */
export async function retryDeliveryAction(
  _previous: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const notificationId = String(formData.get("notificationId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!reason) {
    return { errors: { reason: ["Reason is required"] } };
  }

  const outcome = await call(
    `/admin/notifications/deliveries/${notificationId}/retry`,
    { method: "POST", body: { reason } },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidatePath("/admin/notifications/deliveries");
  return { success: "Delivery re-queued." };
}
