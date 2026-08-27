"use client";

import type {
  DisbursalReadiness,
  DisbursementDetail as DisbursementDetailType,
  LedgerEntryDetail,
  RepaymentScheduleDetail,
} from "@lms/types";
import { Alert } from "@lms/ui";
import {
  DISBURSEMENT_PAYMENT_MODE_OPTIONS,
  type SelectOption,
} from "@lms/validation";
import { useActionState, useState } from "react";

import { Field, SelectField, SubmitButton } from "@/components/form/FormFields";

import { formatBps, formatDate, formatPaise } from "@/lib/format";
import {
  cancelDisbursementAction,
  confirmDisbursementAction,
  markFailedAction,
  recordTransferAction,
  updateScheduleAction,
  type DisbursementFormState,
} from "../actions/disbursement-actions";
import {
  DisbursementStatusBadge,
  paymentModeLabel,
} from "./DisbursementBadges";
import LedgerPanel from "./LedgerPanel";
import RepaymentSchedulePanel from "./RepaymentSchedulePanel";

/**
 * What the caller may do here.
 *
 * Resolved server-side from the session's permissions and passed in, so this
 * component never decides authority for itself. Hiding a control the caller
 * lacks is a courtesy; the API refuses regardless, which is what Scenarios 29
 * and 30 actually assert.
 */
export interface Capabilities {
  canSchedule: boolean;
  canRecordTransfer: boolean;
  canConfirm: boolean;
  canCancel: boolean;
}

/**
 * The disbursement detail screen (Scenario 2).
 *
 * # One screen, three states
 *
 * Which panel is shown follows the disbursement's own status rather than a
 * wizard step, because an operator can arrive here at any point and because a
 * failed transfer sends the row backwards:
 *
 *   SCHEDULED  -> edit the schedule, or record the transfer
 *   PROCESSING -> confirm, or record that the transfer failed
 *   COMPLETED  -> the ledger and the repayment schedule, read-only
 *
 * # The idempotency key
 *
 * Minted once per mount with `useState(() => crypto.randomUUID())`, never per
 * submit. That distinction is the whole mechanism: a key regenerated on retry
 * would make a retried confirmation a *second* confirmation, which is exactly
 * what Scenarios 28 and 46 exist to prevent. The initializer form matters too —
 * `useState(crypto.randomUUID())` would call it on every render and only
 * discard the result, which works but does real work for nothing.
 */
export default function DisbursementDetail({
  disbursement,
  readiness,
  ledger,
  schedule,
  accounts,
  capabilities,
}: {
  disbursement: DisbursementDetailType;
  readiness: DisbursalReadiness | null;
  ledger: LedgerEntryDetail | null;
  schedule: RepaymentScheduleDetail | null;
  accounts: SelectOption[];
  capabilities: Capabilities;
}) {
  const { status, version } = disbursement;

  const scheduled = status === "SCHEDULED";
  const processing = status === "PROCESSING";
  const completed = status === "COMPLETED";
  const cancelled = status === "CANCELLED";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">
            {disbursement.loanNumber}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {disbursement.customerName} · {disbursement.applicationNumber}
          </p>
        </div>
        <DisbursementStatusBadge status={status} />
      </header>

      {completed && (
        <Alert
          variant="success"
          title="Disbursed"
          message={`${formatPaise(disbursement.amountPaise)} disbursed on ${formatDate(disbursement.transferDate)}. The loan is active and the repayment schedule has been generated.`}
        />
      )}

      {cancelled && (
        <Alert
          variant="info"
          title="Cancelled"
          message={
            disbursement.failureReason ??
            "This disbursement was cancelled before any funds moved."
          }
        />
      )}

      {/* A prior failed attempt. Shown while the row is back at SCHEDULED so
          the operator knows why they are being asked to record a transfer
          again (Scenario 26). */}
      {scheduled && disbursement.failureReason && (
        <Alert
          variant="warning"
          title="Previous transfer failed"
          message={`${disbursement.failureReason} — no funds moved. Record a new transfer to retry.`}
        />
      )}

      <Summary disbursement={disbursement} />

      {/* Advisory only. The confirm endpoint re-runs every one of these gates
          inside its own transaction (Scenarios 36, 41, 42). */}
      {readiness && !readiness.confirmable && readiness.blockers.length > 0 && (
        <Alert
          variant="warning"
          title="Not ready to confirm"
          message={readiness.blockers.map((b) => b.reason).join(". ")}
        />
      )}

      {scheduled && capabilities.canSchedule && (
        <EditSchedulePanel
          disbursement={disbursement}
          accounts={accounts}
          version={version}
        />
      )}

      {scheduled && capabilities.canRecordTransfer && (
        <RecordTransferPanel disbursement={disbursement} version={version} />
      )}

      {processing && capabilities.canConfirm && (
        <ConfirmPanel disbursement={disbursement} version={version} />
      )}

      {processing && capabilities.canRecordTransfer && (
        <MarkFailedPanel disbursement={disbursement} version={version} />
      )}

      {/* Cancelling is only ever available before money moves (Rules 30, 31). */}
      {(scheduled || processing) && capabilities.canCancel && (
        <CancelPanel disbursement={disbursement} version={version} />
      )}

      {ledger && <LedgerPanel entry={ledger} />}
      {schedule && <RepaymentSchedulePanel schedule={schedule} />}
    </div>
  );
}

