"use client";

import { Alert } from "@lms/ui";
import { useActionState } from "react";

import { SubmitButton, TextAreaField } from "@/components/form/FormFields";

import {
  reverseCashHandoverAction,
  type CashHandoverFormState,
} from "../actions/cash-handover-actions";

/**
 * Reverse a received handover.
 *
 * Behind its own permission, which a Branch Admin does not hold: this unwinds a
 * committed custody journal and moves cash back out of the branch's books.
 *
 * Rendered inside a bordered "danger" panel rather than beside the ordinary
 * actions, because it is the one control on this page that undoes a posting
 * somebody else made.
 */
export default function ReverseHandoverForm({
  handoverId,
  version,
}: {
  handoverId: string;
  version: string;
}) {
  const [state, formAction] = useActionState<CashHandoverFormState, FormData>(
    reverseCashHandoverAction,
    {},
  );

  return (
    <form
      action={formAction}
      className="border-error-200 dark:border-error-800/60 space-y-4 rounded-2xl border bg-white p-5 lg:p-6 dark:bg-white/[0.03]"
    >
      <input type="hidden" name="handoverId" value={handoverId} />
      {/* The concurrency token. An operator acting on a stale screen is
          refused rather than reversing a handover that has since changed. */}
      <input type="hidden" name="expectedVersion" value={version} />

      <div>
        <h3 className="text-error-600 dark:text-error-400 text-sm font-semibold tracking-wide uppercase">
          Reverse handover
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Returns the cash to the agent&apos;s custody and posts an opposite
          ledger entry. The original entry is preserved; nothing is edited or
          deleted.
        </p>
      </div>

      {state.message ? (
        <Alert
          variant="error"
          title="Could not reverse"
          message={state.message}
        />
      ) : null}
      {state.success ? (
        <Alert variant="success" title="Reversed" message={state.success} />
      ) : null}

      <TextAreaField
        name="reversalReason"
        label="Reason"
        required
        errors={state.errors?.reversalReason}
        placeholder="Recorded permanently against both entries."
      />

      <SubmitButton
        label="Reverse handover"
        pendingLabel="Reversing…"
        variant="outline"
      />
    </form>
  );
}
