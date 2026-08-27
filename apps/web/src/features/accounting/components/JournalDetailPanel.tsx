import type { JournalDetail } from "@lms/types";
import Link from "next/link";

import { formatDate, formatPaise } from "@/lib/format";

import {
  BalanceBadge,
  JournalStatusBadge,
  entryTypeLabel,
} from "./AccountingBadges";

/**
 * One journal entry and its lines.
 *
 * A server component. `totalDebitPaise`, `totalCreditPaise` and `balanced` come
 * from the API rather than being summed here — summing the lines in the browser
 * would produce a number that looks like the same assertion but is really the
 * client marking its own homework.
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

export default function JournalDetailPanel({
  journal,
}: {
  journal: JournalDetail;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-800 tabular-nums dark:text-white/90">
            {journal.entryNumber}
          </h2>
          <JournalStatusBadge status={journal.status} />
          <BalanceBadge balanced={journal.balanced} />
        </div>

        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Business date" value={formatDate(journal.entryDate)} />
          <Detail label="Type" value={entryTypeLabel(journal.entryType)} />
          <Detail label="Description" value={journal.description} />
          <Detail label="Branch" value={journal.branchName} />
          <Detail label="Created by" value={journal.createdByName} />
          <Detail
            label="Posted"
            value={journal.postedAt ? formatDate(journal.postedAt) : undefined}
          />
          <Detail label="Posted by" value={journal.postedByName} />
          <Detail label="Adjustment reason" value={journal.adjustmentReason} />
          <Detail label="Reversal reason" value={journal.reversalReason} />
          <Detail
            label="Approval reference"
            value={journal.approvalReference}
          />
        </dl>

        {/*
          The reversal relationship, in whichever direction this entry sits.
          A reversal names what it unwound; a reversed entry names what unwound
          it. Both are links, because tracing one to the other is the first
          thing anyone reviewing a correction wants to do.
        */}
        {journal.originalJournalEntryId && (
          <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
            Reverses{" "}
            <Link
              href={`/finance/journals/${journal.originalJournalEntryId}`}
              className="text-brand-600 dark:text-brand-400 font-medium hover:underline"
            >
              {journal.originalEntryNumber}
            </Link>
          </p>
        )}

        {journal.reversalJournalEntryId && (
          <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
            Reversed by{" "}
            <Link
              href={`/finance/journals/${journal.reversalJournalEntryId}`}
              className="text-brand-600 dark:text-brand-400 font-medium hover:underline"
            >
              {journal.reversalEntryNumber}
            </Link>
          </p>
        )}

        {journal.sourceType && (
          <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
            Posted by the {entryTypeLabel(journal.sourceType).toLowerCase()}{" "}
            module. Source transactions are traced through reconciliation.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-400">
          Lines
        </h3>

        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
                <th className="px-5 py-3 font-medium">#</th>
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 font-medium">Narration</th>
                <th className="px-5 py-3 text-right font-medium">Debit</th>
                <th className="px-5 py-3 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {journal.lines.map((line) => (
                <tr
                  key={line.journalLineId}
                  className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
                >
                  <td className="px-5 py-3 text-gray-500 tabular-nums dark:text-gray-400">
                    {line.lineNumber}
                  </td>
                  <td className="px-5 py-3 text-gray-800 dark:text-white/90">
                    {line.accountCode} — {line.accountName}
                  </td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                    {line.description ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                    {line.debitPaise === "0"
                      ? "—"
                      : formatPaise(line.debitPaise)}
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                    {line.creditPaise === "0"
                      ? "—"
                      : formatPaise(line.creditPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 dark:border-gray-800">
                <td className="px-5 py-3" colSpan={3}>
                  <span className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
                    Totals
                  </span>
                </td>
                <td className="px-5 py-3 text-right font-semibold text-gray-800 tabular-nums dark:text-white/90">
                  {formatPaise(journal.totalDebitPaise)}
                </td>
                <td className="px-5 py-3 text-right font-semibold text-gray-800 tabular-nums dark:text-white/90">
                  {formatPaise(journal.totalCreditPaise)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
