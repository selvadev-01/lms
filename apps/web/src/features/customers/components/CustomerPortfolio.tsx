import type {
  EmiRow,
  LoanApplicationSummary,
  LoanSummaryView,
  PortfolioReportRow,
  RepaymentScheduleView,
} from "@lms/types";
import Link from "next/link";
import React from "react";

// Imported from the component file directly, never through `@/features/loans`:
// that barrel re-exports `api/loans.ts`, which is `server-only`, and reaching it
// from a client component pulls the server data layer into the browser bundle
// and fails the build. Its own header says so.
import {
  ApplicationStatusBadge,
  formatDate,
  formatPaise,
} from "@/features/loans/components/LoanBadges";

/**
 * One borrower's lending position.
 *
 * # Where the money figures come from
 *
 * The per-loan outstanding split and days past due are `PortfolioReportRow`s
 * from the Portfolio report, not a second calculation. That service already
 * derives them, is already the authority for the report of the same name, and is
 * already branch-scoped — and two implementations of "what does this borrower
 * owe" would eventually disagree, which surfaces as a customer being quoted two
 * different balances.
 *
 * # Why there is a fallback
 *
 * Those rows need `reports.portfolio.view`, which not every role holds. Without
 * it the page passes the plain loan list instead and this renders loan number,
 * scheme, principal and status — so someone who may open the customer still sees
 * their loans, and only the balances are withheld.
 *
 * # Applications are here too
 *
 * A loan exists only after disbursal, so loans alone would say "nothing" about a
 * customer whose application is three days from funding. The question being
 * asked — should we lend to this person again — is about the whole relationship.
 */
