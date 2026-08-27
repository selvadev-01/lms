"use client";

import type { BranchSummary, RoleSummary, UserDetail } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import { USER_STATUS_OPTIONS, pick } from "@lms/validation";
import React, { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { SelectField } from "@/components/form/FormFields";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import {
  createUserAction,
  updateUserAction,
  type UserFormState,
} from "../actions/user-actions";
import {
  createEmployeeAction,
  updateEmployeeAction,
} from "../actions/employee-actions";

function SaveButton({ mode, noun }: { mode: "create" | "edit"; noun: string }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" disabled={pending}>
      {pending
        ? mode === "create"
          ? "Creating…"
          : "Saving…"
        : mode === "create"
          ? `Create ${noun}`
          : "Save changes"}
    </Button>
  );
}

export interface UserFormProps {
  /** Absent when creating. */
  user?: UserDetail;
  surface: "USER" | "EMPLOYEE";
  /** ACTIVE branches only — an inactive one cannot receive anyone. */
  branches: BranchSummary[];
  /** ACTIVE roles only — an inactive role grants nothing (Scenario 35). */
  roles: RoleSummary[];
  canEdit: boolean;
}

/**
 * Admin and employee add / edit.
 *
 * One component for both surfaces and both modes. The differences are narrow and
 * all of them follow from the API's own shape:
 *
 * - An employee needs an Employee ID and a branch; an administrator's branch is
 *   optional, and leaving it blank makes them organization-wide.
 * - On edit only Name and Email remain writable. Mobile is the login identifier;
 *   status, roles and branch each have their own endpoint and permission, so
 *   putting them on this form would imply one save could change all four.
 *
 * The status field offers PENDING and INACTIVE but not ACTIVE: a new account has
 * no password, so ACTIVE would advertise access nobody can use. The API refuses
 * it too — this just avoids offering a choice that will be rejected.
 */
export default function UserForm({
  user,
  surface,
  branches,
  roles,
  canEdit,
}: UserFormProps) {
  const mode = user ? "edit" : "create";
  const isEmployee = surface === "EMPLOYEE";
  const noun = isEmployee ? "employee" : "user";

  const [state, formAction] = useActionState<UserFormState, FormData>(
    user
      ? isEmployee
        ? updateEmployeeAction
        : updateUserAction
      : isEmployee
        ? createEmployeeAction
        : createUserAction,
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
        {user ? (
          <input type="hidden" name="userId" value={user.userId} />
        ) : null}

        <div>
          <Label htmlFor="name">
            Full Name <span className="text-error-500">*</span>
          </Label>
          <Input
            id="name"
            name="name"
            defaultValue={user?.name ?? ""}
            disabled={!canEdit}
            error={Boolean(fieldError("name"))}
            hint={fieldError("name")}
          />
        </div>

        {isEmployee ? (
          <div>
            <Label htmlFor="employeeCode">
              Employee ID <span className="text-error-500">*</span>
            </Label>
            <Input
              id="employeeCode"
              // Fixed after creation: historical records identify the employee
              // by this code, so changing it would rewrite what they refer to.
              name={user ? undefined : "employeeCode"}
              defaultValue={user?.employeeCode ?? ""}
              disabled={Boolean(user) || !canEdit}
              error={Boolean(fieldError("employeeCode"))}
              hint={
                fieldError("employeeCode") ??
                (user
                  ? "The Employee ID is fixed after creation."
                  : "Unique within your organization, e.g. EMP021.")
              }
            />
          </div>
        ) : null}

        <div>
          <Label htmlFor="mobile">
            Mobile Number <span className="text-error-500">*</span>
          </Label>
          <Input
            id="mobile"
            // The login identifier. Changing it is an identity change rather
            // than a profile edit, so it is not offered here.
            name={user ? undefined : "mobile"}
            defaultValue={user?.mobile ?? ""}
            disabled={Boolean(user) || !canEdit}
            error={Boolean(fieldError("mobile"))}
            hint={
              fieldError("mobile") ??
              (user
                ? "The mobile number is the login identifier and cannot be changed here."
                : "10 digits, used to sign in.")
            }
          />
        </div>

        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={user?.email ?? ""}
            disabled={!canEdit}
            error={Boolean(fieldError("email"))}
            hint={fieldError("email")}
          />
        </div>

        {/*
          Absent on edit: branch and roles each have their own endpoint and
          permission, so they live on the detail page rather than here.
        */}
        {user ? null : (
          <>
            <SelectField
              name="branchId"
              label="Branch"
              required={isEmployee}
              defaultValue=""
              disabled={!canEdit}
              // Blank is a real choice for a non-employee — it means
              // organization-wide — so the placeholder changes meaning with the
              // account kind rather than always reading "pick one".
              placeholder={isEmployee ? "Select a branch" : "All branches"}
              options={branches.map((branch) => ({
                value: branch.branchId,
                label: branch.name,
              }))}
              errors={
                fieldError("branchId") ? [fieldError("branchId")!] : undefined
              }
              hint={
                isEmployee
                  ? "Only active branches can receive an employee."
                  : "Leaving this blank makes the account organization-wide."
              }
            />

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                Roles <span className="text-error-500">*</span>
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
                      disabled={!canEdit}
                      className="text-brand-500 focus:ring-brand-500/20 h-4 w-4 rounded border-gray-300"
                    />
                    <span>{role.name}</span>
                    <span className="text-xs text-gray-400">({role.code})</span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {fieldError("roleIds") ??
                  "Only active roles are listed — an inactive role grants nothing."}
              </p>
            </fieldset>

            <SelectField
              name="status"
              label="Account Status"
              required
              defaultValue="PENDING"
              disabled={!canEdit}
              // A new account always has a status, so no blank first option.
              placeholder=""
              // Two of the five UserStatus values on purpose: ACTIVE, LOCKED and
              // SUSPENDED are reached by acting on an existing account, never by
              // choosing them at creation. PENDING keeps its longer label here —
              // the extra clause is what explains why ACTIVE is not on offer.
              options={pick(USER_STATUS_OPTIONS, ["PENDING", "INACTIVE"]).map(
                (option) =>
                  option.value === "PENDING"
                    ? { ...option, label: "Pending — awaiting a password" }
                    : option,
              )}
              errors={
                fieldError("status") ? [fieldError("status")!] : undefined
              }
              hint="A new account has no password yet, so it cannot start active."
            />
          </>
        )}

        {canEdit ? (
          <div className="flex justify-end">
            <SaveButton mode={mode} noun={noun} />
          </div>
        ) : null}
      </form>
    </div>
  );
}
