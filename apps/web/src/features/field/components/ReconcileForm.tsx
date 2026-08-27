"use client";

import type { CashHandoverSummary } from "@lms/types";
import { Alert } from "@lms/ui";
import { useActionState, useState } from "react";

import {
  Field,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form/FormFields";
import {
  paiseToRupees,
  rupeesToPaise,
} from "@/features/loans/components/FormParts";
import { formatPaise } from "@/lib/format";

import {
  createReconciliationAction,
  type ReconciliationFormState,
} from "../actions/cash-reconciliation-actions";

/**
 * Count the cash against a received handover (Scenarios 26-28).
 *
 * The expected side is **not** an input. It is copied server-side from what the
 * branch recorded receiving; a client-supplied expectation would make the
 * reconciliation circular — the system checking the client's number against the
 * client's number.
 *
 * The counted amount is not pre-filled, for the reason `ReceiveCashForm`
 * documents: a pre-filled figure is one people confirm without counting.
 */
export default function ReconcileForm({
  handovers,
}: {
  handovers: CashHandoverSummary[];
}) {
  const [state, formAction] = useActionState<ReconciliationFormState, FormData>(
    createReconciliationAction,
    {},
  );

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [handoverId, setHandoverId] = useState("");
  const [rupees, setRupees] = useState("");

  const actualPaise = rupeesToPaise(rupees);
  const selected = handovers.find((row) => row.handoverId === handoverId);
  const expectedPaise = selected?.receivedCashPaise ?? null;

  const differs =
    expectedPaise !== null &&
    actualPaise !== "" &&
    actualPaise !== expectedPaise;

  if (handovers.length === 0) {
    return (
      <Alert
        variant="info"
        title="Nothing to reconcile"
        message="No received handover is waiting to be counted."
      />
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="actualCashPaise" value={actualPaise} />

      {state.message ? (
        <Alert
          variant="error"
          title="Could not reconcile"
          message={state.message}
        />
      ) : null}

      {state.blockers?.map((blocker) => (
        <Alert
          key={blocker.key}
          variant="warning"
          title="Reconciliation refused"
          message={blocker.reason}
        />
      ))}

      <SelectField
        name="handoverId"
        label="Handover"
        required
        value={handoverId}
        onChange={setHandoverId}
        errors={state.errors?.handoverId}
        options={handovers.map((row) => ({
          value: row.handoverId,
          label: `${row.handoverNumber} · ${row.agentName ?? "Agent"} · ${formatPaise(row.receivedCashPaise ?? row.handedOverCashPaise)}`,
        }))}
      />

      {expectedPaise !== null ? (
        <div className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
          <p className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
            Branch recorded receiving
          </p>
          <p className="mt-1 text-xl font-semibold text-gray-800 tabular-nums dark:text-white/90">
            {formatPaise(expectedPaise)}
          </p>
          <button
            type="button"
            onClick={() => setRupees(paiseToRupees(expectedPaise))}
            className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          >
            Count matches
          </button>
        </div>
      ) : null}

      <Field
        name="amountRupees"
        label="Actual cash counted"
        required
        inputMode="decimal"
        value={rupees}
        onChange={setRupees}
        errors={state.errors?.actualCashPaise}
        hint="In rupees. Enter what you physically counted."
      />

      {differs ? (
        <Alert
          variant="warning"
          title="This will record a discrepancy"
          message="A difference is never absorbed silently. It will be recorded as pending and must be explained and resolved by an authorized approver."
        />
      ) : null}

      <TextAreaField name="notes" label="Notes" errors={state.errors?.notes} />

      <SubmitButton label="Record count" pendingLabel="Recording…" />
    </form>
  );
}
