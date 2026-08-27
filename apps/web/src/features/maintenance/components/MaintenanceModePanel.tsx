"use client";

import { Alert, Badge } from "@lms/ui";
import type { MaintenanceModeDetail } from "@lms/types";
import React, { useActionState } from "react";

import { Field, SubmitButton } from "@/components/form/FormFields";

import { setMaintenanceModeAction } from "../actions/maintenance-actions";

/**
 * Maintenance mode (Scenarios 32-35).
 *
 * # Enabling this does not grant anybody anything
 *
 * The guard enforcing it runs AFTER authentication and authorization, so it can
 * only subtract access (Rule 78). A caller lacking a permission still gets a 403
 * rather than the maintenance refusal — worth stating on the screen, because an
 * operator reasonably assumes a switch labelled "maintenance mode" changes who
 * can do what.
 *
 * # The delay is disclosed rather than hidden
 *
 * State is cached for up to a minute per server, so a toggle is not instant. An
 * operator who is not told this will toggle twice, assume it is broken, and
 * escalate.
 */
export default function MaintenanceModePanel({
  modes,
  loadError = false,
  canManage = false,
}: {
  modes: MaintenanceModeDetail[];
  loadError?: boolean;
  canManage?: boolean;
}) {
  const [state, action] = useActionState(setMaintenanceModeAction, {});

  if (loadError) {
    return (
      <Alert
        variant="error"
        title="Maintenance mode unavailable"
        message="We could not load the operational state. Refresh to try again."
      />
    );
  }

  const orgWide = modes.find((mode) => mode.branchId === null);
  const active = modes.filter((mode) => mode.enabled);

  return (
    <div className="space-y-5">
      {state.success ? (
        <Alert variant="success" title="Updated" message={state.success} />
      ) : null}
      {state.message ? (
        <Alert variant="error" title="Not updated" message={state.message} />
      ) : null}

      <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800 dark:text-white/90">
            Current state
          </span>
          <Badge color={active.length > 0 ? "warning" : "success"}>
            {active.length > 0 ? "Maintenance in progress" : "Normal operation"}
          </Badge>
        </div>

        {active.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs text-gray-600 dark:text-gray-300">
            {active.map((mode) => (
              <li key={mode.maintenanceModeId}>
                {mode.branchId ? "Branch" : "Organization-wide"} — {mode.reason}
                {mode.expectedEndAt
                  ? ` (expected to end ${new Date(
                      mode.expectedEndAt,
                    ).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })})`
                  : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            No maintenance window is active.
          </p>
        )}
      </div>

      {canManage ? (
        <form
          action={action}
          className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
        >
          <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
            {orgWide?.enabled ? "Disable" : "Enable"} maintenance mode
          </h3>

          {orgWide ? (
            <input
              type="hidden"
              name="expectedVersion"
              value={orgWide.version}
            />
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={!orgWide?.enabled}
            />
            Block write operations organization-wide
          </label>

          {/* Mandatory in BOTH directions (Rule 77). */}
          <Field
            label="Reason"
            name="reason"
            errors={state.errors?.reason}
            hint="Recorded in the audit trail whether you are enabling or disabling."
          />

          <Field
            label="Message shown to users"
            name="userMessage"
            hint="Optional. Shown when an operation is refused (Rule 79)."
          />

          <SubmitButton label="Apply" />

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Reads stay available throughout. Maintenance mode never grants access
            — a user who lacks a permission is still refused for that reason.
            Changes take up to a minute to reach every server.
          </p>
        </form>
      ) : null}
    </div>
  );
}
