import type {
  ApplicationReport,
  CollectionReport,
  DisbursalReport,
  FieldCollectionReport,
  FinancialReport,
  OverdueReport,
  PortfolioReport,
} from "@lms/types";

import { formatDate, formatPaise } from "@/lib/format";

import ReportTable, { type Column } from "./ReportTable";

/**
 * The seven tabular reports, as column lists.
 *
 * Each is a handful of columns over the shared `ReportTable`, in the order the
 * story's field list names them — so the screen and the exported file read the
 * same way round, which matters when someone is reconciling one against the
 * other by eye.
 *
 * Nothing here computes a figure. Every value is rendered from what the server
 * sent, including the derived ones: days past due, delinquency bucket and NPA
 * status all arrive already decided by `@lms/emi` (Rules 13, 14), and a
 * component that re-derived any of them would be a second source of truth
 * living in the browser.
 */

/** An absent value is not a zero (Rule 49). */
const NONE = "—";

function money(paise: string | undefined): string {
  return paise === undefined ? NONE : formatPaise(paise);
}

function date(value: string | undefined): string {
  return value ? formatDate(value) : NONE;
}

export function PortfolioReportTable({ report }: { report: PortfolioReport }) {
  const columns: Column<PortfolioReport["rows"][number]>[] = [
    { header: "Loan", cell: (row) => row.loanNumber },
    { header: "Customer", cell: (row) => row.customerName },
    { header: "Branch", cell: (row) => row.branchName },
    { header: "Product", cell: (row) => row.loanProductName },
    { header: "Status", cell: (row) => row.status },
    { header: "Disbursed", cell: (row) => date(row.disbursementDate) },
    {
      header: "Principal",
      align: "right",
      cell: (row) => money(row.principalDisbursedPaise),
    },
    {
      header: "Outstanding",
      align: "right",
      cell: (row) => money(row.totalOutstandingPaise),
    },
    { header: "DPD", align: "right", cell: (row) => row.daysPastDue },
    { header: "NPA", cell: (row) => row.npaStatus },
  ];

  return (
    <ReportTable
      rows={report.rows}
      columns={columns}
      rowKey={(row) => row.loanId}
      totals={report.totals}
      total={report.total}
      page={report.page}
      pageSize={report.pageSize}
      emptyMessage="No loans match these filters."
    />
  );
}

export function ApplicationReportTable({
  report,
}: {
  report: ApplicationReport;
}) {
  const columns: Column<ApplicationReport["rows"][number]>[] = [
    { header: "Application", cell: (row) => row.applicationNumber },
    { header: "Customer", cell: (row) => row.customerName },
    { header: "Branch", cell: (row) => row.branchName },
    { header: "Product", cell: (row) => row.loanProductName },
    { header: "Applied", cell: (row) => date(row.applicationDate) },
    {
      header: "Requested",
      align: "right",
      cell: (row) => money(row.requestedAmountPaise),
    },
    {
      header: "Approved",
      align: "right",
      cell: (row) => money(row.approvedAmountPaise),
    },
    { header: "Status", cell: (row) => row.status },
    { header: "Stage", cell: (row) => row.currentApprovalStage ?? NONE },
    { header: "Rejected because", cell: (row) => row.rejectionReason ?? NONE },
  ];

  return (
    <ReportTable
      rows={report.rows}
      columns={columns}
      rowKey={(row) => row.applicationId}
      totals={report.totals}
      total={report.total}
      page={report.page}
      pageSize={report.pageSize}
      emptyMessage="No applications match these filters."
    />
  );
}

export function DisbursalReportTable({ report }: { report: DisbursalReport }) {
  const columns: Column<DisbursalReport["rows"][number]>[] = [
    { header: "Loan", cell: (row) => row.loanNumber },
    { header: "Customer", cell: (row) => row.customerName },
    { header: "Branch", cell: (row) => row.branchName },
    { header: "Product", cell: (row) => row.loanProductName },
    { header: "Disbursed", cell: (row) => date(row.disbursalDate) },
    {
      header: "Sanctioned",
      align: "right",
      cell: (row) => money(row.sanctionedAmountPaise),
    },
    {
      header: "Disbursed",
      align: "right",
      cell: (row) => money(row.disbursedAmountPaise),
    },
    { header: "Status", cell: (row) => row.status },
    { header: "Mode", cell: (row) => row.paymentMode ?? NONE },
    { header: "Reference", cell: (row) => row.referenceNumber ?? NONE },
  ];

  return (
    <ReportTable
      rows={report.rows}
      columns={columns}
      rowKey={(row) => row.disbursementId}
      totals={report.totals}
      total={report.total}
      page={report.page}
      pageSize={report.pageSize}
      emptyMessage="No disbursals match these filters."
    />
  );
}

