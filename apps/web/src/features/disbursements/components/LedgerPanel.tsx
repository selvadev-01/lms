import type { LedgerEntryDetail } from "@lms/types";

import { formatDate, formatPaise } from "@/lib/format";

/**
 * The posted double-entry behind a disbursement (Scenarios 19, 21, 49).
 *
 * A server component — it renders numbers the API computed and holds no state.
 *
 * # Why the totals row is not computed here
 *
 * `totalDebitPaise`, `totalCreditPaise` and `balanced` come from the API, which
 * read them from the same rows the database's sum-to-zero trigger enforced.
 * Summing the lines in the browser would produce a number that *looks* like the
 * same assertion but is really the client marking its own homework: if the API
 * ever sent a line the trigger had not seen, a client-side sum would agree with
 * it. Displaying the server's figures means the balance shown is the balance
 * the database committed.
 *
 * The unbalanced case is rendered rather than assumed away. It should be
 * unreachable — the trigger rejects such an entry at COMMIT — so if it ever
 * appears on screen, something is wrong in a way that must not be silent.
 */
export default function LedgerPanel({ entry }: { entry: LedgerEntryDetail }) {
  return (
    <section className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-800 dark:text-white/90">
          Ledger entry
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {entry.entryNumber} · {formatDate(entry.entryDate)} · {entry.status}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase dark:bg-white/[0.03] dark:text-gray-400">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Account
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Debit
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Credit
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {entry.lines.map((line) => (
              <tr key={line.lineNumber}>
                <td className="px-4 py-3 text-gray-800 dark:text-white/90">
                  {line.accountName}
                  <span className="block text-xs text-gray-400">
                    {line.accountCode}
                    {line.description ? ` · ${line.description}` : ""}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-gray-800 tabular-nums dark:text-white/90">
                  {line.debitPaise === "0" ? "—" : formatPaise(line.debitPaise)}
                </td>
                <td className="px-4 py-3 text-right text-gray-800 tabular-nums dark:text-white/90">
                  {line.creditPaise === "0"
                    ? "—"
                    : formatPaise(line.creditPaise)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 dark:border-gray-700">
            <tr className="font-medium">
              <th scope="row" className="px-4 py-3 text-left">
                Total
              </th>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatPaise(entry.totalDebitPaise)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatPaise(entry.totalCreditPaise)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p
        className={
          entry.balanced
            ? "mt-3 text-xs text-green-600 dark:text-green-400"
            : "mt-3 text-xs font-medium text-red-600 dark:text-red-400"
        }
      >
        {entry.balanced
          ? "Debits equal credits. This entry is balanced."
          : "This entry does not balance. Contact support immediately."}
      </p>

      <p className="mt-2 text-xs text-gray-400">
        Ledger entries are append-only. A correction is posted as a reversal,
        never as an edit.
      </p>
    </section>
  );
}
