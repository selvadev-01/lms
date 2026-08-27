"use client";

import type { CashHandoverReadiness } from "@lms/types";
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
  createCashHandoverAction,
  type CashHandoverFormState,
} from "../actions/cash-handover-actions";

/**
 * Draft a handover of the agent's own collected cash (Scenario 22).
 *
 * # Why the amount is chosen from a list rather than typed freely
 *
 * Cash leaves an agent's custody by whole collections being *claimed*, not by
 * an amount being subtracted — that is what makes two concurrent handovers
 * structurally unable to double-count the same rupees. The consequence is that
 * a handover must name the sum of some oldest-first prefix of the unclaimed
 * collections, and any other figure is refused.
 *
 * So the form offers exactly the valid amounts. A free-text field would let an
 * agent type a plausible figure and be refused for a reason that reads like a
 * bug. The rupee field stays editable for the operator who prefers typing, and
 * the buttons fill it.
 */
export default function CashHandoverForm({
  readiness,
}: {
  readiness: CashHandoverReadiness;
}) {
  const [state, formAction] = useActionState<CashHandoverFormState, FormData>(
    createCashHandoverAction,
    {},
  );

  // Minted once per MOUNT, never per submit. A key regenerated on retry would
  // make the retry look like a second handover and open a second transfer.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [rupees, setRupees] = useState("");

  const amountPaise = rupeesToPaise(rupees);

  if (!readiness.canHandOver) {
    return (
      <div className="space-y-3">
        {readiness.blockers.map((blocker) => (
          <Alert
            key={blocker.key}
            variant="warning"
            title="Cannot hand over cash"
            message={blocker.reason}
          />
        ))}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {/* The integer-paise digit string the API actually receives. Never
          `value * 100`: a float would round a paisa away silently. */}
      <input type="hidden" name="handedOverCashPaise" value={amountPaise} />

      {state.message ? (
        <Alert
          variant="error"
          title="Could not create the handover"
          message={state.message}
        />
      ) : null}

      {state.blockers?.map((blocker) => (
        <Alert
          key={blocker.key}
          variant="warning"
          title="Handover refused"
          message={blocker.reason}
        />
      ))}

      <div className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
        <p className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
          Cash you are holding
        </p>
        <p className="mt-1 text-2xl font-semibold text-gray-800 tabular-nums dark:text-white/90">
          {formatPaise(readiness.expectedCashPaise)}
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          Amounts you can hand over
        </p>
        <div className="flex flex-wrap gap-2">
          {(state.handoverableAmounts ?? readiness.handoverableAmounts).map(
            (amount) => (
              /*
                A plain <button type="button">, not the shared `Button`: that
                component renders a bare <button>, which defaults to
                type="submit" and would post the form instead of filling the
                field. Widening its props for this case would put a submit
                footgun on every other caller.
              */
              <button
                key={amount}
                type="button"
                onClick={() => setRupees(paiseToRupees(amount))}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 tabular-nums hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
              >
                {formatPaise(amount)}
              </button>
            ),
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          A handover covers whole collections, oldest first — so only these
          amounts are possible.
        </p>
      </div>

      <Field
        name="amountRupees"
        label="Cash handed over"
        required
        inputMode="decimal"
        value={rupees}
        onChange={setRupees}
        errors={state.errors?.handedOverCashPaise}
        hint="In rupees. Paise are allowed."
      />

      <TextAreaField name="notes" label="Notes" errors={state.errors?.notes} />

      <SubmitButton label="Create handover" pendingLabel="Creating…" />
    </form>
  );
}
