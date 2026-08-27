import type { GeneralLedgerPage } from "@lms/types";

import { formatDate, formatPaise } from "@/lib/format";

import { normalBalanceLabel } from "./AccountingBadges";

/**
 * One account's postings, with its running balance.
 *
 * A server component. `runningBalancePaise` is computed server-side and carried
 * forward from the opening balance — a running total computed here would be
 * wrong on any page but the first, because a page of rows does not know what
 * came before it.
 */
export default function GeneralLedgerTable({
  ledger,
}: {
  ledger: GeneralLedgerPage;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {ledger.accountCode} — {ledger.accountName}
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {normalBalanceLabel(ledger.normalBalance)} balance · {ledger.total}{" "}
            posting{ledger.total === 1 ? "" : "s"}
            {ledger.fromDate ? ` from ${formatDate(ledger.fromDate)}` : ""}
            {ledger.toDate ? ` to ${formatDate(ledger.toDate)}` : ""}
          </p>
        </div>

        <dl className="flex flex-wrap gap-6 text-sm">
          <div>
            <dt className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
              Opening
            </dt>
            <dd className="mt-1 font-medium text-gray-800 tabular-nums dark:text-white/90">
              {formatPaise(ledger.openingBalancePaise)}
            </dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
              Closing
            </dt>
            <dd className="mt-1 font-medium text-gray-800 tabular-nums dark:text-white/90">
              {formatPaise(ledger.closingBalancePaise)}
            </dd>
          </div>
        </dl>
      </div>

      {ledger.rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          No postings to this account in this period.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
                <th className="px-5 py-3 font-medium">Entry</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Narration</th>
                <th className="px-5 py-3 text-right font-medium">Debit</th>
                <th className="px-5 py-3 text-right font-medium">Credit</th>
                <th className="px-5 py-3 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((row) => (
                <tr
                  key={row.journalLineId}
                  className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
                >
                  <td className="px-5 py-3 text-gray-800 tabular-nums dark:text-white/90">
                    {row.entryNumber}
                  </td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                    {formatDate(row.entryDate)}
                  </td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                    {row.description ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-right text-gray-800 tabular-nums dark:text-white/90">
                    {row.debitPaise === "0" ? "—" : formatPaise(row.debitPaise)}
                  </td>
                  <td className="px-5 py-3 text-right text-gray-800 tabular-nums dark:text-white/90">
                    {row.creditPaise === "0"
                      ? "—"
                      : formatPaise(row.creditPaise)}
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                    {formatPaise(row.runningBalancePaise)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 dark:border-gray-800">
                <td className="px-5 py-3" colSpan={3}>
                  <span className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
                    Period movement
                  </span>
                </td>
                <td className="px-5 py-3 text-right font-semibold text-gray-800 tabular-nums dark:text-white/90">
                  {formatPaise(ledger.totalDebitPaise)}
                </td>
                <td className="px-5 py-3 text-right font-semibold text-gray-800 tabular-nums dark:text-white/90">
                  {formatPaise(ledger.totalCreditPaise)}
                </td>
                <td className="px-5 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
