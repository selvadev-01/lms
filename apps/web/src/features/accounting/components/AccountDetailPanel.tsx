import type { AccountDetail } from "@lms/types";
import Link from "next/link";

import { formatDate } from "@/lib/format";

import {
  AccountStatusBadge,
  ControlAccountBadge,
  accountTypeLabel,
  normalBalanceLabel,
} from "./AccountingBadges";

/**
 * One account's facts (Scenario 3).
 *
 * A server component. Every verdict it renders — whether the identity may be
 * edited, whether the account may be deleted — comes from the API rather than
 * being re-derived here: a client computing them would need to know about
 * posted lines, child accounts and disbursement references, and would be wrong
 * the first time any of those changed.
 */

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;

  return (
    <div>
      <dt className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-gray-800 dark:text-white/90">{value}</dd>
    </div>
  );
}

export default function AccountDetailPanel({
  account,
}: {
  account: AccountDetail;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          <span className="tabular-nums">{account.accountCode}</span> —{" "}
          {account.accountName}
        </h2>
        <AccountStatusBadge status={account.status} />
        <ControlAccountBadge control={account.isControlAccount} />
      </div>

      <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Type" value={accountTypeLabel(account.accountType)} />
        <Detail
          label="Normal balance"
          value={normalBalanceLabel(account.normalBalance)}
        />
        <Detail label="Category" value={account.accountCategory} />
        <Detail
          label="Parent"
          value={account.parentAccountCode ?? "None — top level"}
        />
        <Detail
          label="Postable"
          value={account.isPostable ? "Yes" : "No — summary account"}
        />
        <Detail
          label="Manual journals"
          value={
            account.isManualPostingAllowed
              ? "Allowed"
              : "Closed — driven by its source module"
          }
        />
        <Detail
          label="Branch scope"
          value={
            account.branchScope === "ORGANIZATION"
              ? "Whole organization"
              : "Single branch"
          }
        />
        <Detail
          label="Effective from"
          value={
            account.effectiveFrom
              ? formatDate(account.effectiveFrom)
              : undefined
          }
        />
        <Detail
          label="Effective to"
          value={
            account.effectiveTo ? formatDate(account.effectiveTo) : undefined
          }
        />
        <Detail label="Description" value={account.description} />
        <Detail label="Posted lines" value={String(account.postedLineCount)} />
        <Detail
          label="Child accounts"
          value={String(account.childAccountCount)}
        />
      </dl>

      {account.postedLineCount > 0 && (
        <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
          <Link
            href={`/finance/ledger?accountId=${account.accountId}`}
            className="text-brand-600 dark:text-brand-400 font-medium hover:underline"
          >
            View this account&rsquo;s ledger
          </Link>
        </p>
      )}
    </div>
  );
}
