"use client";

import { Alert, Badge } from "@lms/ui";
import type { SettingCatalogEntry, SettingSummary } from "@lms/types";
import React, { useActionState, useState } from "react";

import { Field, SelectField, SubmitButton } from "@/components/form/FormFields";

import {
  setSettingStatusAction,
  upsertSettingAction,
} from "../actions/settings-actions";

/**
 * Configured settings, with inline edit.
 *
 * # A masked value is never put in an edit field
 *
 * A protected setting read without `settings.protected.manage` arrives with
 * `value` set to a mask rather than the stored value. Rendering that mask in an
 * editable input would let a save write the mask over the real setting — so a
 * masked row shows the mask as text and offers no edit control at all.
 *
 * # An approval-gated setting says so before it is edited
 *
 * `requiresApproval` comes from the registry. The button reads "Submit for
 * approval" rather than "Save", because the value will NOT take effect on
 * submit and a button saying "Save" would misdescribe what happens (Scenario 9).
 *
 * `canManage` hides controls a caller cannot use. Hiding is not the control —
 * the API refuses the write — but offering a form certain to be refused is
 * dishonest.
 */
export default function SettingsList({
  settings,
  catalog,
  loadError = false,
  canManage = false,
  branchId,
}: {
  settings: SettingSummary[];
  catalog: SettingCatalogEntry[];
  loadError?: boolean;
  canManage?: boolean;
  /**
   * Branch scope every write from this list targets. Absent on the organization
   * screen, where a write is organization-scoped.
   */
  branchId?: string;
}) {
  const [editState, editAction] = useActionState(upsertSettingAction, {});
  const [statusState, statusAction] = useActionState(setSettingStatusAction, {});
  const [editing, setEditing] = useState<string | null>(null);

  if (loadError) {
    return (
      <Alert
        variant="error"
        title="Settings unavailable"
        message="We could not load the settings. Refresh to try again."
      />
    );
  }

  const configured = new Set(settings.map((setting) => setting.settingCode));
  const unconfigured = catalog.filter((entry) => !configured.has(entry.code));

  return (
    <div className="space-y-5">
      {editState.success ? (
        <Alert variant="success" title="Saved" message={editState.success} />
      ) : null}
      {editState.message ? (
        <Alert variant="error" title="Not saved" message={editState.message} />
      ) : null}
      {statusState.success ? (
        <Alert variant="success" title="Updated" message={statusState.success} />
      ) : null}
      {statusState.message ? (
        <Alert variant="error" title="Not updated" message={statusState.message} />
      ) : null}

      {settings.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nothing is configured yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-gray-800 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">Setting</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {settings.map((setting) => (
                <tr
                  key={setting.settingId}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="px-3 py-3">
                    <div className="font-medium text-gray-800 dark:text-white/90">
                      {setting.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {setting.description}
                    </div>
                    <div className="mt-1 flex gap-1">
                      {setting.isProtected ? (
                        <Badge color="warning">Protected</Badge>
                      ) : null}
                      {setting.requiresApproval ? (
                        <Badge color="info">Needs approval</Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">
                    {setting.isValueMasked
                      ? "••••••••"
                      : String(setting.value ?? "")}
                  </td>
                  {/* On the branch screen an organization row is the effective
                      DEFAULT, not a value set for this branch — saying only
                      "Organization" there would leave it ambiguous whether the
                      branch has its own value. */}
                  <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
                    {setting.branchId
                      ? "Branch"
                      : branchId
                        ? "Inherited from organization"
                        : "Organization"}
                  </td>
                  <td className="px-3 py-3">
                    <Badge
                      color={setting.status === "ACTIVE" ? "success" : "light"}
                    >
                      {setting.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-right">
                    {/* A masked value cannot be edited here: the form would
                        submit the mask. Whoever may see it may edit it. */}
                    {canManage && !setting.isValueMasked ? (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setEditing(
                              editing === setting.settingId
                                ? null
                                : setting.settingId,
                            )
                          }
                          className="text-xs font-medium text-brand-500 hover:underline"
                        >
                          {editing === setting.settingId ? "Cancel" : "Edit"}
                        </button>

                        {/* Deactivation, not deletion, is the sanctioned removal
                            path where a setting is referenced: historical
                            records keep resolving and only NEW operations stop
                            seeing it (Rules 36, 38; Scenario 14). */}
                        <form action={statusAction}>
                          <input
                            type="hidden"
                            name="settingId"
                            value={setting.settingId}
                          />
                          <input
                            type="hidden"
                            name="expectedVersion"
                            value={setting.version}
                          />
                          <input
                            type="hidden"
                            name="status"
                            value={
                              setting.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"
                            }
                          />
                          <button
                            type="submit"
                            className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                          >
                            {setting.status === "ACTIVE"
                              ? "Deactivate"
                              : "Reactivate"}
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing
        ? (() => {
            const setting = settings.find((row) => row.settingId === editing);
            if (!setting) return null;
            return (
              <form
                action={editAction}
                className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
              >
                <input
                  type="hidden"
                  name="settingCode"
                  value={setting.settingCode}
                />
                <input
                  type="hidden"
                  name="expectedVersion"
                  value={setting.version}
                />
                {/* The scope being EDITED, which is not always the scope the
                    row was read from. On the branch screen a row inherited from
                    the organization arrives with `branchId: null`; saving it
                    must create a branch override rather than rewrite the
                    organization value every other branch also reads. */}
                {branchId ?? setting.branchId ? (
                  <input
                    type="hidden"
                    name="branchId"
                    value={branchId ?? setting.branchId ?? ""}
                  />
                ) : null}

                <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {setting.name}
                </h3>

                {setting.valueType === "BOOLEAN" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="value"
                      defaultChecked={setting.value === true}
                    />
                    Enabled
                  </label>
                ) : (
                  <Field
                    label="Value"
                    name="value"
                    defaultValue={String(setting.value ?? "")}
                    errors={editState.errors?.value}
                    hint={
                      setting.valueType === "PAISE"
                        ? "A whole number of paise. 1000 means ₹10.00."
                        : undefined
                    }
                  />
                )}

                <Field
                  label="Change Reason"
                  name="changeReason"
                  errors={editState.errors?.changeReason}
                />

                {/* Not "Save": an approval-gated value does NOT take effect on
                    submit, and a button saying so would misdescribe what
                    happens (Scenario 9). */}
                <SubmitButton
                  label={
                    setting.requiresApproval ? "Submit for approval" : "Save"
                  }
                />
              </form>
            );
          })()
        : null}

      {canManage && unconfigured.length > 0 ? (
        <form
          action={editAction}
          className="space-y-4 rounded-xl border border-dashed border-gray-300 p-4 dark:border-gray-700"
        >
          <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
            Configure a setting
          </h3>

          {/* Without this the branch screen would create an ORGANIZATION
              setting, changing the value every branch reads. */}
          {branchId ? (
            <input type="hidden" name="branchId" value={branchId} />
          ) : null}

          {/* Only registry codes are offered — the UI half of Rule 9. The
              server refuses an unknown code regardless. */}
          <SelectField
            label="Setting"
            name="settingCode"
            options={unconfigured.map((entry) => ({
              value: entry.code,
              label: entry.name,
              hint: entry.description,
            }))}
          />
          <Field label="Value" name="value" />
          <Field
            label="Change Reason"
            name="changeReason"
            errors={editState.errors?.changeReason}
          />
          <SubmitButton label="Add" />
        </form>
      ) : null}

    </div>
  );
}