function Summary({ disbursement }: { disbursement: DisbursementDetailType }) {
  return (
    <section className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
      <h2 className="mb-4 text-sm font-medium text-gray-800 dark:text-white/90">
        Disbursement
      </h2>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Item
          label="Amount"
          value={formatPaise(disbursement.amountPaise)}
          emphasis
        />
        <Item
          label="Disbursement date"
          value={formatDate(disbursement.scheduledDate)}
        />
        <Item
          label="Account"
          value={`${disbursement.disbursementAccountName} (${disbursement.disbursementAccountCode})`}
          hint={
            disbursement.disbursementAccountStatus === "INACTIVE"
              ? "This account is inactive and cannot be used."
              : undefined
          }
        />
        <Item
          label="Transfer method"
          value={paymentModeLabel(disbursement.paymentMode)}
        />
        <Item
          label="Transaction reference"
          value={disbursement.transactionReference ?? "—"}
        />
        <Item
          label="Transfer date"
          value={formatDate(disbursement.transferDate)}
        />
        <Item
          label="Interest"
          value={`${formatBps(disbursement.interestRateBps)} ${disbursement.interestType.toLowerCase()}`}
        />
        <Item
          label="Term"
          value={`${disbursement.durationCount} × ${disbursement.repaymentFrequency.toLowerCase()}`}
        />
        <Item
          label="Confirmed"
          value={
            disbursement.confirmedAt
              ? formatDate(disbursement.confirmedAt)
              : "Not yet"
          }
        />
      </dl>
    </section>
  );
}

function Item({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd
        className={
          emphasis
            ? "text-base font-semibold text-gray-800 tabular-nums dark:text-white/90"
            : "text-sm font-medium text-gray-800 dark:text-white/90"
        }
      >
        {value}
      </dd>
      {hint && <p className="mt-1 text-xs text-orange-500">{hint}</p>}
    </div>
  );
}

