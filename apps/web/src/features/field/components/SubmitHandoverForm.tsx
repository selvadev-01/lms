"use client";

import { Alert } from "@lms/ui";
import { useActionState } from "react";

import { Field, SubmitButton } from "@/components/form/FormFields";

import {
  submitCashHandoverAction,
  type CashHandoverFormState,
} from "../actions/cash-handover-actions";

/**
 * Submit a draft handover for the branch to receive.
 *
 * Carries no amount. The balance check and the custody claim must run against
 * one number, and letting the figure change here would mean one gate ran
 * against one number and the claim against another.
 */
export default function SubmitHandoverForm({
  handoverId,
  version,
}: {
  handoverId: string;
  version: string;
}) {
  const [state, formAction] = useActionState<CashHandoverFormState, FormData>(
    submitCashHandoverAction,
    {},
  );

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <input type="hidden" name="handoverId" value={handoverId} />
      <input type="hidden" name="expectedVersion" value={version} />

      <h3 className="text-sm font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
        Submit to branch
      </h3>

      {state.message ? (
        <Alert
          variant="error"
          title="Could not submit"
          message={state.message}
        />
      ) : null}
      {state.success ? (
        <Alert variant="success" title="Submitted" message={state.success} />
      ) : null}

      <Field
        name="acknowledgmentReference"
        label="Acknowledgment reference"
        errors={state.errors?.acknowledgmentReference}
        hint="Optional. A slip number or whatever the branch records."
      />

      <SubmitButton label="Submit handover" pendingLabel="Submitting…" />
    </form>
  );
}
