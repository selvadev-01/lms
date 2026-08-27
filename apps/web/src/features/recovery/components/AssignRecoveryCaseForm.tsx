"use client";

import { Alert } from "@lms/ui";
import { useActionState } from "react";

import {
  Field,
  SubmitButton,
  TextAreaField,
} from "@/components/form/FormFields";
import { assignRecoveryCaseAction } from "../actions/recovery-actions";

/**
 * Assigning or reassigning a case.
 *
 * Imports the action **directly** rather than through the feature barrel: the
 * barrel re-exports `import "server-only"` read modules, and pulling that into
 * a client bundle fails the build.
 *
 * One form for both acts, because the act is identical — whether anyone held
 * the case before is a fact the server already knows, and the history row is
 * what makes the difference visible afterwards (Rule 25).
 *
 * `expectedVersion` is the case's `updatedAt`. Two users who both opened this
 * screen cannot both win: the second submit carries a version that has moved
 * and is refused with a message telling them to reload (Scenario 12).
 */
export default function AssignRecoveryCaseForm({
  recoveryCaseId,
  version,
  currentAssigneeId,
}: {
  recoveryCaseId: string;
  version: string;
  currentAssigneeId?: string;
}) {
  const [state, formAction] = useActionState(assignRecoveryCaseAction, {});

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
        {currentAssigneeId ? "Reassign case" : "Assign case"}
      </h3>

      <input type="hidden" name="recoveryCaseId" value={recoveryCaseId} />
      <input type="hidden" name="expectedVersion" value={version} />

      {state.message ? (
        <div className="mt-4">
          <Alert variant="error" title="Not assigned" message={state.message} />
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-4">
          <Alert variant="success" title="Assigned" message={state.success} />
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {/*
          A user id rather than a picker: the officer list is a Module 03
          surface and duplicating it here would mean a second place for the
          branch confinement to be got wrong. The API refuses an officer outside
          the branch, and refuses an inactive one (Scenario 11).
        */}
        <Field
          name="assigneeUserId"
          label="Recovery Officer (user id)"
          errors={state.errors?.assigneeUserId}
          required
          hint="An inactive officer cannot receive new assignments."
        />
        <TextAreaField
          name="reason"
          label="Reason"
          errors={state.errors?.reason}
          maxLength={500}
        />
      </div>

      <div className="mt-5">
        <SubmitButton
          label={currentAssigneeId ? "Reassign" : "Assign"}
          pendingLabel="Saving…"
        />
      </div>
    </form>
  );
}
