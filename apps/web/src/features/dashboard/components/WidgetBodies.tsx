import Link from "next/link";
import type {
  CashSummaryWidget,
  CollectionSummaryWidget,
  LoanSummaryWidget,
  OperationalAlertsWidget,
  OverdueRecoveryWidget,
  QuickActionsWidget,
  RecentActivityWidget,
} from "@lms/types";

import { formatBps, formatDate, formatPaise } from "@/lib/format";
import { Metric } from "./WidgetShell";

/**
 * The seven widget bodies.
 *
 * Presentation only. Every value arrives computed — paise as an integer string,
 * ratios as basis points — and is formatted here and nowhere else. Nothing on
 * this page adds two numbers together.
 *
 * `formatPaise` parses with `BigInt` and returns the raw string unchanged if it
 * cannot, rather than a plausible `0.00`. That matters more here than on a
 * detail screen: a dashboard is scanned rather than read, and a wrong figure
 * that looks right is the one a reader will not catch.
 */

const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3";

export function LoanSummaryBody({ data }: { data: LoanSummaryWidget }) {
  return (
    <dl className={GRID}>
      <Metric
        label="Total outstanding"
        value={formatPaise(data.totalOutstandingPaise)}
        emphasis
      />
      <Metric label="Active loans" value={data.activeLoans} emphasis />
      <Metric label="Overdue loans" value={data.overdueLoans} emphasis />
      <Metric label="Applications" value={data.totalApplications} />
      <Metric label="Pending approval" value={data.pendingApproval} />
      <Metric label="Approved" value={data.approved} />
      <Metric label="Closed loans" value={data.closedLoans} />
    </dl>
  );
}

export function CollectionSummaryBody({
  data,
}: {
  data: CollectionSummaryWidget;
}) {
  return (
    <dl className={GRID}>
      <Metric
        label="Collected"
        value={formatPaise(data.collectedPaise)}
        emphasis
      />
      <Metric label="Due" value={formatPaise(data.duePaise)} emphasis />
      {/* The rate is display-only. Both components stay on screen beside it so
          the figure can be checked rather than trusted. */}
      <Metric
        label="Collection rate"
        value={formatBps(data.collectionRateBps)}
        emphasis
      />
      <Metric label="Pending" value={formatPaise(data.pendingPaise)} />
      <Metric
        label="Collected in field"
        value={formatPaise(data.fieldCollectedPaise)}
      />
    </dl>
  );
}

export function OverdueRecoveryBody({ data }: { data: OverdueRecoveryWidget }) {
  return (
    <dl className={GRID}>
      <Metric label="Overdue accounts" value={data.overdueAccounts} emphasis />
      <Metric
        label="Overdue amount"
        value={formatPaise(data.overdueAmountPaise)}
        emphasis
      />
      <Metric
        label="Penalty outstanding"
        value={formatPaise(data.penaltyOutstandingPaise)}
        emphasis
      />
      <Metric label="Escalated to field" value={data.escalatedToField} />
      <Metric label="Pending branch review" value={data.pendingBranchReview} />
      {/* Null when the reader may not see legal cases. `Metric` renders that
          as an em dash, which is distinct from a zero. */}
      <Metric label="Legal / settlement" value={data.legalCases} />
    </dl>
  );
}

export function CashSummaryBody({ data }: { data: CashSummaryWidget }) {
  return (
    <dl className={GRID}>
      <Metric label="Cash in" value={formatPaise(data.cashInPaise)} emphasis />
      <Metric
        label="Cash out"
        value={formatPaise(data.cashOutPaise)}
        emphasis
      />
      <Metric
        label="Expected closing"
        value={formatPaise(data.expectedClosingPaise)}
        emphasis
      />
      {/* Null until someone has physically counted. An em dash says nobody has
          looked; a zero would claim an empty cash box. */}
      <Metric
        label="Counted"
        value={
          data.actualCashPaise === null
            ? null
            : formatPaise(data.actualCashPaise)
        }
      />
      <Metric
        label="Difference"
        value={
          data.differencePaise === null
            ? null
            : formatPaise(data.differencePaise)
        }
      />
      <Metric label="Day closing" value={data.dayClosingStatus} />
    </dl>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL:
    "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10",
  WARNING:
    "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
  INFO: "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-white/[0.03]",
};

export function OperationalAlertsBody({
  data,
}: {
  data: OperationalAlertsWidget;
}) {
  return (
    <ul className="space-y-2">
      {data.alerts.map((alert) => (
        <li key={alert.alertType}>
          {/* Each alert links into the owning workflow. Resolving one happens
              there, never here (Rule 27). */}
          <Link
            href={alert.href}
            className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${
              SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.INFO
            }`}
          >
            <span className="text-sm text-gray-800 dark:text-white/90">
              {alert.label}
            </span>
            <span className="shrink-0 text-sm font-semibold text-gray-800 dark:text-white/90">
              {alert.count}
              {alert.amountPaise ? (
                <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                  {formatPaise(alert.amountPaise)}
                </span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function QuickActionsBody({ data }: { data: QuickActionsWidget }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {data.actions.map((action) => (
        <li key={action.code}>
          {/* A link, and only a link. The destination performs every check —
              validation, approval, idempotency, branch scope (Rule 25). */}
          <Link
            href={action.href}
            className="inline-block rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          >
            {action.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RecentActivityBody({ data }: { data: RecentActivityWidget }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead>
          <tr className="text-xs text-gray-500 dark:text-gray-400">
            <th className="pb-2 font-medium">When</th>
            <th className="pb-2 font-medium">Who</th>
            <th className="pb-2 font-medium">Action</th>
            <th className="pb-2 font-medium">Entity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {data.items.map((item) => (
            <tr key={item.auditId}>
              <td className="py-2 text-gray-500 dark:text-gray-400">
                {formatDate(item.occurredAt)}
              </td>
              {/* Null when the actor was the system rather than a person, or
                  when the reader may not see the name. */}
              <td className="py-2 text-gray-800 dark:text-white/90">
                {item.actorName ?? "System"}
              </td>
              <td className="py-2 text-gray-800 dark:text-white/90">
                {item.action}
              </td>
              <td className="py-2 text-gray-500 dark:text-gray-400">
                {item.entityType}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