/** Scenarios 11, 12 — available only while the row is SCHEDULED. */
function EditSchedulePanel({
  disbursement,
  accounts,
  version,
}: {
  disbursement: DisbursementDetailType;
  accounts: SelectOption[];
  version: string;
}) {
  const [state, formAction] = useActionState<DisbursementFormState, FormData>(
    updateScheduleAction,
    {},
  );

  return (
    <Panel title="Edit schedule" state={state}>
      <form action={formAction} className="space-y-4">
        <input
          type="hidden"
          name="disbursementId"
          value={disbursement.disbursementId}
        />
        <input type="hidden" name="expectedVersion" value={version} />

        <Field
          name="disbursementDate"
          label="Disbursement Date"
          type="date"
          required
          defaultValue={disbursement.scheduledDate}
          errors={state.errors?.disbursementDate}
        />

        <SelectField
          name="disbursementAccountId"
          label="Disbursement Account"
          required
          options={accounts}
          defaultValue={disbursement.disbursementAccountId}
          errors={state.errors?.disbursementAccountId}
        />

        <SubmitButton
          label="Update Schedule"
          pendingLabel="Updating…"
          variant="outline"
        />
      </form>
    </Panel>
  );
}

/**
 * Scenarios 14-17 — record that the transfer was made.
 *
 * The amount is a read-only hidden field carrying the sanctioned figure. The
 * server compares it and refuses a mismatch (Scenario 6); sending it at all is
 * what lets a tampered client be *detected* rather than silently corrected.
 *
 * The reference input's `required` attribute follows the selected method in the
 * browser, and the server enforces the same rule independently — a browser
 * attribute is a convenience, never the check (Rule 11, Scenario 16).
 */
function RecordTransferPanel({
  disbursement,
  version,
}: {
  disbursement: DisbursementDetailType;
  version: string;
}) {
  const [state, formAction] = useActionState<DisbursementFormState, FormData>(
    recordTransferAction,
    {},
  );

  const [mode, setMode] = useState<string>(disbursement.paymentMode);
  const needsReference = mode === "BANK_TRANSFER" || mode === "UPI";

  return (
    <Panel title="Record fund transfer" state={state}>
      <form action={formAction} className="space-y-4">
        <input
          type="hidden"
          name="disbursementId"
          value={disbursement.disbursementId}
        />
        <input type="hidden" name="expectedVersion" value={version} />
        <input
          type="hidden"
          name="amountPaise"
          value={disbursement.amountPaise}
        />

        <p className="text-sm text-gray-600 dark:text-gray-300">
          Amount to transfer:{" "}
          <strong className="tabular-nums">
            {formatPaise(disbursement.amountPaise)}
          </strong>
        </p>

        <SelectField
          name="paymentMode"
          label="Transfer Method"
          required
          options={DISBURSEMENT_PAYMENT_MODE_OPTIONS}
          value={mode}
          onChange={setMode}
          errors={state.errors?.paymentMode}
        />

        <Field
          name="transactionReference"
          label="Transaction Reference"
          required={needsReference}
          maxLength={150}
          errors={state.errors?.transactionReference}
          hint={
            needsReference
              ? "Required for a bank transfer. Must be unique across the organization."
              : "Not required for a cash disbursement."
          }
        />

        <Field
          name="transferDate"
          label="Transfer Date"
          type="date"
          required
          errors={state.errors?.transferDate}
        />

        <SubmitButton label="Record Transfer" pendingLabel="Recording…" />
      </form>
    </Panel>
  );
}

/**
 * Scenarios 23, 27, 28 — the irreversible one.
 *
 * `SubmitButton` disables itself through `useFormStatus().pending` and reads
 * "Processing disbursement…" while in flight, which is Scenario 27 exactly. The
 * key below is what makes a duplicate submission that slips through anyway
 * harmless rather than a second money movement.
 */
