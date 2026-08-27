"use client";

import type { NotificationPreferences } from "@lms/types";
import { Alert } from "@lms/ui";
import { PREFERENCE_CATEGORY_OPTIONS } from "@lms/validation";
import { useActionState } from "react";

import { SubmitButton } from "@/components/form/FormFields";
import { updatePreferencesAction } from "../actions/notification-actions";

/**
 * Personal notification preferences.
 *
 * # The conflict is shown, not swallowed
 *
 * Scenarios 21 and 51: a save from a stale page is refused with the current
 * server state attached, and this renders that state rather than a bare "try
 * again". A user who saved on their phone and then on their laptop should be
 * able to see what the phone did before deciding what to keep.
 *
 * # Mandatory alerts are stated, not hidden
 *
 * Rules 47 and 48 mean some notifications ignore every switch on this screen. A
 * user who turns everything off and still receives an approval alert has been
 * misled by the form unless the form says so — hence the standing note, present
 * whether or not anything was just saved.
 */
export default function PreferenceForm({
  preferences,
  canManage,
}: {
  preferences: NotificationPreferences;
  /** Rendered read-only without `notifications.preferences.manage`. */
  canManage: boolean;
}) {
  const [state, formAction] = useActionState(updatePreferencesAction, {});

  // After a conflict the server told us what it actually holds; show that
  // rather than the values this page loaded with, which are now known stale.
  const shown = state.current ?? preferences;

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <input type="hidden" name="version" value={shown.version} />

      {state.message ? (
        <div className="mb-4">
          <Alert
            variant="error"
            title={state.current ? "Changed elsewhere" : "Not saved"}
            message={
              state.current
                ? `${state.message} The settings below are what the server currently holds.`
                : state.message
            }
          />
        </div>
      ) : null}
      {state.success ? (
        <div className="mb-4">
          <Alert variant="success" title="Saved" message={state.success} />
        </div>
      ) : null}

      <fieldset disabled={!canManage} className="space-y-6">
        <div>
          <legend className="text-base font-semibold text-gray-800 dark:text-white/90">
            Channels
          </legend>
          <p className="text-theme-xs mt-1 text-gray-500 dark:text-gray-400">
            How optional notifications reach you.
          </p>

          <div className="mt-3 space-y-2">
            <Toggle
              name="inAppEnabled"
              label="In-app"
              hint="The notification centre and the bell."
              defaultChecked={shown.inAppEnabled}
            />
            <Toggle
              name="emailEnabled"
              label="Email"
              defaultChecked={shown.emailEnabled}
            />
            <Toggle
              name="smsEnabled"
              label="SMS"
              defaultChecked={shown.smsEnabled}
            />
          </div>
        </div>

        <div>
          <legend className="text-base font-semibold text-gray-800 dark:text-white/90">
            What to notify me about
          </legend>

          <div className="mt-3 space-y-2">
            {PREFERENCE_CATEGORY_OPTIONS.map((option) => (
              <Toggle
                key={option.value}
                name={`event_${option.value}`}
                label={option.label}
                // Absent means "not yet decided", which is on — the same
                // default the server applies to a user with no stored row.
                defaultChecked={
                  shown.eventPreferences[
                    option.value as keyof typeof shown.eventPreferences
                  ] !== false
                }
              />
            ))}
          </div>
        </div>
      </fieldset>

      <p className="mt-5 rounded-lg bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-800/50 dark:text-gray-400">
        Some operational and security alerts are mandatory and are always
        delivered, whatever is selected here.
      </p>

      {canManage ? (
        <div className="mt-5">
          <SubmitButton label="Save preferences" pendingLabel="Saving…" />
        </div>
      ) : (
        <p className="text-theme-xs mt-5 text-gray-500 dark:text-gray-400">
          You do not have permission to change these settings.
        </p>
      )}
    </form>
  );
}

/**
 * One checkbox.
 *
 * An unchecked box submits nothing at all, which is what the action's
 * `formData.has()` reads — the absence *is* the "off" signal.
 */
function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="text-brand-500 focus:ring-brand-500/10 mt-0.5 h-4 w-4 rounded border-gray-300 focus:ring-3 dark:border-gray-700 dark:bg-gray-900"
      />
      <span>
        <span className="block text-sm text-gray-700 dark:text-gray-300">
          {label}
        </span>
        {hint ? (
          <span className="text-theme-xs block text-gray-400 dark:text-gray-500">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}
