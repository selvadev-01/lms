"use client";

import type { DisbursalQueueItem } from "@lms/types";
import { Alert } from "@lms/ui";
import type { SelectOption } from "@lms/validation";
import { useActionState } from "react";

import { Field, SelectField, SubmitButton } from "@/components/form/FormFields";

import { formatDate, formatPaise } from "@/lib/format";
import {
  scheduleDisbursementAction,
  type DisbursementFormState,
} from "../actions/disbursement-actions";

/**
 * Scenario 5 — schedule a disbursement against a signed agreement.
 *
 * # The amount is displayed, not editable
 *
 * There is no amount input. The figure comes from the sanction letter
 * server-side, so an editable field would be a control whose value the server
 * ignores — worse than useless, because an operator who changed it would
 * reasonably believe they had changed something. It is shown read-only so the
 * operator can *verify* the figure, which is what Rule 6 actually asks for.
 *
 * The application's `version` rides along as `expectedVersion`: if the loan
 * moved on between this page loading and the submit — someone else scheduled
 * it, the customer withdrew — the server refuses rather than scheduling against
 * terms that no longer hold.
 */
export default function ScheduleDisbursementForm({
  loan,
  accounts,
  expectedVersion,
}: {
  loan: DisbursalQueueItem;
  accounts: SelectOption[];
  expectedVersion: string;
}) {
  const [state, formAction] = useActionState<DisbursementFormState, FormData>(
    scheduleDisbursementAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="applicationId" value={loan.applicationId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />

      {state.message && (
        <Alert
          variant="error"
          title="Could not schedule"
          message={state.message}
        />
      )}

      {state.blockers && state.blockers.length > 0 && (
        <Alert
          variant="warning"
          title="This loan cannot be disbursed yet"
          message={state.blockers.map((blocker) => blocker.reason).join(". ")}
        />
      )}

      <section className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
        <h3 className="mb-4 text-sm font-medium text-gray-800 dark:text-white/90">
          Loan summary
        </h3>

        <dl className="grid gap-4 sm:grid-cols-2">
          <Summary label="Application" value={loan.applicationNumber} />
          <Summary label="Customer" value={loan.customerName} />
          <Summary
            label="Sanctioned amount"
            value={formatPaise(loan.sanctionedAmountPaise)}
            hint="Taken from the sanction letter. This is the amount that will be disbursed."
          />
          <Summary
            label="Agreement signed"
            value={formatDate(loan.agreementSignedAt)}
          />
        </dl>
      </section>

      <section className="space-y-4 rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
        <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
          Disbursement schedule
        </h3>

        <Field
          name="disbursementDate"
          label="Disbursement Date"
          type="date"
          required
          errors={state.errors?.disbursementDate}
        />

        <SelectField
          name="disbursementAccountId"
          label="Disbursement Account"
          required
          options={accounts}
          placeholder="Select an account"
          errors={state.errors?.disbursementAccountId}
        />

        <Field
          name="notes"
          label="Notes"
          maxLength={1000}
          errors={state.errors?.notes}
          hint="Optional. Recorded against the schedule for later reference."
        />
      </section>

      <div className="flex items-center gap-3">
        <SubmitButton
          label="Schedule Disbursement"
          pendingLabel="Scheduling…"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Scheduling moves no money. You will record the transfer and confirm it
          in the next steps.
        </p>
      </div>
    </form>
  );
}

function Summary({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-sm font-medium text-gray-800 dark:text-white/90">
        {value}
      </dd>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
