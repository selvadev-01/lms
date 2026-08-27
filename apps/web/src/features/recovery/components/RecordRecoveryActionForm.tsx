"use client";

import {
  RECOVERY_ACTION_TYPE_OPTIONS,
  RECOVERY_OUTCOME_OPTIONS,
} from "@lms/validation";
import { Alert } from "@lms/ui";
import { useActionState, useState } from "react";

import {
  Field,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form/FormFields";
import { rupeesToPaise } from "@/features/loans/components/FormParts";
import { recordRecoveryActionAction } from "../actions/recovery-actions";

/**
 * Recording a contact, visit, follow-up or promise.
 *
 * Imports the action **directly** rather than through the feature barrel: the
 * barrel re-exports `import "server-only"` read modules, and pulling that into
 * a client bundle fails the build.
 *
 * # The promise is two fields or none
 *
 * The amount and the date are shown together and validated together — half a
 * promise cannot be followed up or checked against a payment, so it is not a
 * promise (Scenario 15). The rule is enforced in the zod schema, again in the
 * API service, and again as a database CHECK; this form only makes it obvious.
 *
 * # Recording a promise moves no money
 *
 * The note under the amount says so, because an operator typing a rupee figure
 * into a recovery screen could reasonably assume it were a payment. It is not:
 * a payment goes through EMI Collection (Rule 15).
 */
export default function RecordRecoveryActionForm({
  recoveryCaseId,
}: {
  recoveryCaseId: string;
}) {
  const [state, formAction] = useActionState(recordRecoveryActionAction, {});
  const [promiseRupees, setPromiseRupees] = useState("");

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
        Record activity
      </h3>

      <input type="hidden" name="recoveryCaseId" value={recoveryCaseId} />

      {state.message ? (
        <div className="mt-4">
          <Alert variant="error" title="Not recorded" message={state.message} />
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-4">
          <Alert variant="success" title="Recorded" message={state.success} />
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        <SelectField
          name="actionType"
          label="Action Type"
          options={RECOVERY_ACTION_TYPE_OPTIONS}
          errors={state.errors?.actionType}
          required
        />
        <Field
          name="actionDate"
          label="Action Date"
          type="date"
          errors={state.errors?.actionDate}
          required
        />
        <SelectField
          name="outcome"
          label="Outcome"
          options={RECOVERY_OUTCOME_OPTIONS}
          errors={state.errors?.outcome}
          required
        />
        <Field
          name="nextFollowUpDate"
          label="Next Follow-up Date"
          type="date"
          errors={state.errors?.nextFollowUpDate}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="promiseToPayDate"
            label="Promise-to-Pay Date"
            type="date"
            errors={state.errors?.promiseToPayDate}
            hint="Record the amount too, or neither."
          />
          <Field
            name="promiseRupees"
            label="Promise-to-Pay Amount (₹)"
            inputMode="decimal"
            value={promiseRupees}
            onChange={setPromiseRupees}
            errors={state.errors?.promiseToPayAmountPaise}
            hint="A promise records an intention. It reduces no balance."
          />
        </div>

        {/*
          Money crosses the wire as integer paise, converted from the visible
          rupee field. Never `value * 100` — `rupeesToPaise` parses the string
          so a fractional paisa cannot appear.
        */}
        <input
          type="hidden"
          name="promiseToPayAmountPaise"
          value={rupeesToPaise(promiseRupees)}
        />

        <Field
          name="customerAckReference"
          label="Customer Acknowledgment"
          errors={state.errors?.customerAckReference}
          maxLength={150}
        />
        <TextAreaField
          name="notes"
          label="Notes"
          errors={state.errors?.notes}
          maxLength={4000}
        />
      </div>

      <div className="mt-5">
        <SubmitButton label="Record activity" pendingLabel="Recording…" />
      </div>
    </form>
  );
}
