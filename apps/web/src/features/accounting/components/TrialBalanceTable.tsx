import type { TrialBalance } from "@lms/types";
import { Alert } from "@lms/ui";

import { formatDate, formatPaise } from "@/lib/format";

import { accountTypeLabel } from "./AccountingBadges";

/**
 * Every account's balance, and the assertion that they sum to zero.
 *
 * A server component; pure render. `balanced: false` here does not mean a form
 * was filled in wrongly — every posted entry balances individually, so a sum of
 * them cannot be unbalanced. It means the ledger itself is broken, which is why
 * it is surfaced as an alert rather than as a quiet red total.
 */
export default function TrialBalanceTable({
  trialBalance,
}: {
  trialBalance: TrialBalance;
}) {
  if (trialBalance.rows.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No postings as of {formatDate(trialBalance.asOfDate)}.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {!trialBalance.balanced && (
        <div role="alert" aria-live="assertive">
          <Alert
            variant="error"
            title="The ledger does not balance"
            message="Total debits and credits differ. Every posted entry balances on its own, so this points at the ledger itself rather than at any one entry — run reconciliation and raise it before relying on these figures."
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
              <th className="px-5 py-3 font-medium">Code</th>
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 text-right font-medium">Debit</th>
              <th className="px-5 py-3 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {trialBalance.rows.map((row) => (
              <tr
                key={row.accountId}
                className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
              >
                <td className="px-5 py-3 text-gray-500 tabular-nums dark:text-gray-400">
                  {row.accountCode}
                </td>
                <td className="px-5 py-3 text-gray-800 dark:text-white/90">
                  {row.accountName}
                </td>
                <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                  {accountTypeLabel(row.accountType)}
                </td>
                {/*
                  A balance sits in the column its sign says, not the one its
                  account's convention would suggest: an asset driven into
                  credit belongs on the credit side, and showing it as a
                  negative debit would make these columns fail to add up.
                */}
                <td className="px-5 py-3 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                  {row.balanceSide === "DEBIT"
                    ? formatPaise(row.balancePaise)
                    : "—"}
                </td>
                <td className="px-5 py-3 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                  {row.balanceSide === "CREDIT"
                    ? formatPaise(row.balancePaise)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 dark:border-gray-800">
              <td className="px-5 py-3" colSpan={3}>
                <span className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  Totals as of {formatDate(trialBalance.asOfDate)}
                </span>
              </td>
              <td className="px-5 py-3 text-right font-semibold text-gray-800 tabular-nums dark:text-white/90">
                {formatPaise(trialBalance.totalDebitPaise)}
              </td>
              <td className="px-5 py-3 text-right font-semibold text-gray-800 tabular-nums dark:text-white/90">
                {formatPaise(trialBalance.totalCreditPaise)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
