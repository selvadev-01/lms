"use client";

import type { OrganizationDetail } from "@lms/types";
import { Alert, Badge, Button } from "@lms/ui";
import React, { useActionState } from "react";
import { useFormStatus } from "react-dom";

import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import {
  updateOrganizationAction,
  type UpdateOrganizationState,
} from "../actions/update-organization.action";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}

export interface CompanySettingsFormProps {
  organization: OrganizationDetail;
  /** Whether the caller may edit, as opposed to only view. */
  canEdit: boolean;
}

/**
 * Company Settings — Org Info.
 *
 * The organization code is rendered read-only rather than omitted: it is what
 * every user types at sign-in, so an administrator needs to be able to read it
 * off this screen, but it is also the tenant's identity and is referenced by
 * history, so it is not editable. The API enforces that independently — the
 * field is absent from the DTO, so sending one is rejected rather than ignored.
 */
export default function CompanySettingsForm({
  organization,
  canEdit,
}: CompanySettingsFormProps) {
  const [state, formAction] = useActionState<UpdateOrganizationState, FormData>(
    updateOrganizationAction,
    {},
  );

  const inactive = organization.status === "INACTIVE";

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

      {inactive ? (
        <Alert
          variant="warning"
          title="This organization is inactive"
          message={
            organization.deactivationReason
              ? `New transactions are blocked. Reason: ${organization.deactivationReason}`
              : "New transactions are blocked. Existing records remain available."
          }
        />
      ) : null}

      <form action={formAction} noValidate className="space-y-5">
        <div>
          <Label htmlFor="orgCode">Organization Code</Label>
          <Input
            id="orgCode"
            name="orgCode"
            defaultValue={organization.code}
            disabled
            hint="The code your users type when signing in. It cannot be changed."
          />
        </div>

        <div>
          <Label htmlFor="name">
            Organization Name <span className="text-error-500">*</span>
          </Label>
          <Input
            id="name"
            name="name"
            defaultValue={organization.name}
            disabled={!canEdit}
            error={Boolean(state.errors?.name)}
            hint={state.errors?.name?.[0]}
            aria-invalid={Boolean(state.errors?.name)}
          />
        </div>

        <div>
          <Label htmlFor="legalName">Legal Name</Label>
          <Input
            id="legalName"
            name="legalName"
            defaultValue={organization.legalName ?? ""}
            disabled={!canEdit}
            error={Boolean(state.errors?.legalName)}
            hint={state.errors?.legalName?.[0]}
          />
        </div>

        <div>
          <Label htmlFor="timezone">Timezone</Label>
          <Input
            id="timezone"
            name="timezone"
            defaultValue={organization.timezone}
            disabled={!canEdit}
            error={Boolean(state.errors?.timezone)}
            hint={state.errors?.timezone?.[0]}
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Status
          </span>
          <Badge color={inactive ? "light" : "success"}>
            {organization.status}
          </Badge>
        </div>

        {canEdit ? <SaveButton /> : null}
      </form>
    </div>
  );
}
