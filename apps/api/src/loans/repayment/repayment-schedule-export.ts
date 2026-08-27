import type { EmiRow, RepaymentScheduleView } from '@lms/types';

import {
  csvDocument,
  csvRow,
  formatBps,
  formatPaise,
  renderPdfTable,
} from '../../common/export';

/**
 * Module 10 — repayment schedule export.
 *
 * Both formats render the same `RepaymentScheduleView` the screen renders, so
 * the three surfaces cannot disagree about what a borrower owes. Rendering
 * happens server-side for both, which is what makes scoping, permission and
 * audit identical whether the caller wanted a spreadsheet or a document — and
 * what would let the same bytes be emailed by Module 16 later.
 *
 * The formatting, CSV escaping and PDF table now live in `common/export`, which
 * Module 15 shares. `formatPaise` and `formatBps` are re-exported here because
 * this module's spec and callers already import them from this path, and moving
 * a helper is not a reason to churn every call site.
 */

export { formatBps, formatPaise };

const COLUMNS = [
  '#',
  'Due Date',
  'Opening Principal',
  'Principal',
  'Interest',
  'EMI Amount',
  'Paid',
  'Outstanding',
  'Status',
] as const;

function cellsFor(emi: EmiRow): string[] {
  return [
    String(emi.installmentNumber),
    emi.dueDate,
    formatPaise(emi.openingPrincipalPaise),
    formatPaise(emi.principalDuePaise),
    formatPaise(emi.interestDuePaise),
    formatPaise(emi.totalDuePaise),
    formatPaise(emi.paidAmountPaise),
    formatPaise(emi.outstandingAmountPaise),
    emi.effectiveStatus,
  ];
}

/**
 * The schedule as CSV.
 *
 * CRLF line endings and a UTF-8 BOM come from `csvDocument`, because the file
 * is opened in Excel far more often than it is parsed: without the BOM, Excel
 * reads UTF-8 as the system codepage and mangles any non-ASCII customer name.
 */
export function toCsv(view: RepaymentScheduleView): string {
  const lines: string[] = [];

  lines.push(csvRow(['Loan Number', view.loan.loanNumber]));
  lines.push(csvRow(['Customer', view.loan.customerName]));
  lines.push(csvRow(['Branch', view.loan.branchName]));
  lines.push(csvRow(['Loan Status', view.loan.status]));
  lines.push(
    csvRow(['Principal Amount', formatPaise(view.loan.principalAmountPaise)]),
  );
  lines.push(
    csvRow(['Interest Rate (%)', formatBps(view.loan.interestRateBps)]),
  );
  lines.push(csvRow(['Interest Method', view.loan.interestType]));
  lines.push(csvRow(['Repayment Frequency', view.loan.repaymentFrequency]));
  lines.push(csvRow(['Loan Duration', String(view.loan.durationCount)]));
  lines.push(csvRow(['Disbursement Date', view.loan.disbursementDate ?? '']));
  lines.push(csvRow(['Schedule Version', String(view.version)]));
  lines.push(csvRow(['Schedule Status', view.status]));
  lines.push(csvRow(['Generated At', view.generatedAt]));
  lines.push('');

  lines.push(csvRow(['Total EMI Count', String(view.totals.installmentCount)]));
  lines.push(
    csvRow(['Total Principal', formatPaise(view.totals.totalPrincipalPaise)]),
  );
  lines.push(
    csvRow(['Total Interest', formatPaise(view.totals.totalInterestPaise)]),
  );
  lines.push(
    csvRow(['Total Payable', formatPaise(view.totals.totalPayablePaise)]),
  );
  lines.push(csvRow(['Total Paid', formatPaise(view.totals.totalPaidPaise)]));
  lines.push(
    csvRow(['Outstanding', formatPaise(view.totals.outstandingPaise)]),
  );
  lines.push(csvRow(['Next EMI Date', view.totals.nextDueDate ?? '']));
  lines.push('');

  lines.push(csvRow([...COLUMNS]));
  for (const emi of view.installments) {
    lines.push(csvRow(cellsFor(emi)));
  }

  return csvDocument(lines);
}

/** Column widths in points, summing to the printable width of A4 portrait. */
const WIDTHS = [24, 60, 78, 66, 60, 66, 60, 72, 57] as const;

/**
 * The schedule as a PDF.
 *
 * The page-breaking table lives in `common/export`; what stays here is only
 * what is specific to a repayment schedule — its title, its summary block and
 * its columns.
 */
export function toPdf(view: RepaymentScheduleView): Promise<Buffer> {
  return renderPdfTable({
    title: 'Repayment Schedule',
    subtitle: `Loan ${view.loan.loanNumber} · Version ${view.version} · ${view.status}`,
    summary: [
      ['Customer', view.loan.customerName],
      ['Branch', view.loan.branchName],
      ['Principal Amount', formatPaise(view.loan.principalAmountPaise)],
      ['Interest Rate', `${formatBps(view.loan.interestRateBps)}%`],
      ['Interest Method', view.loan.interestType],
      ['Repayment Frequency', view.loan.repaymentFrequency],
      ['Loan Duration', `${view.loan.durationCount} periods`],
      ['Disbursement Date', view.loan.disbursementDate ?? '—'],
      ['Total EMI Count', String(view.totals.installmentCount)],
      ['Total Principal', formatPaise(view.totals.totalPrincipalPaise)],
      ['Total Interest', formatPaise(view.totals.totalInterestPaise)],
      ['Total Payable', formatPaise(view.totals.totalPayablePaise)],
      ['Total Paid', formatPaise(view.totals.totalPaidPaise)],
      ['Outstanding', formatPaise(view.totals.outstandingPaise)],
      ['Next EMI Date', view.totals.nextDueDate ?? '—'],
    ],
    columns: COLUMNS,
    widths: WIDTHS,
    rows: view.installments.map(cellsFor),
  });
}

/** `Content-Disposition` filename. Loan numbers are `LN-000001`, so ASCII-safe. */
export function exportFilename(
  view: RepaymentScheduleView,
  format: 'csv' | 'pdf',
): string {
  const safe = view.loan.loanNumber.replace(/[^A-Za-z0-9-]/g, '');
  return `repayment-schedule-${safe}-v${view.version}.${format}`;
}
