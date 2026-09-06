import type { OverdueSummary } from "@lms/types";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@lms/ui";
import Link from "next/link";

import { formatDate, formatPaise } from "@/lib/format";
import { DelinquencyBucketBadge, NpaStatusBadge } from "./RecoveryBadges";

/**
 * The overdue book.
 *
 * A server component: every value it renders is derived server-side and none of
 * it is interactive. Shipping it to the browser would cost bundle size and,
 * worse, would put a `Date`-based day count in reach of the client — the exact
 * thing Rule 14 forbids.
 *
 * The NPA column is rendered as *indicated* rather than as the loan's
 * classification, because that is what it is: the ageing supports it and an
 * authorized act commits it (Rule 29).
 */
export default function OverdueList({
  overdues,
}: {
  overdues: OverdueSummary[];
}) {
  if (overdues.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No overdue accounts in your branch. Nothing is past its due date.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
          <TableRow>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              Loan
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              Customer
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              Oldest due
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              Days past due
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              Bucket
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              NPA
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-end font-medium text-gray-500 dark:text-gray-400"
            >
              Total overdue
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              Case
            </TableCell>
          </TableRow>
        </TableHeader>

        <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
          {overdues.map((overdue) => (
            <TableRow key={overdue.loanId}>
              <TableCell className="px-5 py-4 text-start">
                <Link
                  href={`/overdues/${overdue.loanId}`}
                  className="text-brand-500 text-sm font-medium hover:underline"
                >
                  {overdue.loanNumber}
                </Link>
              </TableCell>
              <TableCell className="px-5 py-4 text-start text-sm text-gray-700 dark:text-gray-300">
                {overdue.customerName}
              </TableCell>
              <TableCell className="px-5 py-4 text-start text-sm text-gray-500 dark:text-gray-400">
                {formatDate(overdue.oldestDueDate)}
              </TableCell>
              <TableCell className="px-5 py-4 text-start text-sm text-gray-700 dark:text-gray-300">
                {overdue.daysPastDue}
              </TableCell>
              <TableCell className="px-5 py-4 text-start">
                <DelinquencyBucketBadge bucket={overdue.bucket} />
              </TableCell>
              <TableCell className="px-5 py-4 text-start">
                <NpaStatusBadge status={overdue.npaEligibility} derived />
              </TableCell>
              <TableCell className="px-5 py-4 text-end text-sm font-medium text-gray-800 dark:text-white/90">
                {formatPaise(overdue.totalOverduePaise)}
              </TableCell>
              <TableCell className="px-5 py-4 text-start text-sm">
                {overdue.recoveryCaseId ? (
                  <Link
                    href={`/recovery-cases/${overdue.recoveryCaseId}`}
                    className="text-brand-500 hover:underline"
                  >
                    Open case
                  </Link>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500">
                    Unassigned
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
