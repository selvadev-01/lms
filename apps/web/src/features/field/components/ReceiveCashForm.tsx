"use client";

import { Alert } from "@lms/ui";
import { useActionState, useState } from "react";

import {
  Field,
  SubmitButton,
  TextAreaField,
} from "@/components/form/FormFields";
import {
  paiseToRupees,
  rupeesToPaise,
} from "@/features/loans/components/FormParts";
import { formatPaise } from "@/lib/format";

import {
  receiveCashHandoverAction,
  type CashHandoverFormState,
} from "../actions/cash-handover-actions";

/**
 * Receive an agent's cash at the branch (Scenarios 23, 24).
 *
 * The act that posts the custody journal: `Dr Branch Cash / Cr Agent Cash`.
 *
 * # Why the counted amount is not pre-filled
 *
 * It would be one keystroke faster and it would defeat the control. The whole
 * point of recording a counted figure separately from the declared one is that
 * they can differ — a pre-filled field is a field people confirm without
 * counting, and the difference this screen exists to surface would silently
 * always be zero.
 *
 * The declared amount is shown, and a button fills the field for the ordinary
 * case where the count matches, so the honest path stays quick.
 */
export default function ReceiveCashForm({
  handoverId,
  declaredPaise,
  version,
}: {
  handoverId: string;
  declaredPaise: string;
  version: string;
}) {
  const [state, formAction] = useActionState<CashHandoverFormState, FormData>(
    receiveCashHandoverAction,
    {},
  );

  // Minted once per MOUNT. Sent as an Idempotency-Key header, because this acts
  // on a handover that already exists — a retry must be recognisable as one.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [rupees, setRupees] = useState("");

  const receivedPaise = rupeesToPaise(rupees);

  const differs = receivedPaise !== "" && receivedPaise !== declaredPaise;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="handoverId" value={handoverId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="receivedCashPaise" value={receivedPaise} />

      {state.message ? (
        <Alert
          variant="error"
          title="Could not receive the cash"
          message={state.message}
        />
      ) : null}
      {state.success ? (
        <Alert
          variant="success"
          title="Cash received"
          message={state.success}
        />
      ) : null}

      <div className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
        <p className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
          Agent declared
        </p>
        <p className="mt-1 text-xl font-semibold text-gray-800 tabular-nums dark:text-white/90">
          {formatPaise(declaredPaise)}
        </p>
        <button
          type="button"
          onClick={() => setRupees(paiseToRupees(declaredPaise))}
          className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
        >
          Count matches
        </button>
      </div>

      <Field
        name="amountRupees"
        label="Cash counted"
        required
        inputMode="decimal"
        value={rupees}
        onChange={setRupees}
        errors={state.errors?.receivedCashPaise}
        hint="Enter what you actually counted, in rupees."
      />

      {/* Warned about before submitting, not after. A difference is not
          refused — it is recorded and reconciled (Rule 34) — but it should
          never be entered by accident. */}
      {differs ? (
        <Alert
          variant="warning"
          title="This does not match the declared amount"
          message="Receiving will record the difference. It must then be reconciled and explained before it can be closed."
        />
      ) : null}

      <TextAreaField name="notes" label="Notes" errors={state.errors?.notes} />

      <SubmitButton label="Receive cash" pendingLabel="Receiving…" />
    </form>
  );
}
