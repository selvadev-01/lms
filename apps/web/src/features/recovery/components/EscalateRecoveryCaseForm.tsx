"use client";

import { Alert } from "@lms/ui";
import { useActionState } from "react";

import { SubmitButton, TextAreaField } from "@/components/form/FormFields";
import { escalateRecoveryCaseAction } from "../actions/recovery-actions";

/**
 * Escalating an unresolved case.
 *
 * The reason is required rather than optional: Scenario 38 requires the
 * escalation event *and its reason* be recorded, and an optional field is one
 * nobody fills in.
 *
 * Escalation also raises the priority a step and freezes an action row
 * recording it, so the prior recovery history is preserved rather than
 * rewritten.
 */
export default function EscalateRecoveryCaseForm({
  recoveryCaseId,
  version,
}: {
  recoveryCaseId: string;
  version: string;
}) {
  const [state, formAction] = useActionState(escalateRecoveryCaseAction, {});

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
        Escalate case
      </h3>

      <input type="hidden" name="recoveryCaseId" value={recoveryCaseId} />
      <input type="hidden" name="expectedVersion" value={version} />

      {state.message ? (
        <div className="mt-4">
          <Alert
            variant="error"
            title="Not escalated"
            message={state.message}
          />
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-4">
          <Alert variant="success" title="Escalated" message={state.success} />
        </div>
      ) : null}

      <div className="mt-4">
        <TextAreaField
          name="reason"
          label="Escalation Reason"
          errors={state.errors?.reason}
          required
          maxLength={2000}
        />
      </div>

      <div className="mt-5">
        <SubmitButton label="Escalate" pendingLabel="Escalating…" />
      </div>
    </form>
  );
}
