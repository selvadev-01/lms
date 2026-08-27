"use client";

import type { SettlementRecord } from "@lms/types";
import { Alert } from "@lms/ui";
import { useActionState } from "react";

import { Field, SubmitButton } from "@/components/form/FormFields";
import { formatPaise } from "@/lib/format";
import {
  completeSettlementAction,
  decideSettlementAction,
} from "../actions/recovery-actions";
import { SettlementStatusBadge } from "./RecoveryBadges";

/**
 * Deciding and completing a settlement.
 *
 * A separate authority from proposing (Scenario 44): the officer who agreed
 * terms with a borrower does not also approve forgiving the remainder.
 *
 * # Why approve and complete are two steps
 *
 * Approving authorises the waiver and posts nothing. **Completing** is the
 * moment value moves — the forgiven principal is recognised as a loss and the
 * receivable retired — because until the borrower has paid the settled portion
 * nothing has actually been given up. Collapsing them would post a loss against
 * a settlement the borrower might never honour.
 *
 * The settled portion itself is an ordinary repayment and goes through EMI
 * Collection (Rules 15, 16), which is why there is no payment field here.
 */
export default function SettlementDecisionForm({
  recoveryCaseId,
  settlement,
}: {
  recoveryCaseId: string;
  settlement: SettlementRecord;
}) {
  const [decideState, decideAction] = useActionState(
    decideSettlementAction,
    {},
  );
  const [completeState, completeAction] = useActionState(
    completeSettlementAction,
    {},
  );

  const awaitingDecision = settlement.status === "PENDING_APPROVAL";
  const awaitingCompletion = settlement.status === "APPROVED";

  // Nothing to do once it is completed, rejected or cancelled.
  if (!awaitingDecision && !awaitingCompletion) return null;

  const state = awaitingDecision ? decideState : completeState;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
          {awaitingDecision ? "Decide settlement" : "Complete settlement"}
        </h3>
        <SettlementStatusBadge status={settlement.status} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-theme-xs text-gray-500 dark:text-gray-400">
            Borrower pays
          </dt>
          <dd className="mt-1 text-sm font-medium text-gray-800 dark:text-white/90">
            {formatPaise(settlement.settlementAmountPaise)}
          </dd>
        </div>
        <div>
          <dt className="text-theme-xs text-gray-500 dark:text-gray-400">
            Forgiven
          </dt>
          {/*
            Derived server-side from the outstanding principal, so the two
            figures always add to what was owed. Shown here because it is the
            number the approver is actually deciding about.
          */}
          <dd className="mt-1 text-sm font-medium text-gray-800 dark:text-white/90">
            {settlement.waivedAmountPaise
              ? formatPaise(settlement.waivedAmountPaise)
              : "—"}
          </dd>
        </div>
      </dl>

      {state.message ? (
        <div className="mt-4">
          <Alert variant="error" title="Not applied" message={state.message} />
        </div>
      ) : null}
      {state.success ? (
        <div className="mt-4">
          <Alert variant="success" title="Applied" message={state.success} />
        </div>
      ) : null}

      {awaitingDecision ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {/*
            Two forms rather than one with a decision selector: approve and
            reject are different outcomes and a mis-selected dropdown is a
            worse failure than a mis-clicked button on a step that still
            requires an explicit completion afterwards.
          */}
          <form action={decideAction}>
            <input
              type="hidden"
              name="settlementId"
              value={settlement.settlementId}
            />
            <input type="hidden" name="recoveryCaseId" value={recoveryCaseId} />
            <input
              type="hidden"
              name="expectedVersion"
              value={settlement.version}
            />
            <input type="hidden" name="decision" value="APPROVE" />
            <Field
              name="approvalReference"
              label="Approval Reference"
              errors={decideState.errors?.approvalReference}
              maxLength={150}
            />
            <div className="mt-3">
              <SubmitButton label="Approve" pendingLabel="Approving…" />
            </div>
          </form>

          <form action={decideAction}>
            <input
              type="hidden"
              name="settlementId"
              value={settlement.settlementId}
            />
            <input type="hidden" name="recoveryCaseId" value={recoveryCaseId} />
            <input
              type="hidden"
              name="expectedVersion"
              value={settlement.version}
            />
            <input type="hidden" name="decision" value="REJECT" />
            <Field
              name="reason"
              label="Rejection Reason"
              errors={decideState.errors?.reason}
              maxLength={2000}
            />
            <div className="mt-3">
              <SubmitButton
                label="Reject"
                pendingLabel="Rejecting…"
                variant="outline"
              />
            </div>
          </form>
        </div>
      ) : (
        <form action={completeAction} className="mt-4">
          <input
            type="hidden"
            name="settlementId"
            value={settlement.settlementId}
          />
          <input type="hidden" name="recoveryCaseId" value={recoveryCaseId} />
          <input
            type="hidden"
            name="expectedVersion"
            value={settlement.version}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Completing posts the forgiven principal as a loss and retires the
            receivable. Do this once the borrower has paid the settled portion
            through EMI Collection.
          </p>
          <div className="mt-4">
            <SubmitButton
              label="Complete settlement"
              pendingLabel="Completing…"
            />
          </div>
        </form>
      )}
    </div>
  );
}
