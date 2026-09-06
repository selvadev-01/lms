"use client";

import type { RoleDetail } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import React, { useActionState } from "react";
import { useFormStatus } from "react-dom";

import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import {
  createRoleAction,
  updateRoleAction,
  type RoleFormState,
} from "../actions/role-actions";

function SaveButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending
        ? mode === "create"
          ? "Creating…"
          : "Saving…"
        : mode === "create"
          ? "Create role"
          : "Save changes"}
    </Button>
  );
}

export interface RoleFormProps {
  /** Absent when creating. */
  role?: RoleDetail;
  canEdit: boolean;
}

/**
 * Create Role, and the rename that follows.
 *
 * Deliberately does not carry permissions. The source sequence is Create Role →
 * Assign Module Permissions → Save & Activate, and splitting the form the same
 * way is what makes that sequence visible: a role is created empty and DRAFT,
 * then the permission editor appears on its detail page.
 *
 * The role code is fixed after creation for the same reason a branch code is —
 * it is what audit records and code alike refer to, so renaming it would
 * retroactively change what an already-written log line means.
 */
export default function RoleForm({ role, canEdit }: RoleFormProps) {
  const mode = role ? "edit" : "create";

  const [state, formAction] = useActionState<RoleFormState, FormData>(
    role ? updateRoleAction : createRoleAction,
    {},
  );

  const fieldError = (name: string): string | undefined =>
    state.errors?.[name]?.[0];

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

      <form action={formAction} noValidate className="space-y-5">
        {role ? (
          <input type="hidden" name="roleId" value={role.roleId} />
        ) : null}

        <div>
          <Label htmlFor="code">
            Role Code <span className="text-error-500">*</span>
          </Label>
          <Input
            id="code"
            name={role ? undefined : "code"}
            defaultValue={role?.code ?? ""}
            disabled={Boolean(role) || !canEdit}
            error={Boolean(fieldError("code"))}
            hint={
              fieldError("code") ??
              (role
                ? "The role code is fixed after creation."
                : "Uppercase letters, digits and underscores, e.g. AUDITOR.")
            }
          />
        </div>

        <div>
          <Label htmlFor="name">
            Role Name <span className="text-error-500">*</span>
          </Label>
          <Input
            id="name"
            name="name"
            defaultValue={role?.name ?? ""}
            disabled={!canEdit}
            error={Boolean(fieldError("name"))}
            hint={fieldError("name")}
          />
        </div>

        <div>
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            name="description"
            defaultValue={role?.description ?? ""}
            disabled={!canEdit}
            error={Boolean(fieldError("description"))}
            hint={
              fieldError("description") ??
              "What this role is for, in a sentence."
            }
          />
        </div>

        {role ? null : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            The role is created as a draft. Assign its permissions on the next
            screen, then activate it.
          </p>
        )}

        {canEdit ? (
          <div className="flex justify-end">
            <SaveButton mode={mode} />
          </div>
        ) : null}
      </form>
    </div>
  );
}
