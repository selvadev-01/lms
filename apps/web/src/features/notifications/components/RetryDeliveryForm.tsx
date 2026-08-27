"use client";

import { useActionState } from "react";

import { retryDeliveryAction } from "../actions/notification-actions";

/**
 * Manually re-enqueue a failed delivery (Scenario 45).
 *
 * The reason is required and inline rather than behind a dialog: a manual retry
 * overrides an automatic decision, and the audit trail should record who judged
 * the failure transient and why. Making it a separate step invites an empty
 * reason typed to get past the dialog.
 *
 * Rendered only when the caller holds `notifications.deliveries.retry`. The API
 * refuses it again regardless — this is a UX measure, not the control.
 */
export default function RetryDeliveryForm({
  notificationId,
}: {
  notificationId: string;
}) {
  const [state, formAction] = useActionState(retryDeliveryAction, {});

  return (
    <form action={formAction} className="flex items-center justify-end gap-2">
      <input type="hidden" name="notificationId" value={notificationId} />

      <label className="sr-only" htmlFor={`reason-${notificationId}`}>
        Reason for retrying
      </label>
      <input
        id={`reason-${notificationId}`}
        name="reason"
        placeholder="Reason"
        maxLength={500}
        aria-invalid={state.errors?.reason ? true : undefined}
        className="text-theme-xs h-8 w-36 rounded-lg border border-gray-300 px-2 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
      />

      <button
        type="submit"
        className="text-theme-xs bg-brand-500 hover:bg-brand-600 rounded-lg px-3 py-1.5 font-medium text-white"
      >
        Retry
      </button>

      {state.message ? (
        <span className="text-theme-xs text-error-500" role="alert">
          {state.message}
        </span>
      ) : null}
      {state.success ? (
        <span className="text-theme-xs text-success-500" role="status">
          {state.success}
        </span>
      ) : null}
    </form>
  );
}
