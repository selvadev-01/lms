import type { CollectionAllocationView } from "@lms/types";

import { formatDate, formatPaise } from "@/lib/format";

/**
 * How a payment was split, or would be (Scenarios 2, 6, 7, 20).
 *
 * A server component — it renders figures the API computed and holds no state.
 *
 * # Why the order is fixed rather than sorted by amount
 *
 * Penalty, interest, principal, fees is the appropriation rule, and showing it
 * in that order is how an operator can see the rule was followed. Sorting by
 * size — the obvious "nicer" presentation — would hide exactly the property the
 * borrower might dispute.
 *
 * # Why the total is not recomputed here
 *
 * The four component figures and their sum both come from the API, which read
 * them from a row the database's `collections_allocation_sums` CHECK enforced.
 * Adding them up in the browser would look like the same assertion but is
 * really the client marking its own homework.
 */

interface Components {
  penaltyPaise: string;
  interestPaise: string;
  principalPaise: string;
  feesPaise: string;
  unallocatedPaise: string;
  totalPaise: string;
}

/** Fixed appropriation order. Not sorted — see the file comment. */
const ROWS: { key: keyof Components; label: string; note?: string }[] = [
  { key: "penaltyPaise", label: "Penalty" },
  { key: "interestPaise", label: "Interest" },
  { key: "principalPaise", label: "Principal" },
  { key: "feesPaise", label: "Fees" },
];

export default function AllocationSummary({
  components,
  lines,
  heading = "Allocation",
}: {
  components: Components;
  /** Per-installment detail. Omitted on the list surfaces. */
  lines?: CollectionAllocationView[];
  heading?: string;
}) {
  // Compared against `BigInt("0")` rather than a `0n` literal: the web app
  // targets ES2017, where BigInt literals are a syntax error even though the
  // runtime supports the type.
  const unallocated = BigInt(components.unallocatedPaise || "0");
  const hasUnapplied = unallocated > BigInt("0");

  return (
    <section className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
      <h2 className="mb-4 text-sm font-medium text-gray-800 dark:text-white/90">
        {heading}
      </h2>

      <dl className="space-y-2 text-sm">
        {ROWS.map((row) => (
          <div key={row.key} className="flex justify-between gap-4">
            <dt className="text-gray-500 dark:text-gray-400">{row.label}</dt>
            <dd className="font-medium text-gray-800 tabular-nums dark:text-white/90">
              {formatPaise(components[row.key])}
            </dd>
          </div>
        ))}

        {/*
          Rendered only when non-zero. Overpayment is refused, so this should
          always be zero — showing a permanent "Unapplied 0.00" row would be
          noise, but hiding a non-zero value would hide a real problem.
        */}
        {hasUnapplied && (
          <div className="flex justify-between gap-4">
            <dt className="text-warning-600 dark:text-warning-400">
              Unapplied
            </dt>
            <dd className="text-warning-600 dark:text-warning-400 font-medium tabular-nums">
              {formatPaise(components.unallocatedPaise)}
            </dd>
          </div>
        )}

        <div className="flex justify-between gap-4 border-t border-gray-200 pt-2 dark:border-gray-800">
          <dt className="font-medium text-gray-800 dark:text-white/90">
            Total
          </dt>
          <dd className="font-semibold text-gray-800 tabular-nums dark:text-white/90">
            {formatPaise(components.totalPaise)}
          </dd>
        </div>
      </dl>

      {lines && lines.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
                <th className="py-2 pr-4 font-medium">Installment</th>
                <th className="py-2 pr-4 font-medium">Due</th>
                <th className="py-2 pr-4 font-medium">Component</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr
                  key={`${line.emiId}-${line.component}-${index}`}
                  className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
                >
                  <td className="py-2 pr-4 text-gray-800 dark:text-white/90">
                    {/*
                      A loan-level penalty belongs to no installment. Rendering
                      "0" would read as installment zero.
                    */}
                    {line.installmentNumber > 0 ? line.installmentNumber : "—"}
                  </td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                    {line.dueDate ? formatDate(line.dueDate) : "—"}
                  </td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                    {line.component.charAt(0) +
                      line.component.slice(1).toLowerCase()}
                  </td>
                  <td className="py-2 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                    {formatPaise(line.amountPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