function ConfirmPanel({
  disbursement,
  version,
}: {
  disbursement: DisbursementDetailType;
  version: string;
}) {
  const [state, formAction] = useActionState<DisbursementFormState, FormData>(
    confirmDisbursementAction,
    {},
  );

  // Once per mount, never per submit. See the class comment.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  return (
    <Panel title="Confirm disbursement" state={state} tone="emphasis">
      <form action={formAction} className="space-y-4">
        <input
          type="hidden"
          name="disbursementId"
          value={disbursement.disbursementId}
        />
        <input type="hidden" name="expectedVersion" value={version} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <dl className="grid gap-3 sm:grid-cols-2">
          <Item label="Customer" value={disbursement.customerName} />
          <Item label="Loan" value={disbursement.loanNumber} />
          <Item
            label="Amount"
            value={formatPaise(disbursement.amountPaise)}
            emphasis
          />
          <Item
            label="Method"
            value={paymentModeLabel(disbursement.paymentMode)}
          />
          <Item
            label="Reference"
            value={disbursement.transactionReference ?? "—"}
          />
        </dl>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Confirming posts the ledger entry, activates the loan and generates
          the repayment schedule. This cannot be undone — a correction requires
          a reversal entry.
        </p>

        <SubmitButton
          label="Confirm Disbursement"
          pendingLabel="Processing disbursement…"
        />
      </form>
    </Panel>
  );
}

/** Scenario 26 — the transfer failed. Retryable; no money moved. */
function MarkFailedPanel({
  disbursement,
  version,
}: {
  disbursement: DisbursementDetailType;
  version: string;
}) {
  const [state, formAction] = useActionState<DisbursementFormState, FormData>(
    markFailedAction,
    {},
  );

  return (
    <Panel title="Transfer failed" state={state}>
      <form action={formAction} className="space-y-4">
        <input
          type="hidden"
          name="disbursementId"
          value={disbursement.disbursementId}
        />
        <input type="hidden" name="expectedVersion" value={version} />

        <Field
          name="failureReason"
          label="Failure Reason"
          required
          maxLength={1000}
          errors={state.errors?.failureReason}
          hint="Recorded against the disbursement. The transfer can then be retried."
        />

        <SubmitButton
          label="Record Failure"
          pendingLabel="Recording…"
          variant="outline"
        />
      </form>
    </Panel>
  );
}

/** Scenarios 37, 38 — never a delete. */
function CancelPanel({
  disbursement,
  version,
}: {
  disbursement: DisbursementDetailType;
  version: string;
}) {
  const [state, formAction] = useActionState<DisbursementFormState, FormData>(
    cancelDisbursementAction,
    {},
  );

  return (
    <Panel title="Cancel disbursement" state={state}>
      <form action={formAction} className="space-y-4">
        <input
          type="hidden"
          name="disbursementId"
          value={disbursement.disbursementId}
        />
        <input type="hidden" name="expectedVersion" value={version} />

        <Field
          name="cancellationReason"
          label="Cancellation Reason"
          required
          maxLength={1000}
          errors={state.errors?.cancellationReason}
          hint="The record is kept and marked cancelled. It is never deleted."
        />

        <SubmitButton
          label="Cancel Disbursement"
          pendingLabel="Cancelling…"
          variant="outline"
        />
      </form>
    </Panel>
  );
}

function Panel({
  title,
  state,
  tone = "plain",
  children,
}: {
  title: string;
  state: DisbursementFormState;
  tone?: "plain" | "emphasis";
  children: React.ReactNode;
}) {
  return (
    <section
      className={
        tone === "emphasis"
          ? "border-brand-500/40 rounded-2xl border-2 p-5"
          : "rounded-2xl border border-gray-200 p-5 dark:border-gray-800"
      }
    >
      <h2 className="mb-4 text-sm font-medium text-gray-800 dark:text-white/90">
        {title}
      </h2>

      {state.message && (
        <div className="mb-4">
          <Alert
            variant="error"
            title="Could not complete"
            message={state.message}
          />
        </div>
      )}

      {state.blockers && state.blockers.length > 0 && (
        <div className="mb-4">
          <Alert
            variant="warning"
            title="Blocked"
            message={state.blockers.map((b) => b.reason).join(". ")}
          />
        </div>
      )}

      {state.success && (
        <div className="mb-4">
          <Alert variant="success" title="Done" message={state.success} />
        </div>
      )}

      {children}
    </section>
  );
}
