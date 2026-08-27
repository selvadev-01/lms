import type { OverdueDetail as OverdueDetailData } from "@lms/types";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@lms/ui";
import Link from "next/link";

import { formatDate, formatPaise } from "@/lib/format";
import {
  DelinquencyBucketBadge,
  NpaStatusBadge,
} from "./RecoveryBadges";

/**
 * One loan's overdue position.
 *
 * A server component. Everything shown is derived server-side against the
 * Asia/Kolkata business date; nothing here recomputes a day count or a total in
 * the browser, which is what keeps a wrong device clock out of the numbers
 * (Rule 14).
 *
 * The four component totals are shown separately as well as summed, because the
 * source's money identity is exactly that sum and an operator reconciling
 * against a statement needs the parts.
 */
export default function OverdueDetail({
  overdue,
}: {
  overdue: OverdueDetailData;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {overdue.loanNumber}
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {overdue.customerName}
              {overdue.branchName ? ` · ${overdue.branchName}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DelinquencyBucketBadge bucket={overdue.bucket} />
            <NpaStatusBadge status={overdue.npaEligibility} derived />
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Figure
            label="Oldest unpaid due date"
            value={formatDate(overdue.oldestDueDate)}
          />
          <Figure
            label="Days past due"
            value={String(overdue.daysPastDue)}
          />
          <Figure
            label="Total overdue"
            value={formatPaise(overdue.totalOverduePaise)}
            emphasis
          />
          <Figure
            label="Total outstanding"
            value={formatPaise(overdue.totalOutstandingPaise)}
          />
        </dl>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Overdue breakdown
        </h3>
        {/*
          Shown as the four components that sum to the total, because that sum
          is the source's money identity and an operator reconciling against a
          customer statement needs to see the parts, not just the answer.
        */}
        <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Figure
            label="Principal"
            value={formatPaise(overdue.overduePrincipalPaise)}
          />
          <Figure
            label="Interest"
            value={formatPaise(overdue.overdueInterestPaise)}
          />
          <Figure
            label="Penalty"
            value={formatPaise(overdue.overduePenaltyPaise)}
          />
          <Figure label="Fees" value={formatPaise(overdue.overdueFeesPaise)} />
        </dl>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Overdue installments
        </h3>

        {overdue.installments.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            No installment is past its due date.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                <TableRow>
                  <HeaderCell>#</HeaderCell>
                  <HeaderCell>Due date</HeaderCell>
                  <HeaderCell>Days past due</HeaderCell>
                  <HeaderCell align="end">Due</HeaderCell>
                  <HeaderCell align="end">Paid</HeaderCell>
                  <HeaderCell align="end">Outstanding</HeaderCell>
                  <HeaderCell align="end">Penalty</HeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {overdue.installments.map((emi) => (
                  <TableRow key={emi.emiId}>
                    <TableCell className="px-5 py-3 text-start text-sm text-gray-700 dark:text-gray-300">
                      {emi.installmentNumber}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-start text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(emi.dueDate)}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-start text-sm text-gray-700 dark:text-gray-300">
                      {emi.daysPastDue}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-end text-sm text-gray-700 dark:text-gray-300">
                      {formatPaise(emi.totalDuePaise)}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-end text-sm text-gray-700 dark:text-gray-300">
                      {formatPaise(emi.paidAmountPaise)}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-end text-sm font-medium text-gray-800 dark:text-white/90">
                      {formatPaise(emi.outstandingAmountPaise)}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-end text-sm text-gray-700 dark:text-gray-300">
                      {formatPaise(emi.penaltyOutstandingPaise)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {overdue.penalties.length > 0 ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
            Assessed penalties
          </h3>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                <TableRow>
                  <HeaderCell>Assessed</HeaderCell>
                  <HeaderCell>Status</HeaderCell>
                  <HeaderCell align="end">Amount</HeaderCell>
                  <HeaderCell align="end">Paid</HeaderCell>
                  <HeaderCell align="end">Outstanding</HeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {overdue.penalties.map((penalty) => (
                  <TableRow key={penalty.penaltyId}>
                    <TableCell className="px-5 py-3 text-start text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(penalty.assessedDate)}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-start text-sm text-gray-700 dark:text-gray-300">
                      {penalty.status}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-end text-sm text-gray-700 dark:text-gray-300">
                      {formatPaise(penalty.amountPaise)}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-end text-sm text-gray-700 dark:text-gray-300">
                      {formatPaise(penalty.paidAmountPaise)}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-end text-sm font-medium text-gray-800 dark:text-white/90">
                      {formatPaise(penalty.outstandingAmountPaise)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      {overdue.recoveryCaseId ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          A recovery case is open on this loan.{" "}
          <Link
            href={`/recovery-cases/${overdue.recoveryCaseId}`}
            className="text-brand-500 hover:underline"
          >
            View the case
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-theme-xs text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? "mt-1 text-lg font-semibold text-gray-800 dark:text-white/90"
            : "mt-1 text-sm font-medium text-gray-800 dark:text-white/90"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function HeaderCell({
  children,
  align = "start",
}: {
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  return (
    <TableCell
      isHeader
      className={`px-5 py-3 text-${align} text-theme-xs font-medium text-gray-500 dark:text-gray-400`}
    >
      {children}
    </TableCell>
  );
}
