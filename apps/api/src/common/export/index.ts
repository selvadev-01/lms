/**
 * Shared export primitives.
 *
 * Module 10 exports a repayment schedule; Module 15 exports seven report
 * categories. Both render server-side so that scope, permission and audit are
 * identical whichever format the caller asked for — and both need the same
 * three things: money formatted without ever touching `number`, CSV fields
 * escaped with formula injection disarmed, and a table that breaks across
 * pages. They live here so there is one copy of each.
 */

export { formatBps, formatPaise } from './money-format';
export { csvDocument, csvField, csvRow } from './csv';
export { renderPdfTable, type PdfTableSpec } from './pdf-table';
