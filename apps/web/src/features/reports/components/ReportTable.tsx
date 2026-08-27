import type { ReactNode } from "react";

import { formatPaise } from "@/lib/format";

/**
 * The table every tabular report renders into.
 *
 * Generic over the row, because the eight categories differ only in their
 * columns — and the pagination, the empty state, the totals footer and the
 * horizontal scroll behave identically in all of them. Eight copies of this
 * would be eight places for the totals footer to drift out of step with the
 * rows above it.
 *
 * A server component; pure render. Nothing here computes a figure: the totals
 * arrive already summed over the whole filtered dataset (Rule 35), and summing
 * the visible page in the browser would produce a number that looks like the
 * same assertion and is not.
 */

export interface Column<TRow> {
  header: string;
  /** Right-aligned by default for money; set explicitly otherwise. */
  align?: "left" | "right";
  cell: (row: TRow) => ReactNode;
}

export default function ReportTable<TRow>({
  rows,
  columns,
  rowKey,
  totals,
  total,
  page,
  pageSize,
  emptyMessage,
}: {
  rows: TRow[];
  columns: Column<TRow>[];
  rowKey: (row: TRow) => string;
  totals?: Record<string, string | number>;
  total: number;
  page: number;
  pageSize: number;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        {emptyMessage}
      </p>
    );
  }

  const firstRow = (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <div className="space-y-4">
      {totals && <TotalsStrip totals={totals} />}

      {/* Wide reports scroll inside their own container; the page never does. */}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
              {columns.map((column) => (
                <th
                  key={column.header}
                  className={`px-5 py-3 font-medium ${
                    column.align === "right" ? "text-right" : ""
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-gray-100 last:border-0 dark:border-gray-800"
              >
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={`px-5 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300 ${
                      column.align === "right" ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Showing {firstRow}–{lastRow} of {total}
      </p>
    </div>
  );
}

/**
 * The report's totals, over the whole filtered dataset.
 *
 * Labelled "across all matching rows" rather than left bare, because a reader
 * looking at page two of twelve would otherwise reasonably take these for the
 * page's totals — and acting on that misreading is exactly the harm Rule 35
 * exists to prevent.
 */
function TotalsStrip({ totals }: { totals: Record<string, string | number> }) {
  const entries = Object.entries(totals);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
      <p className="mb-3 text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
        Totals across all matching rows
      </p>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs text-gray-500 dark:text-gray-400">
              {humanize(key)}
            </dt>
            <dd className="text-sm font-semibold text-gray-800 tabular-nums dark:text-white/90">
              {formatTotal(key, value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** `overduePrincipalPaise` reads as `Overdue Principal`. */
function humanize(key: string): string {
  return key
    .replace(/Paise$/, "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}

/** A total is money when its key says paise, and a count otherwise. */
function formatTotal(key: string, value: string | number): string {
  if (typeof value === "number") return String(value);
  return key.endsWith("Paise") ? formatPaise(value) : value;
}
