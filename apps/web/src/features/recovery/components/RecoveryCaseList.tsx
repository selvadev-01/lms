import type { RecoveryCaseSummary } from "@lms/types";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@lms/ui";
import Link from "next/link";

import { formatDate, formatPaise } from "@/lib/format";
import {
  DelinquencyBucketBadge,
  RecoveryCaseStatusBadge,
  RecoveryPriorityBadge,
} from "./RecoveryBadges";

/**
 * The recovery worklist.
 *
 * A server component, like `OverdueList`. What it shows is already narrowed by
 * the API: an officer without assignment authority receives only their own
 * cases, so this renders whatever it is given without a second filter. A
 * client-side "mine only" toggle would suggest the reach were a display choice
 * rather than a server-enforced boundary.
 */
export default function RecoveryCaseList({
  cases,
}: {
  cases: RecoveryCaseSummary[];
}) {
  if (cases.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No recovery cases match this view.
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
              Case
            </TableCell>
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
              Status
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              Priority
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              Officer
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-start font-medium text-gray-500 dark:text-gray-400"
            >
              Ageing
            </TableCell>
            <TableCell
              isHeader
              className="text-theme-xs px-5 py-3 text-end font-medium text-gray-500 dark:text-gray-400"
            >
              Overdue
            </TableCell>
          </TableRow>
        </TableHeader>

        <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
          {cases.map((row) => (
            <TableRow key={row.recoveryCaseId}>
              <TableCell className="px-5 py-4 text-start">
                <Link
                  href={`/recovery-cases/${row.recoveryCaseId}`}
                  className="text-brand-500 text-sm font-medium hover:underline"
                >
                  {row.caseNumber ?? "View"}
                </Link>
                <p className="text-theme-xs mt-0.5 text-gray-400 dark:text-gray-500">
                  Opened {formatDate(row.openedDate)}
                </p>
              </TableCell>
              <TableCell className="px-5 py-4 text-start text-sm text-gray-700 dark:text-gray-300">
                {row.loanNumber}
              </TableCell>
              <TableCell className="px-5 py-4 text-start text-sm text-gray-700 dark:text-gray-300">
                {row.customerName}
              </TableCell>
              <TableCell className="px-5 py-4 text-start">
                <RecoveryCaseStatusBadge status={row.status} />
              </TableCell>
              <TableCell className="px-5 py-4 text-start">
                <RecoveryPriorityBadge priority={row.priority} />
              </TableCell>
              <TableCell className="px-5 py-4 text-start text-sm text-gray-700 dark:text-gray-300">
                {row.assignedAgentName ?? (
                  <span className="text-gray-400 dark:text-gray-500">
                    Unassigned
                  </span>
                )}
              </TableCell>
              <TableCell className="px-5 py-4 text-start">
                <DelinquencyBucketBadge bucket={row.bucket} />
                <p className="text-theme-xs mt-0.5 text-gray-400 dark:text-gray-500">
                  {row.daysPastDue} days
                </p>
              </TableCell>
              <TableCell className="px-5 py-4 text-end text-sm font-medium text-gray-800 dark:text-white/90">
                {formatPaise(row.totalOverduePaise)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
