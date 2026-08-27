import type { CashHandoverSummary } from "@lms/types";
import Link from "next/link";

import { formatDate, formatPaise } from "@/lib/format";

import { HandoverStatusBadge } from "./CashBadges";

/**
 * Cash handovers within the caller's scope (Scenarios 4, 46).
 *
 * A server component. Confined by the API to the caller's branch, and — for an
 * agent — to their own handovers.
 *
 * The difference column shows a signed figure and is the reason this list
 * exists rather than a simple status page: a non-zero difference is money that
 * has not been accounted for, and Rule 34 forbids it being quietly absorbed.
 */
export default function CashHandoverList({
  handovers,
}: {
  handovers: CashHandoverSummary[];
}) {
  if (handovers.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No cash handovers yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
            <th className="px-5 py-3 font-medium">Handover</th>
            <th className="px-5 py-3 font-medium">Date</th>
            <th className="px-5 py-3 font-medium">Agent</th>
            <th className="px-5 py-3 text-right font-medium">Declared</th>
            <th className="px-5 py-3 text-right font-medium">Counted</th>
            <th className="px-5 py-3 text-right font-medium">Difference</th>
            <th className="px-5 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {handovers.map((handover) => (
            <tr
              key={handover.handoverId}
              className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
            >
              <td className="px-5 py-3">
                <Link
                  href={`/field/cash-handovers/${handover.handoverId}`}
                  className="text-brand-600 dark:text-brand-400 font-medium hover:underline"
                >
                  {handover.handoverNumber}
                </Link>
              </td>
              <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                {formatDate(handover.businessDate)}
              </td>
              <td className="px-5 py-3 text-gray-800 dark:text-white/90">
                {handover.agentName ?? "—"}
              </td>
              <td className="px-5 py-3 text-right text-gray-800 tabular-nums dark:text-white/90">
                {formatPaise(handover.handedOverCashPaise)}
              </td>
              <td className="px-5 py-3 text-right text-gray-500 tabular-nums dark:text-gray-400">
                {/* Absent until received, and shown as a dash rather than as
                    zero: "not counted yet" and "counted nothing" are different
                    claims, and only one of them is ever true here. */}
                {handover.receivedCashPaise
                  ? formatPaise(handover.receivedCashPaise)
                  : "—"}
              </td>
              <td className="px-5 py-3 text-right tabular-nums">
                <DifferenceCell
                  differencePaise={handover.differencePaise}
                  settled={
                    handover.status === "RECEIVED" ||
                    handover.status === "RECONCILED"
                  }
                />
              </td>
              <td className="px-5 py-3">
                <HandoverStatusBadge status={handover.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A signed difference, coloured only when it means something.
 *
 * Before the branch counts the cash the difference is not zero — it is
 * *unknown*, and rendering "₹0.00" there would assert a match nobody has
 * checked. Hence the `settled` gate rather than a truthiness test on the value.
 */
function DifferenceCell({
  differencePaise,
  settled,
}: {
  differencePaise: string;
  settled: boolean;
}) {
  if (!settled) {
    return <span className="text-xs text-gray-400">—</span>;
  }

  const isZero = differencePaise === "0";

  return (
    <span
      className={
        isZero
          ? "text-gray-500 dark:text-gray-400"
          : "text-error-600 dark:text-error-400 font-medium"
      }
    >
      {formatPaise(differencePaise)}
    </span>
  );
}
