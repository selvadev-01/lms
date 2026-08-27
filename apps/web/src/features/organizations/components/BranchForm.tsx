"use client";

import type { BranchDetail } from "@lms/types";
import { Alert, Badge, Button } from "@lms/ui";
import { RECORD_STATUS_OPTIONS } from "@lms/validation";
import React, { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { SelectField } from "@/components/form/FormFields";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import {
  createBranchAction,
  updateBranchAction,
  type BranchFormState,
} from "../actions/branch-actions";

function SaveButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" disabled={pending}>
      {pending
        ? mode === "create"
          ? "Creating…"
          : "Saving…"
        : mode === "create"
          ? "Create branch"
          : "Save changes"}
    </Button>
  );
}

export interface BranchFormProps {
  /** Absent when creating. */
  branch?: BranchDetail;
  canEdit: boolean;
}

/**
 * Branch add / edit.
 *
 * One component for both, because the fields are the same and the difference is
 * narrow: on edit, the branch code becomes read-only and status moves to the
 * list's activate/deactivate control. The code is fixed after creation because
 * it scopes the gapless receipt sequence — changing it would retroactively alter
 * what an already-issued receipt number refers to.
 */
export default function BranchForm({ branch, canEdit }: BranchFormProps) {
  const mode = branch ? "edit" : "create";

  const [state, formAction] = useActionState<BranchFormState, FormData>(
    branch ? updateBranchAction : createBranchAction,
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
        {branch ? (
          <input type="hidden" name="branchId" value={branch.branchId} />
        ) : null}

        <div>
          <Label htmlFor="code">
            Branch Code <span className="text-error-500">*</span>
          </Label>
          <Input
            id="code"
            name={branch ? undefined : "code"}
            defaultValue={branch?.code ?? ""}
            disabled={Boolean(branch) || !canEdit}
            error={Boolean(fieldError("code"))}
            hint={
              fieldError("code") ??
              (branch
                ? "The branch code is fixed after creation."
                : "Unique within your organization, e.g. BR004.")
            }
            aria-invalid={Boolean(fieldError("code"))}
          />
        </div>

        <div>
          <Label htmlFor="name">
            Branch Name <span className="text-error-500">*</span>
          </Label>
          <Input
            id="name"
            name="name"
            defaultValue={branch?.name ?? ""}
            disabled={!canEdit}
            error={Boolean(fieldError("name"))}
            hint={fieldError("name")}
            aria-invalid={Boolean(fieldError("name"))}
          />
        </div>

        <div>
          <Label htmlFor="addressLine1">
            Address <span className="text-error-500">*</span>
          </Label>
          <Input
            id="addressLine1"
            name="addressLine1"
            defaultValue={branch?.addressLine1 ?? ""}
            disabled={!canEdit}
            error={Boolean(fieldError("addressLine1"))}
            hint={fieldError("addressLine1")}
            aria-invalid={Boolean(fieldError("addressLine1"))}
          />
        </div>

        <div>
          <Label htmlFor="addressLine2">Address line 2</Label>
          <Input
            id="addressLine2"
            name="addressLine2"
            defaultValue={branch?.addressLine2 ?? ""}
            disabled={!canEdit}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <Label htmlFor="city">
              City <span className="text-error-500">*</span>
            </Label>
            <Input
              id="city"
              name="city"
              defaultValue={branch?.city ?? ""}
              disabled={!canEdit}
              error={Boolean(fieldError("city"))}
              hint={fieldError("city")}
            />
          </div>
          <div>
            <Label htmlFor="state">
              State <span className="text-error-500">*</span>
            </Label>
            <Input
              id="state"
              name="state"
              defaultValue={branch?.state ?? ""}
              disabled={!canEdit}
              error={Boolean(fieldError("state"))}
              hint={fieldError("state")}
            />
          </div>
          <div>
            <Label htmlFor="pincode">
              Pincode <span className="text-error-500">*</span>
            </Label>
            <Input
              id="pincode"
              name="pincode"
              defaultValue={branch?.pincode ?? ""}
              disabled={!canEdit}
              error={Boolean(fieldError("pincode"))}
              hint={fieldError("pincode")}
            />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="phone">Contact number</Label>
            <Input
              id="phone"
              name="phone"
              defaultValue={branch?.phone ?? ""}
              disabled={!canEdit}
              error={Boolean(fieldError("phone"))}
              hint={fieldError("phone")}
            />
          </div>
          <div>
            <Label htmlFor="contactEmail">Contact email</Label>
            <Input
              id="contactEmail"
              name="contactEmail"
              type="email"
              defaultValue={branch?.contactEmail ?? ""}
              disabled={!canEdit}
              error={Boolean(fieldError("contactEmail"))}
              hint={fieldError("contactEmail")}
            />
          </div>
        </div>

        {branch ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Status
            </span>
            <Badge color={branch.status === "INACTIVE" ? "light" : "success"}>
              {branch.status}
            </Badge>
            <span className="text-xs text-gray-400">
              Change this from Branch Management.
            </span>
          </div>
        ) : (
          <SelectField
            name="status"
            label="Branch Status"
            required
            defaultValue="ACTIVE"
            disabled={!canEdit}
            // No placeholder: a branch always has a status, and an empty first
            // option would offer "unset" as though it were a choice.
            placeholder=""
            options={RECORD_STATUS_OPTIONS}
          />
        )}

        {canEdit ? <SaveButton mode={mode} /> : null}
      </form>
    </div>
  );
}
