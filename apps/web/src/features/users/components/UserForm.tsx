"use client";

import type { BranchSummary, RoleSummary, UserDetail } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import {
  PASSWORD_MIN_LENGTH,
  USER_STATUS_OPTIONS,
  pick,
} from "@lms/validation";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { ReadField, ReadFields } from "@/components/common/ReadField";
import { SelectField } from "@/components/form/FormFields";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import PasswordInput from "@/components/form/input/PasswordInput";
import CredentialRevealPanel from "./CredentialRevealPanel";
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
    <Button type="submit" size="sm" disabled={pending}>
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
 * The status field offers PENDING and INACTIVE but not ACTIVE, because ACTIVE is
 * not something the administrator picks — it is what setting a password causes.
 * Leave the password blank and the account is provisioned without a credential,
 * exactly as before; fill it in and the server activates the account and flags
 * it for a forced change at first sign-in.
 *
 * On success WITH a password the action returns rather than redirecting, and
 * this renders {@link CredentialRevealPanel} instead of the form — the password
 * exists nowhere else, so it has to be shown before the page is left.
 */
export default function UserForm({
  user,
  surface,
  branches,
  roles,
  canEdit,
}: UserFormProps) {
  const mode = user ? "edit" : "create";
  /**
   * Read first when editing an existing record.
   *
   * A create form has nothing to read, so it opens straight into the fields —
   * `mode` is what decides, not the permission.
   */
  const [editing, setEditing] = useState(mode === "create");
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

  // Replaces the form entirely rather than sitting above it: the account exists
  // now, so re-submitting the same fields would only produce a duplicate-mobile
  // error, and leaving the inputs on screen invites exactly that.
  if (state.credential) {
    return (
      <CredentialRevealPanel
        mobile={state.credential.mobile}
        password={state.credential.password}
        returnHref={isEmployee ? "/employees" : "/users"}
        returnLabel={isEmployee ? "Back to employees" : "Back to admins"}
      />
    );
  }

  if (user && !editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
            {isEmployee ? "Employee" : "Administrator"}
          </h3>
          {/* Absent rather than disabled without the permission: a control that
              appears and then refuses is worse than one never offered. */}
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-brand-500 text-sm font-medium hover:underline"
            >
              Edit
            </button>
          )}
        </div>

        <ReadFields>
          <ReadField label="Name" value={user.name} />
          <ReadField label="Mobile Number" value={user.mobile} />
          <ReadField label="Email" value={user.email} />
          {isEmployee && (
            <ReadField label="Employee ID" value={user.employeeCode} />
          )}
          <ReadField label="Branch" value={user.branchName} />
          <ReadField label="Status" value={user.status.toLowerCase()} />
          <ReadField
            label="Roles"
            value={user.roles.length > 0 ? user.roles.join(", ") : null}
          />
        </ReadFields>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {user && (
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
            Edit {noun}
          </h3>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-brand-500 text-sm font-medium hover:underline"
          >
            Cancel
          </button>
        </div>
      )}
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

        {/*
          Employee ID is shown but never submitted, and only once it exists.
          The server allocates it on create, so on the add form there is nothing
          to show and nothing to ask for — an empty disabled box would just
          raise the question of what to type in it. On edit it is displayed
          because it is how the rest of the system refers to this person, and
          disabled because historical records identify them by it: changing it
          would rewrite what those records point at. It carries no `name`, so it
          stays out of the FormData either way.
        */}
        {isEmployee && user?.employeeCode ? (
          <div>
            <Label htmlFor="employeeCode">Employee ID</Label>
            <Input
              id="employeeCode"
              defaultValue={user.employeeCode}
              disabled
              hint="Assigned automatically and fixed after creation."
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
              hint="Used only when you leave the password blank. Setting a password activates the account instead."
            />

            {/* Optional on purpose. Blank keeps the older behaviour — an account
                with no credential, which the person sets themselves through
                Forgot Password. Filled in, the account works immediately and is
                confined to Change Password until they replace it. */}
            <PasswordInput
              id="password"
              name="password"
              label="Temporary Password (optional)"
              toggleLabel="password"
              placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
              autoComplete="new-password"
              errors={state.errors?.password}
            >
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                Leave blank to create the account without one. If you set a
                password, the user must change it the first time they sign in.
              </p>
            </PasswordInput>

            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              label="Confirm Password"
              toggleLabel="confirm password"
              placeholder="Re-enter the password"
              autoComplete="new-password"
              errors={state.errors?.confirmPassword}
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
