"use client";

import { Alert } from "@lms/ui";
import { useActionState, useState } from "react";

// No `SubmitButton` here: it wraps the shared `Button`, which takes no
// `disabled`, and this is the one form in the module that must refuse to submit
// until the confirmation is typed. See the button at the foot of the form.
import { Field, TextAreaField } from "@/components/form/FormFields";
import { writeOffLoanAction } from "../actions/recovery-actions";

/**
 * Writing the loan off.
 *
 * The most irreversible act in the module: it posts the loss to the ledger,
 * moves the loan to WRITTEN_OFF and closes the case. Behind a permission the
 * seed grants to **no role**, so reaching this form at all is a deliberate
 * configuration choice (Scenario 43).
 *
 * # Three things this form deliberately does not do
 *
 * **It asks for no amount.** What is written off is the outstanding principal,
 * read inside the posting transaction. A form that named the figure could
 * abandon more or less than the borrower actually owes.
 *
 * **It offers no undo.** There is none: the ledger is append-only (Rule 32) and
 * a correction is a reversing entry authored in Module 14, not an edit here.
 * The warning says so rather than implying the action is recoverable.
 *
 * **It requires typing the confirmation.** A single click is the wrong
 * affordance for an act that cannot be taken back, and this is the only form in
 * the module that guards itself this way. The check is presentational — the
 * server's permission, version and lifecycle gates are the real boundary — but
 * a mis-click is a failure mode those gates cannot distinguish from intent.
 */
export default function WriteOffLoanForm({
  recoveryCaseId,
  version,
}: {
  recoveryCaseId: string;
  version: string;
}) {
  const [state, formAction] = useActionState(writeOffLoanAction, {});
  const [confirmation, setConfirmation] = useState("");

  /** Minted once per form mount, never per submit. */
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const confirmed = confirmation.trim().toUpperCase() === "WRITE OFF";

  return (
    <form
      action={formAction}
      className="border-error-200 dark:border-error-800 rounded-2xl border bg-white p-5 lg:p-6 dark:bg-white/[0.03]"
    >
      <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
        Write off loan
      </h3>

      <input type="hidden" name="recoveryCaseId" value={recoveryCaseId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <div className="mt-4" role="alert">
        <Alert
          variant="error"
          title="This cannot be undone"
          message="Writing off posts the unrecovered principal as a loss, moves the loan to WRITTEN_OFF and closes this case. The ledger is append-only — correcting a write-off means authoring a reversing journal entry, not editing this one."
        />
      </div>

      {state.message ? (
        <div className="mt-4">
          <Alert
            variant="error"
            title="Not written off"
            message={state.message}
          />
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-4">
          <Alert
            variant="success"
            title="Written off"
            message={state.success}
          />
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        <TextAreaField
          name="reason"
          label="Write-off Reason"
          errors={state.errors?.reason}
          required
          maxLength={2000}
        />
        <Field
          name="approvalReference"
          label="Approval Reference"
          errors={state.errors?.approvalReference}
          maxLength={150}
        />
        <Field
          name="writeOffConfirmation"
          label="Type WRITE OFF to confirm"
          value={confirmation}
          onChange={setConfirmation}
          hint="A deliberate step, because this action has no undo."
        />
      </div>

      <div className="mt-5">
        {/*
          `SubmitButton` wraps the shared `Button`, which has no `disabled`
          passthrough — so the guard is a plain native button here rather than a
          styled one that looks enabled while refusing to act.
        */}
        <button
          type="submit"
          disabled={!confirmed}
          className="bg-error-500 hover:bg-error-600 inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
        >
          Write off loan
        </button>
      </div>
    </form>
  );
}
