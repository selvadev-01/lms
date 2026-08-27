import type { EmiScheduleView } from "@lms/types";
import { Alert } from "@lms/ui";

import { formatDate, formatPaise } from "./LoanBadges";

/**
 * The EMI preview (wizard step 4) and the schedule on the detail screen.
 *
 * A server component: it formats numbers the API already computed and holds no
 * state. The schedule is never calculated in the browser — the same package
 * computes it on both sides, but the server's answer is the authoritative one,
 * and showing a locally-derived figure would invite the two to disagree.
 *
 * `schedule === null` means the stored terms produce no schedule. That is
 * rendered as a blocking error rather than an empty table, because it is the
 * condition that stops submission and approval (Scenarios 12, 50) — an empty
 * table would read as "no instalments due".
 */
export default function EmiSchedulePanel({
  schedule,
  title = "EMI Preview",
}: {
  schedule: EmiScheduleView | null;
  title?: string;
}) {
  if (!schedule) {
    return (
      <Alert
        variant="error"
        title="No repayment schedule"
        message="These terms do not produce a valid EMI schedule. The application cannot be submitted or approved until they are corrected."
      />
    );
  }

  const levelInstalments = schedule.installmentCount - 1;

  return (
    <section className="space-y-4">
      <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
        {title}
      </h3>

      <dl className="grid grid-cols-2 gap-4 rounded-2xl border border-gray-200 p-4 sm:grid-cols-4 dark:border-gray-800">
        <Figure
          label="Instalment"
          value={formatPaise(schedule.installmentAmountPaise)}
        />
        <Figure label="Instalments" value={String(schedule.installmentCount)} />
        <Figure
          label="Total interest"
          value={formatPaise(schedule.totalInterestPaise)}
        />
        <Figure
          label="Total payable"
          value={formatPaise(schedule.totalPayablePaise)}
        />
        <Figure label="First due" value={formatDate(schedule.firstDueDate)} />
        <Figure label="Last due" value={formatDate(schedule.lastDueDate)} />
        {schedule.finalInstallmentPaise !== schedule.installmentAmountPaise && (
          <Figure
            label="Final instalment"
            value={formatPaise(schedule.finalInstallmentPaise)}
            // Worth calling out rather than burying: the last instalment absorbs
            // all the rounding residue, so it differs by a few paise and a
            // borrower comparing it against the others would otherwise wonder.
            hint={`Absorbs rounding from the ${levelInstalments} level instalments`}
          />
        )}
      </dl>

      <details className="rounded-2xl border border-gray-200 dark:border-gray-800">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300">
          Repayment schedule ({schedule.installmentCount} instalments)
        </summary>

        <div className="overflow-x-auto border-t border-gray-200 dark:border-gray-800">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase dark:bg-white/[0.03] dark:text-gray-400">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  #
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Due
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Principal
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Interest
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {schedule.installments.map((installment) => (
                <tr key={installment.installmentNumber}>
                  <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                    {installment.installmentNumber}
                  </td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                    {formatDate(installment.dueDate)}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">
                    {formatPaise(installment.principalPaise)}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">
                    {formatPaise(installment.interestPaise)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-gray-800 dark:text-white/90">
                    {formatPaise(installment.totalPaise)}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">
                    {formatPaise(installment.closingBalancePaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-1 font-medium text-gray-800 dark:text-white/90">
        {value}
      </dd>
      {hint && (
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{hint}</p>
      )}
    </div>
  );
}
