"use client";

import { RECOVERY_RESOLUTION_TYPE_OPTIONS } from "@lms/validation";
import { Alert } from "@lms/ui";
import { useActionState } from "react";

import {
  Field,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form/FormFields";
import { closeRecoveryCaseAction } from "../actions/recovery-actions";

/**
 * Closing a case.
 *
 * Carries the resolution type and reason and **no money at all**. What was
 * outstanding, what was recovered and what remains are read from the loan
 * inside the closing transaction (Scenario 39) — a form that named them could
 * close a case against figures that were never true.
 *
 * Closure is refused while a settlement is unresolved or a legal notice is
 * active (Scenario 40). That refusal arrives as a blocker list and is rendered
 * below rather than collapsed into a generic failure, so the operator is told
 * what to fix instead of being left to guess.
 */
export default function CloseRecoveryCaseForm({
  recoveryCaseId,
  version,
}: {
  recoveryCaseId: string;
  version: string;
}) {
  const [state, formAction] = useActionState(closeRecoveryCaseAction, {});

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
        Close case
      </h3>

      <input type="hidden" name="recoveryCaseId" value={recoveryCaseId} />
      <input type="hidden" name="expectedVersion" value={version} />

      {state.message ? (
        <div className="mt-4">
          <Alert variant="error" title="Not closed" message={state.message} />
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-4">
          <Alert variant="success" title="Closed" message={state.success} />
        </div>
      ) : null}

      {state.blockers && state.blockers.length > 0 ? (
        <ul className="mt-4 space-y-1 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
          {state.blockers.map((blocker) => (
            <li
              key={blocker.key}
              className="text-sm text-gray-700 dark:text-gray-300"
            >
              {blocker.reason}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 space-y-4">
        <SelectField
          name="resolutionType"
          label="Resolution"
          options={RECOVERY_RESOLUTION_TYPE_OPTIONS}
          errors={state.errors?.resolutionType}
          required
        />
        <TextAreaField
          name="closureReason"
          label="Closure Reason"
          errors={state.errors?.closureReason}
          required
          maxLength={2000}
        />
        <Field
          name="approvalReference"
          label="Approval Reference"
          errors={state.errors?.approvalReference}
          maxLength={150}
        />
      </div>

      <div className="mt-5">
        <SubmitButton label="Close case" pendingLabel="Closing…" />
      </div>
    </form>
  );
}
