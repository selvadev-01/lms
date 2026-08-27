import type { ReportDashboard } from "@lms/types";

import { formatDate, formatPaise } from "@/lib/format";

import { ReportMetaLine } from "./ReportFilters";

/**
 * The reporting dashboard.
 *
 * Four groups, rendered as four panels rather than one flat grid of twenty
 * numbers. The grouping is not decoration: the portfolio and delinquency
 * figures are as-of-now positions while the collection figures are bounded by
 * the selected range, and Rule 11 forbids a report from silently mixing two
 * date bases. Presenting them in one undifferentiated block is exactly that
 * mixing, done visually.
 *
 * Every KPI links to the report it summarises. Scenario 3 requires a drill-down
 * to apply the same organization, branch and permission scope and to reconcile
 * to the KPI definition — which it does here because the link goes to the same
 * server-rendered report the figure was computed from, not to a second query.
 */
export default function DashboardKpis({
  dashboard,
}: {
  dashboard: ReportDashboard;
}) {
  const { portfolio, collections, delinquency, recovery } = dashboard;

  return (
    <div className="space-y-6">
      <ReportMetaLine meta={dashboard.meta} />

      <KpiPanel
        title="Portfolio"
        caption="Positions as they stand now, not bounded by the selected dates."
        href="/reports/portfolio"
        items={[
          { label: "Active loans", value: String(portfolio.totalActiveLoans) },
          {
            label: "Outstanding principal",
            value: formatPaise(portfolio.totalOutstandingPrincipalPaise),
          },
          {
            label: "Total outstanding",
            value: formatPaise(portfolio.totalPortfolioOutstandingPaise),
          },
          { label: "Loans disbursed", value: String(portfolio.loansDisbursed) },
          {
            label: "Disbursed amount",
            value: formatPaise(portfolio.disbursedAmountPaise),
          },
        ]}
      />

      <KpiPanel
        title="Collections"
        caption="Bounded by the selected date range."
        href="/reports/collections"
        items={[
          {
            label: "Collection due",
            value: formatPaise(collections.collectionDuePaise),
          },
          {
            label: "Collection received",
            value: formatPaise(collections.collectionReceivedPaise),
          },
          {
            label: "Collection rate",
            // Basis points to a percentage at the very edge, so the ratio never
            // becomes a float anywhere it could be summed or compared.
            value: `${(Number(collections.collectionRateBps) / 100).toFixed(2)}%`,
          },
          {
            label: "Cash pending reconciliation",
            value: formatPaise(collections.cashPendingReconciliationPaise),
          },
          {
            label: "Reconciled",
            value: formatPaise(collections.reconciledAmountPaise),
          },
        ]}
      />

      <KpiPanel
        title="Delinquency"
        caption="Derived from the authoritative overdue position and today's business date."
        href="/reports/overdue-recovery"
        items={[
          {
            label: "Overdue accounts",
            value: String(delinquency.overdueAccounts),
          },
          {
            label: "Overdue amount",
            value: formatPaise(delinquency.overdueAmountPaise),
          },
          {
            label: "Oldest due date",
            // Rule 49: an absent date is not a zero. An em dash says "nothing
            // is overdue", which a blank cell would leave ambiguous.
            value: delinquency.oldestDueDate
              ? formatDate(delinquency.oldestDueDate)
              : "—",
          },
          {
            label: "NPA-eligible accounts",
            value: String(delinquency.npaCount),
          },
          {
            label: "NPA outstanding",
            value: formatPaise(delinquency.npaOutstandingPaise),
          },
        ]}
      />

      {delinquency.buckets.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
            Ageing buckets
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
                  <th className="px-4 py-2 font-medium">Bucket</th>
                  <th className="px-4 py-2 text-right font-medium">Accounts</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {delinquency.buckets.map((bucket) => (
                  <tr
                    key={bucket.bucket}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                  >
                    <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                      {bucket.bucket}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700 tabular-nums dark:text-gray-300">
                      {bucket.accounts}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700 tabular-nums dark:text-gray-300">
                      {formatPaise(bucket.amountPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <KpiPanel
        title="Recovery"
        caption="A promise to pay is recorded intent; it does not reduce what is owed."
        href="/reports/overdue-recovery"
        items={[
          { label: "Open cases", value: String(recovery.openCases) },
          { label: "Assigned cases", value: String(recovery.assignedCases) },
          {
            label: "Promised to pay",
            value: formatPaise(recovery.promiseToPayAmountPaise),
          },
          {
            label: "Recovered",
            value: formatPaise(recovery.recoveredAmountPaise),
          },
          { label: "Escalated cases", value: String(recovery.escalatedCases) },
        ]}
      />
    </div>
  );
}

function KpiPanel({
  title,
  caption,
  href,
  items,
}: {
  title: string;
  caption: string;
  href: string;
  items: { label: string; value: string }[];
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            {title}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{caption}</p>
        </div>
        <a
          href={href}
          className="text-brand-500 hover:text-brand-600 text-sm font-medium"
        >
          View report
        </a>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-xs text-gray-500 dark:text-gray-400">
              {item.label}
            </dt>
            <dd className="mt-1 text-lg font-semibold text-gray-800 tabular-nums dark:text-white/90">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
