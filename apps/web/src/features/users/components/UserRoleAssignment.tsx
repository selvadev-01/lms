"use client";

import type { RoleSummary, UserDetail } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import React, { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { assignRolesAction, type UserFormState } from "../actions/user-actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save roles"}
    </Button>
  );
}

export interface UserRoleAssignmentProps {
  user: UserDetail;
  /** ACTIVE roles only — an inactive role cannot be assigned (Scenario 35). */
  roles: RoleSummary[];
  canAssign: boolean;
}

/**
 * Role assignment — Scenarios 34, 35, 36, 37.
 *
 * Its own form rather than a section of the edit form, because it is behind its
 * own permission: an administrator who may correct a misspelt name is not
 * thereby able to grant roles.
 *
 * A change takes effect on the user's very next request, not at their next
 * sign-in, because the API re-resolves authorization per request. Worth saying on
 * the screen — the previous behaviour was the opposite and the difference matters
 * when someone is revoking access in a hurry.
 */
export default function UserRoleAssignment({
  user,
  roles,
  canAssign,
}: UserRoleAssignmentProps) {
  const [state, formAction] = useActionState<UserFormState, FormData>(
    assignRolesAction,
    {},
  );

  const held = new Set(user.roles);

  return (
    <div className="space-y-5">
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

      <form action={formAction} noValidate className="space-y-4">
        <input type="hidden" name="userId" value={user.userId} />

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            Assigned roles
          </legend>
          <div className="space-y-2">
            {roles.map((role) => (
              <label
                key={role.roleId}
                className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
              >
                <input
                  type="checkbox"
                  name="roleIds"
                  value={role.roleId}
                  defaultChecked={held.has(role.code)}
                  disabled={!canAssign}
                  className="text-brand-500 focus:ring-brand-500/20 h-4 w-4 rounded border-gray-300"
                />
                <span>{role.name}</span>
                <span className="text-xs text-gray-400">({role.code})</span>
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {state.errors?.roleIds?.[0] ??
              "Only active roles are listed. Changes apply on the user's next request."}
          </p>
        </fieldset>

        {canAssign ? (
          <div className="flex justify-end">
            <SaveButton />
          </div>
        ) : null}
      </form>
    </div>
  );
}