export function CollectionReportTable({
  report,
}: {
  report: CollectionReport;
}) {
  const columns: Column<CollectionReport["rows"][number]>[] = [
    { header: "Receipt", cell: (row) => row.receiptNumber ?? NONE },
    { header: "Loan", cell: (row) => row.loanNumber },
    { header: "Customer", cell: (row) => row.customerName },
    { header: "Branch", cell: (row) => row.branchName },
    { header: "Date", cell: (row) => date(row.collectionDate) },
    { header: "Mode", cell: (row) => row.paymentMode },
    {
      header: "Collected",
      align: "right",
      cell: (row) => money(row.collectedAmountPaise),
    },
    // The allocation in the authoritative order — penalty, interest, principal,
    // fees (Rule 21). The column order is the rule made visible.
    {
      header: "Penalty",
      align: "right",
      cell: (row) => money(row.penaltyAllocationPaise),
    },
    {
      header: "Interest",
      align: "right",
      cell: (row) => money(row.interestAllocationPaise),
    },
    {
      header: "Principal",
      align: "right",
      cell: (row) => money(row.principalAllocationPaise),
    },
    {
      header: "Fees",
      align: "right",
      cell: (row) => money(row.feeAllocationPaise),
    },
    { header: "Status", cell: (row) => row.status },
    // Scenario 15: a reversal stays visible and names its counterpart, rather
    // than the pair being netted away.
    { header: "Reversal", cell: (row) => row.reversalReference ?? NONE },
    { header: "Field agent", cell: (row) => row.fieldAgentName ?? NONE },
  ];

  return (
    <ReportTable
      rows={report.rows}
      columns={columns}
      rowKey={(row) => row.collectionId}
      totals={report.totals}
      total={report.total}
      page={report.page}
      pageSize={report.pageSize}
      emptyMessage="No collections match these filters."
    />
  );
}

export function FieldCollectionReportTable({
  report,
}: {
  report: FieldCollectionReport;
}) {
  const columns: Column<FieldCollectionReport["rows"][number]>[] = [
    { header: "Field agent", cell: (row) => row.fieldAgentName },
    { header: "Branch", cell: (row) => row.branchName },
    { header: "Business date", cell: (row) => date(row.businessDate) },
    {
      header: "Collections",
      align: "right",
      cell: (row) => row.collectionCount,
    },
    {
      header: "Collected",
      align: "right",
      cell: (row) => money(row.cashCollectedPaise),
    },
    {
      header: "Handed over",
      align: "right",
      cell: (row) => money(row.cashHandedOverPaise),
    },
    {
      header: "Pending",
      align: "right",
      cell: (row) => money(row.cashPendingPaise),
    },
    {
      header: "Shortage",
      align: "right",
      cell: (row) => money(row.shortagePaise),
    },
    { header: "Excess", align: "right", cell: (row) => money(row.excessPaise) },
    { header: "Reconciliation", cell: (row) => row.reconciliationStatus },
  ];

  return (
    <ReportTable
      rows={report.rows}
      columns={columns}
      rowKey={(row) => `${row.fieldAgentId}-${row.businessDate}`}
      totals={report.totals}
      total={report.total}
      page={report.page}
      pageSize={report.pageSize}
      emptyMessage="No field collections match these filters."
    />
  );
}

export function OverdueReportTable({ report }: { report: OverdueReport }) {
  const columns: Column<OverdueReport["rows"][number]>[] = [
    { header: "Loan", cell: (row) => row.loanNumber },
    { header: "Customer", cell: (row) => row.customerName },
    { header: "Branch", cell: (row) => row.branchName },
    { header: "Oldest due", cell: (row) => date(row.oldestUnpaidDueDate) },
    { header: "DPD", align: "right", cell: (row) => row.daysPastDue },
    {
      header: "Principal",
      align: "right",
      cell: (row) => money(row.overduePrincipalPaise),
    },
    {
      header: "Interest",
      align: "right",
      cell: (row) => money(row.overdueInterestPaise),
    },
    {
      header: "Penalty",
      align: "right",
      cell: (row) => money(row.overduePenaltyPaise),
    },
    {
      header: "Total overdue",
      align: "right",
      cell: (row) => money(row.totalOverduePaise),
    },
    { header: "Bucket", cell: (row) => row.delinquencyBucket },
    { header: "NPA", cell: (row) => row.npaStatus },
    { header: "Officer", cell: (row) => row.recoveryOfficerName ?? NONE },
    { header: "Recovery", cell: (row) => row.recoveryStatus ?? NONE },
    // Shown beside the overdue figures and never subtracted from them
    // (Scenario 23) — a promise is intent, not a payment.
    { header: "Promised on", cell: (row) => date(row.promiseToPayDate) },
    {
      header: "Promised",
      align: "right",
      cell: (row) => money(row.promiseToPayAmountPaise),
    },
  ];

  return (
    <ReportTable
      rows={report.rows}
      columns={columns}
      rowKey={(row) => row.loanId}
      totals={report.totals}
      total={report.total}
      page={report.page}
      pageSize={report.pageSize}
      emptyMessage="Nothing is overdue for these filters."
    />
  );
}

export function FinancialReportTable({ report }: { report: FinancialReport }) {
  const columns: Column<FinancialReport["rows"][number]>[] = [
    { header: "Date", cell: (row) => date(row.businessDate) },
    { header: "Journal", cell: (row) => row.journalReference },
    { header: "Account", cell: (row) => row.accountCode },
    { header: "Account name", cell: (row) => row.accountName },
    { header: "Debit", align: "right", cell: (row) => money(row.debitPaise) },
    { header: "Credit", align: "right", cell: (row) => money(row.creditPaise) },
    {
      header: "Balance",
      align: "right",
      cell: (row) => money(row.runningBalancePaise),
    },
    { header: "Source", cell: (row) => row.sourceModule ?? NONE },
    { header: "Branch", cell: (row) => row.branchName ?? NONE },
    { header: "Reversal", cell: (row) => row.reversalReference ?? NONE },
  ];

  return (
    <ReportTable
      rows={report.rows}
      columns={columns}
      rowKey={(row) => row.journalLineId}
      totals={report.totals}
      total={report.total}
      page={report.page}
      pageSize={report.pageSize}
      emptyMessage="No postings match these filters."
    />
  );
}
