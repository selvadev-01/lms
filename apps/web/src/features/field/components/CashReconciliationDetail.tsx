import type { CashReconciliationDetail as CashReconciliationDetailData } from "@lms/types";
import { Alert } from "@lms/ui";
import Link from "next/link";
import {
  CASH_DISCREPANCY_RESOLUTION_OPTIONS,
  CASH_DISCREPANCY_TYPE_OPTIONS,
  labelFor,
} from "@lms/validation";

import { formatDate, formatPaise } from "@/lib/format";

import { DiscrepancyBadge, ReconciliationStatusBadge } from "./CashBadges";
import ResolveDiscrepancyForm from "./ResolveDiscrepancyForm";

export interface Capabilities {
  canResolve: boolean;
}

/**
 * One reconciliation in full (Scenario 5).
 *
 * The three counted figures are frozen: the append-only trigger permits only
 * the transition to RESOLVED and pins expected, actual and difference. What
 * this page shows is what was counted on the day, and resolving cannot change
 * it (Rule 36, Scenario 29).
 */
export default function CashReconciliationDetail({
  reconciliation,
  capabilities,
}: {
  reconciliation: CashReconciliationDetailData;
  capabilities: Capabilities;
}) {
  const pending = reconciliation.status === "DISCREPANCY_PENDING";
  const shortage = reconciliation.differencePaise.startsWith("-");

  return (
    <div className="space-y-6">
      {pending ? (
        <Alert
          variant="error"
          title={shortage ? "Cash shortage" : "Cash excess"}
          message={`${formatPaise(reconciliation.differencePaise)} is unaccounted for. It cannot be closed without a recorded cause and an authorized resolution.`}
        />
      ) : null}

      <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {reconciliation.reconciliationNumber}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {formatDate(reconciliation.businessDate)} ·{" "}
              {reconciliation.agentName ?? "Field agent"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ReconciliationStatusBadge status={reconciliation.status} />
            {reconciliation.discrepancyType ? (
              <DiscrepancyBadge type={reconciliation.discrepancyType} />
            ) : null}
          </div>
        </div>

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Expected">
            <span className="tabular-nums">
              {formatPaise(reconciliation.expectedCashPaise)}
            </span>
          </Detail>
          <Detail label="Counted">
            <span className="tabular-nums">
              {formatPaise(reconciliation.actualCashPaise)}
            </span>
          </Detail>
          <Detail label="Difference">
            <span
              className={
                reconciliation.differencePaise === "0"
                  ? "tabular-nums"
                  : "text-error-600 dark:text-error-400 font-medium tabular-nums"
              }
            >
              {formatPaise(reconciliation.differencePaise)}
            </span>
          </Detail>
          <Detail label="Handover">
            {reconciliation.handoverNumber ? (
              <Link
                href={`/field/cash-handovers/${reconciliation.handoverId}`}
                className="text-brand-600 dark:text-brand-400 hover:underline"
              >
                {reconciliation.handoverNumber}
              </Link>
            ) : (
              "—"
            )}
          </Detail>
        </dl>

        {reconciliation.notes ? (
          <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
            {reconciliation.notes}
          </p>
        ) : null}
      </section>

      {reconciliation.status === "RESOLVED" ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-4 text-sm font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
            Resolution
          </h3>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Cause">
              {reconciliation.discrepancyType
                ? labelFor(
                    CASH_DISCREPANCY_TYPE_OPTIONS,
                    reconciliation.discrepancyType,
                  )
                : "—"}
            </Detail>
            <Detail label="Action">
              {reconciliation.resolutionAction
                ? labelFor(
                    CASH_DISCREPANCY_RESOLUTION_OPTIONS,
                    reconciliation.resolutionAction,
                  )
                : "—"}
            </Detail>
            <Detail label="Resolved by">
              {reconciliation.resolvedByName ?? "—"}
            </Detail>
            <Detail label="Resolved at">
              {reconciliation.resolvedAt
                ? formatDate(reconciliation.resolvedAt)
                : "—"}
            </Detail>
            <Detail label="Journal reference">
              {/* Points at a Module 14 entry, where an adjustment was posted.
                  This module writes no journal of its own. */}
              {reconciliation.approvalReference ?? "None posted"}
            </Detail>
          </dl>
          {reconciliation.discrepancyReason ? (
            <p className="mt-5 text-sm text-gray-600 dark:text-gray-300">
              {reconciliation.discrepancyReason}
            </p>
          ) : null}
        </section>
      ) : null}

      {capabilities.canResolve && pending ? (
        <ResolveDiscrepancyForm
          reconciliationId={reconciliation.reconciliationId}
          version={reconciliation.version}
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
