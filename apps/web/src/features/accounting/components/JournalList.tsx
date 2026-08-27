import type { JournalSummary } from "@lms/types";
import Link from "next/link";

import { formatDate, formatPaise } from "@/lib/format";

import {
  BalanceBadge,
  JournalStatusBadge,
  entryTypeLabel,
} from "./AccountingBadges";

/**
 * Journals within the caller's scope (Scenarios 32, 34).
 *
 * A server component. The rows it renders are already confined to the caller's
 * organization and branch by the API — there is no branch filter here, and no
 * request parameter through which one could be widened.
 */
export default function JournalList({
  journals,
}: {
  journals: JournalSummary[];
}) {
  if (journals.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No journal entries yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
            <th className="px-5 py-3 font-medium">Entry</th>
            <th className="px-5 py-3 font-medium">Date</th>
            <th className="px-5 py-3 font-medium">Type</th>
            <th className="px-5 py-3 font-medium">Description</th>
            <th className="px-5 py-3 text-right font-medium">Debit</th>
            <th className="px-5 py-3 text-right font-medium">Credit</th>
            <th className="px-5 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {journals.map((journal) => (
            <tr
              key={journal.journalEntryId}
              className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
            >
              <td className="px-5 py-3">
                <Link
                  href={`/finance/journals/${journal.journalEntryId}`}
                  className="text-brand-600 dark:text-brand-400 font-medium hover:underline"
                >
                  {journal.entryNumber}
                </Link>
              </td>
              <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                {formatDate(journal.entryDate)}
              </td>
              <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                {entryTypeLabel(journal.entryType)}
              </td>
              <td className="px-5 py-3 text-gray-800 dark:text-white/90">
                {journal.description ?? "—"}
              </td>
              <td className="px-5 py-3 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                {formatPaise(journal.totalDebitPaise)}
              </td>
              <td className="px-5 py-3 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                {formatPaise(journal.totalCreditPaise)}
              </td>
              <td className="px-5 py-3">
                <div className="flex flex-wrap gap-1">
                  <JournalStatusBadge status={journal.status} />
                  <BalanceBadge balanced={journal.balanced} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
