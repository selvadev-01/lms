"use client";

import type { BranchSummary, UserDetail } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import React, { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { SelectField } from "@/components/form/FormFields";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import {
  assignEmployeeAction,
  type EmployeeFormState,
} from "../actions/employee-actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" disabled={pending}>
      {pending ? "Reassigning…" : "Reassign"}
    </Button>
  );
}

export interface EmployeeAssignmentFormProps {
  user: UserDetail;
  /** ACTIVE branches only — an inactive one cannot receive an employee. */
  branches: BranchSummary[];
  canAssign: boolean;
}

/**
 * "Assign" from the source-defined Add / Assign / Deactivate — Scenarios 17, 18,
 * 19, 50.
 *
 * The assignment target is the branch. Q-RBAC-4 left what "Assign" assigns
 * undefined; branch is the only candidate the source proves is a scope concept,
 * and field-collection assignment is a separate Branch Admin flow.
 *
 * The note about history is not decoration. A reassignment moves the employee and
 * nothing else — past collections keep the branch they were recorded under, which
 * is what Rule 50 requires and what an administrator reassigning someone
 * mid-quarter needs to know before they click.
 */
export default function EmployeeAssignmentForm({
  user,
  branches,
  canAssign,
}: EmployeeAssignmentFormProps) {
  const [state, formAction] = useActionState<EmployeeFormState, FormData>(
    assignEmployeeAction,
    {},
  );

  const inactive = user.status !== "ACTIVE";

  return (
    <div className="space-y-5">
      <div role="alert" aria-live="assertive">
        {state.message ? (
          <Alert
            variant="error"
            title="Not reassigned"
            message={state.message}
          />
        ) : null}
      </div>
      <div role="status" aria-live="polite">
        {state.success ? (
          <Alert variant="success" title="Saved" message={state.success} />
        ) : null}
      </div>

      {inactive ? (
        <Alert
          variant="info"
          title="This employee is not active"
          message="Reactivate them before assigning new work. A deactivated employee cannot receive a new assignment."
        />
      ) : null}

      <form action={formAction} noValidate className="space-y-4">
        <input type="hidden" name="userId" value={user.userId} />

        <SelectField
          name="branchId"
          label="Branch"
          required
          defaultValue={user.branchId ?? ""}
          disabled={!canAssign || inactive}
          placeholder="Select a branch"
          options={branches.map((branch) => ({
            value: branch.branchId,
            label: branch.name,
          }))}
          errors={state.errors?.branchId}
          hint="Past collections and assignments keep the branch they were recorded under."
        />

        <div>
          <Label htmlFor="reason">Reason</Label>
          <Input
            id="reason"
            name="reason"
            defaultValue=""
            disabled={!canAssign || inactive}
            hint={
              state.errors?.reason?.[0] ??
              "Recorded in the audit trail alongside the old and new branch."
            }
          />
        </div>

        {canAssign && !inactive ? (
          <div className="flex justify-end">
            <SaveButton />
          </div>
        ) : null}
      </form>
    </div>
  );
}
