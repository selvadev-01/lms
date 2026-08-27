import type { AccountSummary } from "@lms/types";
import Link from "next/link";

import {
  AccountStatusBadge,
  ControlAccountBadge,
  accountTypeLabel,
  normalBalanceLabel,
} from "./AccountingBadges";

/**
 * The chart of accounts.
 *
 * A server component. There is no branch filter, here or in the API: accounts
 * are organization-wide by design, and which branch a posting belongs to is
 * carried by the journal entry rather than by owning a separate account per
 * branch.
 */
export default function AccountList({
  accounts,
}: {
  accounts: AccountSummary[];
}) {
  if (accounts.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No accounts match this filter.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
            <th className="px-5 py-3 font-medium">Code</th>
            <th className="px-5 py-3 font-medium">Name</th>
            <th className="px-5 py-3 font-medium">Type</th>
            <th className="px-5 py-3 font-medium">Normal balance</th>
            <th className="px-5 py-3 font-medium">Manual posting</th>
            <th className="px-5 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr
              key={account.accountId}
              className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
            >
              <td className="px-5 py-3">
                <Link
                  href={`/finance/accounts/${account.accountId}`}
                  className="text-brand-600 dark:text-brand-400 font-medium tabular-nums hover:underline"
                >
                  {account.accountCode}
                </Link>
              </td>
              <td className="px-5 py-3 text-gray-800 dark:text-white/90">
                {account.accountName}
              </td>
              <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                {accountTypeLabel(account.accountType)}
              </td>
              <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                {normalBalanceLabel(account.normalBalance)}
              </td>
              <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                {account.isManualPostingAllowed ? "Allowed" : "Closed"}
              </td>
              <td className="px-5 py-3">
                <div className="flex flex-wrap gap-1">
                  <AccountStatusBadge status={account.status} />
                  <ControlAccountBadge control={account.isControlAccount} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
