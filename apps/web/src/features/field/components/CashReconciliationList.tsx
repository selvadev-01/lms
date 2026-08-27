import type { CashReconciliationSummary } from "@lms/types";
import Link from "next/link";

import { formatDate, formatPaise } from "@/lib/format";

import { DiscrepancyBadge, ReconciliationStatusBadge } from "./CashBadges";

/**
 * Reconciliations within the caller's branch (Scenario 5).
 *
 * A server component. Every column except the status is a number that was
 * counted once and frozen: the append-only trigger permits only the transition
 * to RESOLVED, so what this table shows for a closed row is what was actually
 * counted on the day (Scenario 29).
 */
export default function CashReconciliationList({
  reconciliations,
}: {
  reconciliations: CashReconciliationSummary[];
}) {
  if (reconciliations.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No reconciliations yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
            <th className="px-5 py-3 font-medium">Reconciliation</th>
            <th className="px-5 py-3 font-medium">Date</th>
            <th className="px-5 py-3 font-medium">Agent</th>
            <th className="px-5 py-3 text-right font-medium">Expected</th>
            <th className="px-5 py-3 text-right font-medium">Counted</th>
            <th className="px-5 py-3 text-right font-medium">Difference</th>
            <th className="px-5 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {reconciliations.map((row) => (
            <tr
              key={row.reconciliationId}
              className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
            >
              <td className="px-5 py-3">
                <Link
                  href={`/field/cash-reconciliation/${row.reconciliationId}`}
                  className="text-brand-600 dark:text-brand-400 font-medium hover:underline"
                >
                  {row.reconciliationNumber}
                </Link>
              </td>
              <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                {formatDate(row.businessDate)}
              </td>
              <td className="px-5 py-3 text-gray-800 dark:text-white/90">
                {row.agentName ?? "—"}
              </td>
              <td className="px-5 py-3 text-right text-gray-500 tabular-nums dark:text-gray-400">
                {formatPaise(row.expectedCashPaise)}
              </td>
              <td className="px-5 py-3 text-right text-gray-800 tabular-nums dark:text-white/90">
                {formatPaise(row.actualCashPaise)}
              </td>
              <td className="px-5 py-3 text-right tabular-nums">
                <span
                  className={
                    row.differencePaise === "0"
                      ? "text-gray-500 dark:text-gray-400"
                      : "text-error-600 dark:text-error-400 font-medium"
                  }
                >
                  {formatPaise(row.differencePaise)}
                </span>
              </td>
              <td className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ReconciliationStatusBadge status={row.status} />
                  {/* The type says *why* the count came out wrong, which is
                      what separates a counterfeit note from a theft. Rule 34
                      is the reason a bare difference is not enough. */}
                  {row.discrepancyType ? (
                    <DiscrepancyBadge type={row.discrepancyType} />
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
