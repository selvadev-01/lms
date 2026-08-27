import type { RepaymentScheduleDetail } from "@lms/types";

import { formatDate, formatPaise } from "@/lib/format";

/**
 * The repayment schedule generated at disbursal (Scenario 24).
 *
 * A server component. Deliberately not a reuse of `EmiSchedulePanel` from
 * `features/loans`: that one renders a *projection* computed from unsaved form
 * values during the application wizard, and this renders *persisted* EMI rows
 * with database ids and a status each. They look alike today and diverge the
 * moment either grows — a paid/overdue column here, a recalculate button there
 * — so sharing one component would mean threading a mode flag through both.
 *
 * The totals come from the API rather than being summed here, for the reason
 * `LedgerPanel` gives: the persisted rows are the authority, and a client-side
 * sum would agree with whatever it was sent.
 */
export default function RepaymentSchedulePanel({
  schedule,
}: {
  schedule: RepaymentScheduleDetail;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-800 dark:text-white/90">
          Repayment schedule
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Version {schedule.version} · {schedule.status} ·{" "}
          {schedule.installments.length} installments
        </p>
      </div>

      <div className="max-h-96 overflow-auto rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500 uppercase dark:bg-gray-900 dark:text-gray-400">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                #
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Due date
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Principal
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Interest
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {schedule.installments.map((emi) => (
              <tr key={emi.emiId}>
                <td className="px-4 py-2.5 text-gray-500 tabular-nums dark:text-gray-400">
                  {emi.installmentNumber}
                </td>
                <td className="px-4 py-2.5 text-gray-800 dark:text-white/90">
                  {formatDate(emi.dueDate)}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-800 tabular-nums dark:text-white/90">
                  {formatPaise(emi.principalDuePaise)}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-800 tabular-nums dark:text-white/90">
                  {formatPaise(emi.interestDuePaise)}
                </td>
                <td className="px-4 py-2.5 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                  {formatPaise(emi.totalDuePaise)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 border-t-2 border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
            <tr className="font-medium">
              <th scope="row" colSpan={2} className="px-4 py-3 text-left">
                Total
              </th>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatPaise(schedule.totalPrincipalPaise)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatPaise(schedule.totalInterestPaise)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatPaise(schedule.totalPayablePaise)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Due dates are calendar dates in Asia/Kolkata. The final installment
        absorbs rounding, so the schedule sums exactly to the payable total.
      </p>
    </section>
  );
}
