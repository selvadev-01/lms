"use client";

import type { PermissionSummary, RoleDetail } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import React, { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  setRolePermissionsAction,
  type RoleFormState,
} from "../actions/role-actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save permissions"}
    </Button>
  );
}

export interface PermissionEditorProps {
  role: RoleDetail;
  /** The organization's catalog, each entry flagged with `delegable`. */
  permissions: PermissionSummary[];
  canEdit: boolean;
}

/** Groups the catalog by module, preserving the server's ordering within each. */
function groupByModule(
  permissions: PermissionSummary[],
): Array<[string, PermissionSummary[]]> {
  const groups = new Map<string, PermissionSummary[]>();

  for (const permission of permissions) {
    const existing = groups.get(permission.module);
    if (existing) existing.push(permission);
    else groups.set(permission.module, [permission]);
  }

  return [...groups.entries()];
}

/**
 * Assign Module Permissions — the middle step of Create Role → Assign Module
 * Permissions → Save & Activate.
 *
 * Two server rules are mirrored here so the form never invites a submission that
 * will be refused. Both are presentation only; the API enforces them regardless.
 *
 * **Delegation.** A permission the caller does not hold themselves renders
 * disabled, driven by `delegable` from the catalog endpoint. Without this the
 * editor would offer checkboxes an administrator can tick but not save, and the
 * only feedback would be a 403 after they had composed the whole role.
 *
 * **System roles.** A system role may gain permissions but never lose them, so
 * its already-granted boxes are disabled while the rest stay live. A disabled
 * checkbox submits nothing, so each granted permission is also carried in a
 * hidden input — otherwise saving would silently strip exactly the permissions
 * the rule exists to protect.
 */
export default function PermissionEditor({
  role,
  permissions,
  canEdit,
}: PermissionEditorProps) {
  const [state, formAction] = useActionState<RoleFormState, FormData>(
    setRolePermissionsAction,
    {},
  );

  const granted = new Set(role.permissions);
  const groups = groupByModule(permissions);

  /** Locked-on: a system role's existing grants cannot be removed. */
  const isLocked = (code: string): boolean =>
    role.isSystem && granted.has(code);

  return (
    <div className="space-y-6">
      <div role="alert" aria-live="assertive">
        {state.message ? (
          <Alert variant="error" title="Not saved" message={state.message} />
        ) : null}
      </div>
      <div role="status" aria-live="polite">
        {state.success ? (
          <Alert variant="success" title="Saved" message={state.success} />
        ) : null}
      </div>

      {role.isSystem ? (
        <Alert
          variant="info"
          title="This is a system role"
          message="Its existing permissions cannot be removed, because doing so could leave the organization without an administrator. New permissions may still be added."
        />
      ) : null}

      <form action={formAction} noValidate className="space-y-6">
        <input type="hidden" name="roleId" value={role.roleId} />

        {groups.map(([module, entries]) => (
          <fieldset
            key={module}
            className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
          >
            <legend className="px-2 text-sm font-medium text-gray-700 capitalize dark:text-gray-300">
              {module}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {entries.map((permission) => {
                const locked = isLocked(permission.code);
                const disabled = !canEdit || !permission.delegable || locked;

                return (
                  <label
                    key={permission.code}
                    className={`flex items-start gap-2 text-sm ${
                      disabled
                        ? "text-gray-400 dark:text-gray-500"
                        : "text-gray-700 dark:text-gray-300"
                    }`}
                    title={
                      !permission.delegable
                        ? "You cannot grant a permission you do not hold yourself."
                        : locked
                          ? "A system role cannot lose a permission."
                          : (permission.description ?? undefined)
                    }
                  >
                    <input
                      type="checkbox"
                      name="permissions"
                      value={permission.code}
                      defaultChecked={granted.has(permission.code)}
                      disabled={disabled}
                      className="text-brand-500 focus:ring-brand-500/20 mt-0.5 h-4 w-4 rounded border-gray-300"
                    />
                    <span>
                      <span className="font-mono text-xs">
                        {permission.code}
                      </span>
                      {permission.description ? (
                        <span className="block text-xs text-gray-500 dark:text-gray-400">
                          {permission.description}
                        </span>
                      ) : null}
                      {!permission.delegable ? (
                        <span className="text-warning-500 block text-xs">
                          You do not hold this permission.
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        {/*
          A disabled checkbox is not submitted, so a system role's locked grants
          would be dropped from the replacement set and silently revoked. These
          carry them through.
        */}
        {role.permissions
          .filter((code) => isLocked(code))
          .map((code) => (
            <input key={code} type="hidden" name="permissions" value={code} />
          ))}

        {canEdit ? (
          <div className="flex justify-end">
            <SaveButton />
          </div>
        ) : null}
      </form>
    </div>
  );
}