export default function CustomerPortfolio({
  positions,
  loans,
  applications,
  canSeeBalances,
  schedules,
}: {
  /** From the Portfolio report. Empty when `canSeeBalances` is false. */
  positions: PortfolioReportRow[];
  /** The plain list, used for the fallback and for loans the report omits. */
  loans: LoanSummaryView[];
  applications: LoanApplicationSummary[];
  canSeeBalances: boolean;
  /**
   * Instalment lists, keyed by loan.
   *
   * Only the first few loans carry one — the page bounds how many it fetches,
   * because each is its own request. A loan without one still lists its balances
   * and links to its own page, where the schedule always renders.
   */
  schedules: RepaymentScheduleView[];
}) {
  /**
   * Applications that have not become a loan yet.
   *
   * A disbursed application has a loan row, and showing both would list the same
   * borrowing twice under two different numbers.
   */
  const inProgress = applications.filter(
    (application) =>
      application.status !== "DISBURSED" && application.status !== "REJECTED",
  );

  const hasNothing =
    loans.length === 0 && positions.length === 0 && inProgress.length === 0;

  if (hasNothing) {
    return (
      <div
        className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
        role="status"
      >
        <p>No loans or applications yet.</p>
        <Link
          href="/loans/applications/new"
          className="text-brand-500 mt-3 inline-block hover:underline"
        >
          Start an application
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {canSeeBalances ? (
        <Totals positions={positions} />
      ) : (
        <p className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          Outstanding balances and arrears need the portfolio report permission.
          The loans below are shown without them.
        </p>
      )}

      {inProgress.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
            Applications in progress
          </h3>
          <ul className="divide-y divide-gray-200 rounded-2xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {inProgress.map((application) => (
              <li
                key={application.applicationId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <Link
                    href={`/loans/applications/${application.applicationId}`}
                    className="text-brand-500 text-sm font-medium hover:underline"
                  >
                    {application.applicationNumber}
                  </Link>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {application.schemeName} ·{" "}
                    {formatPaise(application.requestedAmountPaise)}
                  </p>
                </div>
                <ApplicationStatusBadge status={application.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {canSeeBalances && positions.length > 0 && (
        <PositionTable positions={positions} schedules={schedules} />
      )}

      {!canSeeBalances && loans.length > 0 && <BasicTable loans={loans} />}
    </div>
  );
}

function Totals({ positions }: { positions: PortfolioReportRow[] }) {
  /**
   * Summed as `Number`, not `BigInt`: the web build targets below ES2020 so a
   * bigint literal will not compile. Paise are exact in a double past ₹90,000
   * crore, which no single borrower approaches. The API keeps the authoritative
   * arithmetic in bigint.
   */
  const sum = (pick: (row: PortfolioReportRow) => string) =>
    positions.reduce((total, row) => total + Number(pick(row)), 0);

  const outstanding = sum((row) => row.totalOutstandingPaise);
  const disbursed = sum((row) => row.principalDisbursedPaise);
  // Overdue is not a column on the row — `daysPastDue` says whether a loan is in
  // arrears, and the amount lives on the loan's own page. Counting loans in
  // arrears is the honest summary this data supports.
  const inArrears = positions.filter((row) => row.daysPastDue > 0).length;
  const worstDpd = positions.reduce(
    (worst, row) => Math.max(worst, row.daysPastDue),
    0,
  );

  return (
    <dl className="grid gap-4 rounded-2xl border border-gray-200 p-5 sm:grid-cols-4 dark:border-gray-800">
      <Figure label="Loans" value={String(positions.length)} />
      <Figure label="Total outstanding" value={formatPaise(String(outstanding))} />
      <Figure label="Total disbursed" value={formatPaise(String(disbursed))} />
      <Figure
        label="In arrears"
        value={
          inArrears === 0 ? "None" : `${inArrears} · ${worstDpd} days worst`
        }
      />
    </dl>
  );
}

/**
 * Every loan with what it owes, and the instalments behind it.
 *
 * A card per loan rather than one flat table: the instalment list belongs *to* a
 * loan, and a single table cannot nest one row inside another without lying
 * about which loan a due date belongs to.
 *
 * The instalments sit in a collapsed `<details>` — the same device
 * `EmiSchedulePanel` uses. A loan carries 8-12 of them typically, and expanding
 * every loan by default would bury the balances under a wall of dates.
 */
function PositionTable({
  positions,
  schedules,
}: {
  positions: PortfolioReportRow[];
  schedules: RepaymentScheduleView[];
}) {
  const scheduleFor = new Map(
    schedules.map((schedule) => [schedule.loan.loanId, schedule]),
  );

  return (
    <section className="space-y-3">
      <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
        Loans
      </h3>

      {positions.map((row) => {
        const schedule = scheduleFor.get(row.loanId);

        return (
          <article
            key={row.loanId}
            className="space-y-4 rounded-2xl border border-gray-200 p-5 dark:border-gray-800"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  href={`/loans/${row.loanId}`}
                  className="text-brand-500 font-medium hover:underline"
                >
                  {row.loanNumber}
                </Link>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {row.loanProductName} ·{" "}
                  {row.disbursementDate
                    ? `disbursed ${formatDate(row.disbursementDate)}`
                    : "not disbursed"}{" "}
                  · {row.status.replace(/_/g, " ").toLowerCase()}
                </p>
              </div>
              {row.daysPastDue > 0 && (
                <span className="text-error-500 text-sm font-medium">
                  {row.daysPastDue} days overdue
                  {row.oldestUnpaidDueDate && (
                    <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                      since {formatDate(row.oldestUnpaidDueDate)}
                    </span>
                  )}
                </span>
              )}
            </div>

            <dl className="grid gap-4 sm:grid-cols-5">
              <Figure
                label="Principal"
                value={formatPaise(row.outstandingPrincipalPaise)}
              />
              <Figure
                label="Interest"
                value={formatPaise(row.outstandingInterestPaise)}
              />
              <Figure
                label="Penalty"
                value={formatPaise(row.outstandingPenaltyPaise)}
              />
              <Figure
                label="Fees"
                value={formatPaise(row.outstandingFeesPaise)}
              />
              <Figure
                label="Outstanding"
                value={formatPaise(row.totalOutstandingPaise)}
              />
            </dl>

            {schedule ? (
              <EmiList schedule={schedule} />
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Instalments are on the{" "}
                <Link
                  href={`/loans/${row.loanId}`}
                  className="text-brand-500 hover:underline"
                >
                  loan page
                </Link>
                .
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}

/** The instalment list for one loan. */
function EmiList({ schedule }: { schedule: RepaymentScheduleView }) {
  return (
    <details className="rounded-lg border border-gray-200 dark:border-gray-800">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300">
        {schedule.totals.installmentCount} instalments ·{" "}
        {formatPaise(schedule.totals.totalPaidPaise)} paid of{" "}
        {formatPaise(schedule.totals.totalPayablePaise)}
        {schedule.totals.nextDueDate && (
          <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
            next due {formatDate(schedule.totals.nextDueDate)}
          </span>
        )}
      </summary>

      <div className="overflow-x-auto border-t border-gray-200 dark:border-gray-800">
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
            {schedule.installments.map((emi: EmiRow) => (
              <tr key={emi.emiId}>
                <Td>{emi.installmentNumber}</Td>
                <Td>{formatDate(emi.dueDate)}</Td>
                <Td>{formatPaise(emi.principalDuePaise)}</Td>
                <Td>{formatPaise(emi.interestDuePaise)}</Td>
                <Td>{formatPaise(emi.totalDuePaise)}</Td>
                <Td>{formatPaise(emi.paidAmountPaise)}</Td>
                <Td>{formatPaise(emi.outstandingAmountPaise)}</Td>
                {/* `effectiveStatus`, never `status`: the persisted column stays
                    PENDING until a payment writes to the row, so it does not
                    advance with the calendar. The server derives the display
                    value against the business date. */}
                <Td>{emi.effectiveStatus.replace(/_/g, " ").toLowerCase()}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Without the reports permission: the loans, minus the money. */
function BasicTable({ loans }: { loans: LoanSummaryView[] }) {
  return (
    <section className="space-y-3">
      <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
        Loans
      </h3>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-white/[0.02]">
            <tr>
              <Th>Loan</Th>
              <Th>Scheme</Th>
              <Th>Principal</Th>
              <Th>Disbursed</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {loans.map((loan) => (
              <tr key={loan.loanId}>
                <td className="px-5 py-4">
                  <Link
                    href={`/loans/${loan.loanId}`}
                    className="text-brand-500 font-medium hover:underline"
                  >
                    {loan.loanNumber}
                  </Link>
                </td>
                <Td>{loan.schemeName}</Td>
                <Td>{formatPaise(loan.principalAmountPaise)}</Td>
                <Td>
                  {loan.disbursementDate
                    ? formatDate(loan.disbursementDate)
                    : "—"}
                </Td>
                <Td>{loan.status.replace(/_/g, " ").toLowerCase()}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-gray-800 dark:text-white/90">
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
