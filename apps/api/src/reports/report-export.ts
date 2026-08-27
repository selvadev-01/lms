import type { ReportMeta } from '@lms/types';

import {
  csvDocument,
  csvRow,
  formatPaise,
  renderPdfTable,
} from '../common/export';

/**
 * Rendering a report as a file.
 *
 * Generic over the eight categories rather than one exporter each: every report
 * is already a `{ meta, rows, totals }` envelope, so the only thing that varies
 * is which columns to pull out of a row. A category supplies that as a
 * `ReportColumn[]`, and both formats render from the same list — which is what
 * stops the CSV and the PDF of the same report from disagreeing about what it
 * contains.
 *
 * The CSV escaping, the UTF-8 BOM and the paginated PDF table all come from
 * `common/export`, shared with Module 10's schedule export.
 */

export interface ReportColumn<TRow> {
  header: string;
  /** Column width in points for the PDF. CSV ignores it. */
  width: number;
  value: (row: TRow) => string;
}

/** A money column, formatted from paise without ever touching `number`. */
export function moneyColumn<TRow>(
  header: string,
  width: number,
  pick: (row: TRow) => string | undefined,
): ReportColumn<TRow> {
  return {
    header,
    width,
    // An absent amount renders as an em dash rather than as `0.00`. Rule 49
    // requires a report to distinguish zero from unavailable, and a column that
    // printed both the same way would report a loan with no penalty and a loan
    // whose penalty is unknown identically.
    value: (row) => {
      const paise = pick(row);
      return paise === undefined ? '—' : formatPaise(paise);
    },
  };
}

/** A plain text column. An absent value renders as an em dash, per Rule 49. */
export function textColumn<TRow>(
  header: string,
  width: number,
  pick: (row: TRow) => string | undefined,
): ReportColumn<TRow> {
  return { header, width, value: (row) => pick(row) ?? '—' };
}

/**
 * The header block both formats carry.
 *
 * Every export states its own scope and basis. A spreadsheet outlives the
 * screen it came from, and a file of numbers with no record of which branch,
 * which dates and which date basis produced them is a file that will eventually
 * be read as answering a question it never answered (Rules 10, 37).
 *
 * `piiMasked` is stated explicitly rather than implied by the masked values, so
 * a reader can tell a masked export from one where the customer names happened
 * to be initials.
 */
function summaryFor(
  title: string,
  meta: ReportMeta,
  totals: Record<string, string | number>,
): [string, string][] {
  return [
    ['Report', title],
    ['Date Basis', meta.dateBasis],
    ['From', meta.fromDate || 'Not bounded'],
    ['To', meta.toDate || 'Not bounded'],
    [
      'Branch',
      meta.branchName ?? (meta.branchId ? meta.branchId : 'All branches'),
    ],
    ['Generated', meta.dataFreshAt],
    ['Customer data', meta.piiMasked ? 'Masked' : 'Full'],
    ...Object.entries(totals).map(([key, value]): [string, string] => [
      humanize(key),
      typeof value === 'number' ? String(value) : formatTotal(key, value),
    ]),
  ];
}

/** `overduePrincipalPaise` reads as `Overdue Principal`. */
function humanize(key: string): string {
  return key
    .replace(/Paise$/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}

/** A total is money when its key says paise, and a count otherwise. */
function formatTotal(key: string, value: string): string {
  return key.endsWith('Paise') ? formatPaise(value) : value;
}

export interface ReportForExport<TRow> {
  title: string;
  meta: ReportMeta;
  rows: TRow[];
  totals: Record<string, string | number>;
  columns: ReportColumn<TRow>[];
}

/** The report as CSV. */
export function reportToCsv<TRow>(report: ReportForExport<TRow>): string {
  const lines: string[] = [];

  for (const [label, value] of summaryFor(
    report.title,
    report.meta,
    report.totals,
  )) {
    lines.push(csvRow([label, value]));
  }
  lines.push('');

  lines.push(csvRow(report.columns.map((column) => column.header)));
  for (const row of report.rows) {
    lines.push(csvRow(report.columns.map((column) => column.value(row))));
  }

  return csvDocument(lines);
}

/** The report as PDF. */
export function reportToPdf<TRow>(
  report: ReportForExport<TRow>,
): Promise<Buffer> {
  return renderPdfTable({
    title: report.title,
    subtitle: `${report.meta.fromDate || 'start'} to ${report.meta.toDate || 'today'} · ${report.rows.length} rows`,
    summary: summaryFor(report.title, report.meta, report.totals),
    columns: report.columns.map((column) => column.header),
    widths: report.columns.map((column) => column.width),
    rows: report.rows.map((row) =>
      report.columns.map((column) => column.value(row)),
    ),
  });
}

/**
 * `Content-Disposition` filename.
 *
 * ASCII-safe by construction: the category is a known enum value and the dates
 * are ISO, so nothing attacker-influenced reaches the header.
 */
export function reportExportFilename(
  meta: ReportMeta,
  format: 'csv' | 'pdf',
): string {
  const slug = meta.category.toLowerCase().replace(/_/g, '-');
  const from = meta.fromDate || 'all';
  const to = meta.toDate || 'all';
  return `${slug}-report-${from}-to-${to}.${format}`;
}
