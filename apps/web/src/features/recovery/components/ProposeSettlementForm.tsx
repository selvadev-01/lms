"use client";

import { Alert } from "@lms/ui";
import { useActionState, useState } from "react";

import {
  Field,
  SubmitButton,
  TextAreaField,
} from "@/components/form/FormFields";
import { rupeesToPaise } from "@/features/loans/components/FormParts";
import { proposeSettlementAction } from "../actions/recovery-actions";

/**
 * Proposing a settlement.
 *
 * Imports the action **directly** rather than through the feature barrel: the
 * barrel re-exports `import "server-only"` read modules, and pulling that into
 * a client bundle fails the build.
 *
 * # Only the settled amount is asked for
 *
 * What is *forgiven* is derived server-side from the outstanding principal, so
 * the two halves always add to what was owed and the
 * `settlements_waiver_sums` CHECK can never be violated by a form. Asking for
 * both would let an operator propose a settlement whose figures do not
 * reconcile, and the refusal would arrive from the database rather than from
 * the screen.
 *
 * # Proposing commits nothing
 *
 * A proposal posts no ledger entry and forgives nothing — it awaits an approval
 * authority (Scenario 44). The note under the amount says so, because a rupee
 * figure on a recovery screen could otherwise read as money already given up.
 */
export default function ProposeSettlementForm({
  recoveryCaseId,
}: {
  recoveryCaseId: string;
}) {
  const [state, formAction] = useActionState(proposeSettlementAction, {});
  const [rupees, setRupees] = useState("");

  /**
   * Minted once per form *mount*, never per submit: a key regenerated on retry
   * defeats the mechanism, because the retry then looks like a second
   * settlement.
   */
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
        Propose settlement
      </h3>

      <input type="hidden" name="recoveryCaseId" value={recoveryCaseId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {state.message ? (
        <div className="mt-4">
          <Alert variant="error" title="Not proposed" message={state.message} />
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-4">
          <Alert variant="success" title="Proposed" message={state.success} />
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        <Field
          name="settlementRupees"
          label="Settlement Amount (₹)"
          inputMode="decimal"
          value={rupees}
          onChange={setRupees}
          errors={state.errors?.settlementAmountPaise}
          required
          hint="What the borrower will pay. The remainder is calculated and shown for approval."
        />

        {/*
          Money crosses the wire as integer paise, converted from the visible
          rupee field. Never `value * 100` — `rupeesToPaise` parses the string
          so a fractional paisa cannot appear.
        */}
        <input
          type="hidden"
          name="settlementAmountPaise"
          value={rupeesToPaise(rupees)}
        />

        <Field
          name="agreedDate"
          label="Agreed Date"
          type="date"
          errors={state.errors?.agreedDate}
          required
        />
        <TextAreaField
          name="reason"
          label="Reason"
          errors={state.errors?.reason}
          required
          maxLength={2000}
        />
      </div>

      <div className="mt-5">
        <SubmitButton label="Propose settlement" pendingLabel="Proposing…" />
      </div>
    </form>
  );
}
