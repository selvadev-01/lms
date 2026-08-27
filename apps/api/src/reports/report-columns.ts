import type {
  ApplicationReportRow,
  CollectionReportRow,
  DisbursalReportRow,
  FieldCollectionReportRow,
  FinancialReportRow,
  OverdueReportRow,
  PortfolioReportRow,
} from '@lms/types';

import { moneyColumn, textColumn, type ReportColumn } from './report-export';

/**
 * The exported columns for each report category.
 *
 * One list per category, in the order the story's field list names them — so a
 * spreadsheet and the screen read the same way round, which matters more than
 * it sounds when someone is reconciling one against the other by eye.
 *
 * Widths sum to roughly 523 points, the printable width of A4 portrait. They
 * are only used by the PDF; the CSV ignores them.
 *
 * These lists are also the export's PII surface. The *values* arrive already
 * masked — the services apply `maskName` before the row is built, so an export
 * cannot accidentally carry a name the caller could not see on screen. There is
 * deliberately no column here that reaches back to an unmasked source.
 */

export const PORTFOLIO_COLUMNS: ReportColumn<PortfolioReportRow>[] = [
  textColumn('Loan Number', 62, (row) => row.loanNumber),
  textColumn('Customer', 70, (row) => row.customerName),
  textColumn('Branch', 52, (row) => row.branchName),
  textColumn('Product', 52, (row) => row.loanProductName),
  textColumn('Status', 48, (row) => row.status),
  textColumn('Disbursed', 48, (row) => row.disbursementDate),
  moneyColumn('Principal', 60, (row) => row.principalDisbursedPaise),
  moneyColumn('Outstanding', 62, (row) => row.totalOutstandingPaise),
  textColumn('DPD', 24, (row) => String(row.daysPastDue)),
  textColumn('NPA', 45, (row) => row.npaStatus),
];

export const APPLICATION_COLUMNS: ReportColumn<ApplicationReportRow>[] = [
  textColumn('Application', 70, (row) => row.applicationNumber),
  textColumn('Customer', 78, (row) => row.customerName),
  textColumn('Branch', 55, (row) => row.branchName),
  textColumn('Product', 55, (row) => row.loanProductName),
  textColumn('Applied', 52, (row) => row.applicationDate),
  moneyColumn('Requested', 62, (row) => row.requestedAmountPaise),
  moneyColumn('Approved', 62, (row) => row.approvedAmountPaise),
  textColumn('Status', 52, (row) => row.status),
  textColumn('Stage', 37, (row) => row.currentApprovalStage),
];

export const DISBURSAL_COLUMNS: ReportColumn<DisbursalReportRow>[] = [
  textColumn('Loan Number', 66, (row) => row.loanNumber),
  textColumn('Customer', 74, (row) => row.customerName),
  textColumn('Branch', 55, (row) => row.branchName),
  textColumn('Product', 55, (row) => row.loanProductName),
  textColumn('Disbursed', 52, (row) => row.disbursalDate),
  moneyColumn('Sanctioned', 62, (row) => row.sanctionedAmountPaise),
  moneyColumn('Disbursed', 62, (row) => row.disbursedAmountPaise),
  textColumn('Status', 48, (row) => row.status),
  textColumn('Mode', 49, (row) => row.paymentMode),
];

export const COLLECTION_COLUMNS: ReportColumn<CollectionReportRow>[] = [
  textColumn('Receipt', 58, (row) => row.receiptNumber),
  textColumn('Loan', 56, (row) => row.loanNumber),
  textColumn('Customer', 62, (row) => row.customerName),
  textColumn('Date', 46, (row) => row.collectionDate),
  textColumn('Mode', 38, (row) => row.paymentMode),
  moneyColumn('Collected', 55, (row) => row.collectedAmountPaise),
  // The allocation, in the authoritative order: penalty, interest, principal,
  // fees (Rule 21). The column order is the rule made visible.
  moneyColumn('Penalty', 46, (row) => row.penaltyAllocationPaise),
  moneyColumn('Interest', 46, (row) => row.interestAllocationPaise),
  moneyColumn('Principal', 50, (row) => row.principalAllocationPaise),
  moneyColumn('Fees', 40, (row) => row.feeAllocationPaise),
  textColumn('Status', 42, (row) => row.status),
  textColumn('Reversal', 44, (row) => row.reversalReference),
];

export const FIELD_COLLECTION_COLUMNS: ReportColumn<FieldCollectionReportRow>[] =
  [
    textColumn('Field Agent', 78, (row) => row.fieldAgentName),
    textColumn('Branch', 62, (row) => row.branchName),
    textColumn('Business Date', 60, (row) => row.businessDate),
    textColumn('Count', 34, (row) => String(row.collectionCount)),
    moneyColumn('Collected', 62, (row) => row.cashCollectedPaise),
    moneyColumn('Handed Over', 62, (row) => row.cashHandedOverPaise),
    moneyColumn('Pending', 58, (row) => row.cashPendingPaise),
    moneyColumn('Shortage', 52, (row) => row.shortagePaise),
    moneyColumn('Excess', 53, (row) => row.excessPaise),
  ];

export const OVERDUE_COLUMNS: ReportColumn<OverdueReportRow>[] = [
  textColumn('Loan Number', 58, (row) => row.loanNumber),
  textColumn('Customer', 62, (row) => row.customerName),
  textColumn('Branch', 46, (row) => row.branchName),
  textColumn('Oldest Due', 48, (row) => row.oldestUnpaidDueDate),
  textColumn('DPD', 24, (row) => String(row.daysPastDue)),
  moneyColumn('Principal', 52, (row) => row.overduePrincipalPaise),
  moneyColumn('Interest', 48, (row) => row.overdueInterestPaise),
  moneyColumn('Penalty', 46, (row) => row.overduePenaltyPaise),
  moneyColumn('Total', 52, (row) => row.totalOverduePaise),
  textColumn('Bucket', 44, (row) => row.delinquencyBucket),
  textColumn('NPA', 43, (row) => row.npaStatus),
];

export const FINANCIAL_COLUMNS: ReportColumn<FinancialReportRow>[] = [
  textColumn('Date', 50, (row) => row.businessDate),
  textColumn('Journal', 62, (row) => row.journalReference),
  textColumn('Account', 48, (row) => row.accountCode),
  textColumn('Account Name', 82, (row) => row.accountName),
  moneyColumn('Debit', 62, (row) => row.debitPaise),
  moneyColumn('Credit', 62, (row) => row.creditPaise),
  textColumn('Source', 56, (row) => row.sourceModule),
  textColumn('Branch', 56, (row) => row.branchName),
  textColumn('Reversal', 45, (row) => row.reversalReference),
];
