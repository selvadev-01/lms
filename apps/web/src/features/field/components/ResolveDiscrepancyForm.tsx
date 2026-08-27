"use client";

import { Alert } from "@lms/ui";
import {
  CASH_DISCREPANCY_RESOLUTION_OPTIONS,
  CASH_DISCREPANCY_TYPE_OPTIONS,
} from "@lms/validation";
import { useActionState } from "react";

import {
  Field,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form/FormFields";

import {
  resolveDiscrepancyAction,
  type ReconciliationFormState,
} from "../actions/cash-reconciliation-actions";

/**
 * Resolve a pending shortage or excess (Scenario 29).
 *
 * Behind its own permission, which a Branch Admin does not hold: deciding who
 * bears a loss is the approval authority's act, and a branch that could both
 * count the cash and forgive the difference would be an unreviewed control.
 *
 * # This form posts no journal
 *
 * It records what was decided. Where an accounting adjustment is needed, it is
 * posted separately through Module 14's manual journal and its entry number is
 * recorded here as the approval reference. The hint says so, because an
 * approver who expects this to move money would stop looking for the entry that
 * actually does.
 */
export default function ResolveDiscrepancyForm({
  reconciliationId,
  version,
}: {
  reconciliationId: string;
  version: string;
}) {
  const [state, formAction] = useActionState<ReconciliationFormState, FormData>(
    resolveDiscrepancyAction,
    {},
  );

  return (
    <form
      action={formAction}
      className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <input type="hidden" name="reconciliationId" value={reconciliationId} />
      <input type="hidden" name="expectedVersion" value={version} />

      <div>
        <h3 className="text-sm font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
          Resolve discrepancy
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          The counted figures stay exactly as recorded. This records the cause
          and the decision.
        </p>
      </div>

      {state.message ? (
        <Alert
          variant="error"
          title="Could not resolve"
          message={state.message}
        />
      ) : null}
      {state.success ? (
        <Alert variant="success" title="Resolved" message={state.success} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="discrepancyType"
          label="Cause"
          required
          options={CASH_DISCREPANCY_TYPE_OPTIONS}
          errors={state.errors?.discrepancyType}
          hint="What made the count come out wrong."
        />
        <SelectField
          name="resolutionAction"
          label="Resolution"
          required
          options={CASH_DISCREPANCY_RESOLUTION_OPTIONS}
          errors={state.errors?.resolutionAction}
        />
      </div>

      <TextAreaField
        name="discrepancyReason"
        label="Reason"
        required
        errors={state.errors?.discrepancyReason}
        placeholder="Recorded permanently. Required for every discrepancy."
      />

      <Field
        name="approvalReference"
        label="Journal entry reference"
        errors={state.errors?.approvalReference}
        hint="Optional. If an accounting adjustment was posted in Finance, record its entry number here — this screen posts none itself."
      />

      <TextAreaField
        name="resolutionNotes"
        label="Notes"
        errors={state.errors?.resolutionNotes}
      />

      <SubmitButton label="Resolve" pendingLabel="Resolving…" />
    </form>
  );
}
