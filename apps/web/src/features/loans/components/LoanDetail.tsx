import type {
  CollectionReadiness,
  CollectionSummary,
  LoanSummaryView,
  OverdueDetail,
  RepaymentScheduleView,
} from "@lms/types";
import Link from "next/link";
import React from "react";

import { formatBps, formatDate, formatPaise } from "./LoanBadges";

/**
 * One loan, in full (Modules 09-13).
 *
 * # Why this page did not exist
 *
 * Every loan route in the API hangs off a `loanId` the caller already knew, and
 * nothing in the web app ever linked to a loan — `/loans/{id}` was a 404 until
 * now. Collections, overdue and the customer portfolio all had loan numbers on
 * screen with nowhere to send them.
 *
 * # Every section degrades on its own
 *
 * The four reads behind this are separately permissioned: schedules, collections
 * and overdue each have their own grant. A caller holding one and not another
 * sees the sections they may see, and the rest simply do not render — rather
 * than the page failing because one read was refused. That is why each prop is
 * nullable and each section guards on its own data.
 */
export default function LoanDetail({
  loan,
  readiness,
  schedule,
  collections,
  overdue,
}: {
  loan: LoanSummaryView;
  readiness: CollectionReadiness | null;
  schedule: RepaymentScheduleView | null;
  collections: CollectionSummary[] | null;
  overdue: OverdueDetail | null;
}) {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">
            {loan.loanNumber}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            <Link
              href={`/customers/${loan.customerId}`}
              className="text-brand-500 hover:underline"
            >
              {loan.customerName}
            </Link>{" "}
            · {loan.branchName} · {loan.schemeName}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            {formatPaise(loan.principalAmountPaise)}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {loan.status.replace(/_/g, " ").toLowerCase()}
          </p>
        </div>
      </header>

      {/* --- terms ---------------------------------------------------- */}
      <dl className="grid gap-4 rounded-2xl border border-gray-200 p-5 sm:grid-cols-4 dark:border-gray-800">
        <Figure
          label="Interest"
          value={`${loan.interestType.toLowerCase()} at ${formatBps(loan.interestRateBps)}`}
        />
        <Figure
          label="Term"
          value={`${loan.durationCount} × ${loan.repaymentFrequency.toLowerCase()}`}
        />
        <Figure
          label="Disbursed"
          value={loan.disbursementDate ? formatDate(loan.disbursementDate) : "—"}
        />
        <Figure label="Scheme" value={loan.schemeCode} />
      </dl>

      {/* --- what is owed --------------------------------------------- */}
      {readiness && (
        <section className="space-y-3">
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
            Outstanding
          </h3>
          <dl className="grid gap-4 rounded-2xl border border-gray-200 p-5 sm:grid-cols-5 dark:border-gray-800">
            <Figure
              label="Principal"
              value={formatPaise(readiness.principalOutstandingPaise)}
            />
            <Figure
              label="Interest"
              value={formatPaise(readiness.interestOutstandingPaise)}
            />
            <Figure
              label="Penalty"
              value={formatPaise(readiness.penaltyOutstandingPaise)}
            />
            <Figure
              label="Fees"
              value={formatPaise(readiness.feesOutstandingPaise)}
            />
            <Figure
              label="Total"
              value={formatPaise(readiness.totalOutstandingPaise)}
            />
          </dl>
          {readiness.nextDueEmi && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Next due: installment {readiness.nextDueEmi.installmentNumber} on{" "}
              {formatDate(readiness.nextDueEmi.dueDate)} —{" "}
              {formatPaise(readiness.nextDueEmi.outstandingAmountPaise)}
            </p>
          )}
        </section>
      )}

      {/* --- arrears --------------------------------------------------- */}
      {overdue && overdue.daysPastDue > 0 && (
        <section className="space-y-3">
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
            Arrears
          </h3>
          <dl className="border-error-500/40 grid gap-4 rounded-2xl border p-5 sm:grid-cols-4">
            <Figure
              label="Days past due"
              value={String(overdue.daysPastDue)}
            />
            <Figure label="Bucket" value={overdue.bucket.replace(/_/g, " ")} />
            <Figure
              label="Total overdue"
              value={formatPaise(overdue.totalOverduePaise)}
            />
            {/* `npaEligibility` is what the ageing *supports*, not what the loan
                *is* — the committed classification lives on the recovery case.
                Labelled as eligibility so it cannot read as a decision nobody
                made. */}
            <Figure label="NPA eligibility" value={overdue.npaEligibility} />
          </dl>
          {overdue.recoveryCaseId && (
            <Link
              href={`/recovery/cases/${overdue.recoveryCaseId}`}
              className="text-brand-500 text-sm hover:underline"
            >
              A recovery case is open on this loan
            </Link>
          )}
        </section>
      )}

      {/* --- schedule -------------------------------------------------- */}
      {schedule && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
              Repayment schedule
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {schedule.totals.installmentCount} instalments ·{" "}
              {formatPaise(schedule.totals.totalPaidPaise)} paid of{" "}
              {formatPaise(schedule.totals.totalPayablePaise)}
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-white/[0.02]">
                <tr>
                  <Th>#</Th>
                  <Th>Due</Th>
                  <Th>Principal</Th>
                  <Th>Interest</Th>
                  <Th>Total</Th>
                  <Th>Paid</Th>
                  <Th>Outstanding</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {schedule.installments.map((emi) => (
                  <tr key={emi.emiId}>
                    <Td>{emi.installmentNumber}</Td>
                    <Td>{formatDate(emi.dueDate)}</Td>
                    <Td>{formatPaise(emi.principalDuePaise)}</Td>
                    <Td>{formatPaise(emi.interestDuePaise)}</Td>
                    <Td>{formatPaise(emi.totalDuePaise)}</Td>
                    <Td>{formatPaise(emi.paidAmountPaise)}</Td>
                    <Td>{formatPaise(emi.outstandingAmountPaise)}</Td>
                    {/* `effectiveStatus`, never `status`: the persisted column
                        stays PENDING until a payment writes to the row, so it
                        does not advance with the calendar. The server derives
                        the display value against the business date. */}
                    <Td>
                      {emi.effectiveStatus.replace(/_/g, " ").toLowerCase()}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* --- payments received ----------------------------------------- */}
      {collections && (
        <section className="space-y-3">
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
            Payments received
          </h3>
          {collections.length === 0 ? (
            <p className="rounded-2xl border border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
              Nothing collected on this loan yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-white/[0.02]">
                  <tr>
                    <Th>Date</Th>
                    <Th>Receipt</Th>
                    <Th>Amount</Th>
                    <Th>Mode</Th>
                    <Th>Collected by</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {collections.map((row) => (
                    <tr key={row.collectionId}>
                      <Td>{formatDate(row.collectionDate)}</Td>
                      <td className="px-5 py-4">
                        <Link
                          href={`/loans/collections/${row.collectionId}`}
                          className="text-brand-500 hover:underline"
                        >
                          {row.receiptNumber ?? "—"}
                        </Link>
                      </td>
                      <Td>{formatPaise(row.amountPaise)}</Td>
                      <Td>{row.paymentMode.replace(/_/g, " ").toLowerCase()}</Td>
                      <Td>{row.collectorName ?? "—"}</Td>
                      <Td>{row.status.replace(/_/g, " ").toLowerCase()}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-gray-800 dark:text-white/90">
        {value}
      </dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-5 py-3 text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{children}</td>
  );
}
