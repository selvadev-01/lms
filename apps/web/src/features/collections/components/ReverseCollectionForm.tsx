"use client";

import { Alert } from "@lms/ui";
import { useActionState } from "react";

import { SubmitButton, TextAreaField } from "@/components/form/FormFields";

import {
  reverseCollectionAction,
  type CollectionFormState,
} from "../actions/collection-actions";

/**
 * Reverse a posted collection (Scenarios 31, 32).
 *
 * Rendered only for a caller holding `collections.reverse`, which a Branch
 * Admin does not — but that gating is presentation. The API refuses regardless,
 * which is what Scenario 36 actually asserts.
 *
 * `expectedVersion` rides along: if the collection moved on between this page
 * loading and the submit — someone else reversed it — the server refuses rather
 * than reversing something that has already changed (Scenario 26).
 *
 * The reason is required and free text rather than a picklist. The source names
 * no reason list (Open Question 27), and inventing one would either constrain
 * an operator to a wrong option or grow a catch-all "Other" that carries no
 * information.
 */
export default function ReverseCollectionForm({
  collectionId,
  expectedVersion,
}: {
  collectionId: string;
  expectedVersion: string;
}) {
  const [state, formAction] = useActionState<CollectionFormState, FormData>(
    reverseCollectionAction,
    {},
  );

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800"
    >
      <input type="hidden" name="collectionId" value={collectionId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />

      <h2 className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
        Reverse this collection
      </h2>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        The original record and its ledger entry are preserved. A reversing
        entry is posted against them and the borrower&rsquo;s obligation is
        re-opened.
      </p>

      {state.message && (
        <Alert
          variant="error"
          title="Could not reverse"
          message={state.message}
        />
      )}

      {state.success && (
        <Alert variant="success" title="Reversed" message={state.success} />
      )}

      <div className="mt-4 space-y-4">
        <TextAreaField
          name="reversalReason"
          label="Reversal Reason"
          required
          maxLength={1000}
          errors={state.errors?.reversalReason}
        />

        <SubmitButton
          label="Reverse collection"
          pendingLabel="Reversing…"
          variant="outline"
        />
      </div>
    </form>
  );
}
