"use client";

import { Alert } from "@lms/ui";
import { COLLECTION_VERIFICATION_DECISION_OPTIONS } from "@lms/validation";
import { useActionState, useState } from "react";

import {
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form/FormFields";

import {
  verifyCollectionAction,
  type FieldCollectionFormState,
} from "../actions/field-collection-actions";

/**
 * Confirm or reject a collection captured offline.
 *
 * Moves no money. A rejection records that the capture looks wrong; it does not
 * reverse the payment, because reversal is a separate permission and a separate
 * act. The copy says so, so a reviewer does not expect the money back.
 *
 * The reason is required for a rejection and optional for a confirmation — the
 * same rule the schema and the API enforce. Requiring a sentence for "it is
 * what it says it is" trains reviewers to type "ok".
 */
export default function VerifyCollectionForm({
  collectionId,
  version,
}: {
  collectionId: string;
  version: string;
}) {
  const [state, formAction] = useActionState<
    FieldCollectionFormState,
    FormData
  >(verifyCollectionAction, {});

  const [decision, setDecision] = useState("");
  const rejecting = decision === "REJECTED";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="collectionId" value={collectionId} />
      {/* The concurrency token. An operator acting on a screen another
          reviewer has already decided is refused rather than overwriting. */}
      <input type="hidden" name="expectedVersion" value={version} />

      {state.message ? (
        <Alert
          variant="error"
          title="Could not record the review"
          message={state.message}
        />
      ) : null}
      {state.success ? (
        <Alert
          variant="success"
          title="Review recorded"
          message={state.success}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="decision"
          label="Decision"
          required
          options={COLLECTION_VERIFICATION_DECISION_OPTIONS}
          value={decision}
          onChange={setDecision}
          errors={state.errors?.decision}
        />
      </div>

      <div>
        <TextAreaField
          name="verificationNotes"
          label="Reason"
          required={rejecting}
          errors={state.errors?.verificationNotes}
        />
        {/* Said above the button rather than after the fact: a reviewer who
            expects a rejection to claw the money back would stop looking for
            the reversal that actually does it. */}
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {rejecting
            ? "Required when rejecting. Rejecting records that the capture looks wrong — it does not reverse the payment."
            : "Optional."}
        </p>
      </div>

      <SubmitButton label="Record review" pendingLabel="Recording…" />
    </form>
  );
}
