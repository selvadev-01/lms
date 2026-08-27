import type { CashHandoverDetail as CashHandoverDetailData } from "@lms/types";
import { Alert } from "@lms/ui";

import { formatDate, formatPaise } from "@/lib/format";

import { HandoverStatusBadge } from "./CashBadges";
import FieldCollectionList from "./FieldCollectionList";
import ReceiveCashForm from "./ReceiveCashForm";
import ReverseHandoverForm from "./ReverseHandoverForm";
import SubmitHandoverForm from "./SubmitHandoverForm";

export interface Capabilities {
  canSubmit: boolean;
  canReceive: boolean;
  canReverse: boolean;
}

/**
 * One cash handover in full (Scenario 4).
 *
 * The collections panel is the custody trail Rule 23 asks for, and it is a real
 * foreign key rather than a report: each row's `custodyHandoverId` points at
 * this handover. That is also why the amounts cannot disagree — the handover
 * total *is* the sum of those rows.
 *
 * Each action renders only when the caller holds the permission **and** the
 * handover is in the state that permits it. Authority is resolved on the server
 * and passed down; components never test permissions themselves.
 */
export default function CashHandoverDetail({
  handover,
  capabilities,
}: {
  handover: CashHandoverDetailData;
  capabilities: Capabilities;
}) {
  const settled =
    handover.status === "RECEIVED" || handover.status === "RECONCILED";
  const hasDifference = settled && handover.differencePaise !== "0";

  return (
    <div className="space-y-6">
      {hasDifference ? (
        <Alert
          variant="error"
          title="Counted amount differs from the declared amount"
          message={`The branch counted ${formatPaise(handover.receivedCashPaise ?? "0")} against a declared ${formatPaise(handover.handedOverCashPaise)}. Reconcile this handover to record why.`}
        />
      ) : null}

      {handover.status === "REVERSED" ? (
        <Alert
          variant="info"
          title="Handover reversed"
          message={`${handover.reversalReason ?? "This handover was reversed."} The cash is back in the agent's custody and the original ledger entry is preserved.`}
        />
      ) : null}

      <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {handover.handoverNumber}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {formatDate(handover.businessDate)} ·{" "}
              {handover.agentName ?? "Field agent"}
            </p>
          </div>
          <HandoverStatusBadge status={handover.status} />
        </div>

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Agent held">
            {/* The balance snapshotted at submit — evidence, not an input to
                any later decision. Every gate re-derives from posted
                collections inside its own transaction. */}
            <span className="tabular-nums">
              {formatPaise(handover.expectedCashPaise)}
            </span>
          </Detail>
          <Detail label="Declared">
            <span className="tabular-nums">
              {formatPaise(handover.handedOverCashPaise)}
            </span>
          </Detail>
          <Detail label="Counted">
            <span className="tabular-nums">
              {handover.receivedCashPaise
                ? formatPaise(handover.receivedCashPaise)
                : "—"}
            </span>
          </Detail>
          <Detail label="Difference">
            {settled ? (
              <span
                className={
                  hasDifference
                    ? "text-error-600 dark:text-error-400 font-medium tabular-nums"
                    : "tabular-nums"
                }
              >
                {formatPaise(handover.differencePaise)}
              </span>
            ) : (
              <span className="text-gray-400">Not counted</span>
            )}
          </Detail>
          <Detail label="Received by">{handover.receivedByName ?? "—"}</Detail>
          <Detail label="Received at">
            {handover.receivedAt ? formatDate(handover.receivedAt) : "—"}
          </Detail>
          <Detail label="Acknowledgment">
            {handover.acknowledgmentReference ?? "—"}
          </Detail>
          <Detail label="Journal entry">
            {handover.journalEntryId ? "Posted" : "—"}
          </Detail>
        </dl>

        {handover.notes ? (
          <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
            {handover.notes}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
          Cash in this handover ({handover.collections.length})
        </h3>
        <FieldCollectionList collections={handover.collections} />
      </section>

      {/* One action per state. A handover in CREATED can be submitted, one in
          SUBMITTED received, one in RECEIVED reversed — and never two at once,
          because the states are exclusive. */}
      {capabilities.canSubmit && handover.status === "CREATED" ? (
        <SubmitHandoverForm
          handoverId={handover.handoverId}
          version={handover.version}
        />
      ) : null}

      {capabilities.canReceive && handover.status === "SUBMITTED" ? (
        <ReceiveCashForm
          handoverId={handover.handoverId}
          declaredPaise={handover.handedOverCashPaise}
          version={handover.version}
        />
      ) : null}

      {capabilities.canReverse && handover.status === "RECEIVED" ? (
        <ReverseHandoverForm
          handoverId={handover.handoverId}
          version={handover.version}
        />
      ) : null}
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-gray-800 dark:text-white/90">
        {children}
      </dd>
    </div>
  );
}
