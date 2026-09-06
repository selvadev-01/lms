import React, { type ReactNode } from "react";

import { cx } from "../../lib/cn";

export interface Column<TRow> {
  /** Stable identity. Also the React key, so it must be unique per table. */
  key: string;
  header: ReactNode;
  align?: "left" | "right" | "center";
  cell: (row: TRow) => ReactNode;
  /**
   * Applies tabular figures and right alignment. Use it for every money,
   * count or date column — proportional digits make a column of amounts
   * visibly ripple and much harder to scan.
   */
  numeric?: boolean;
  /**
   * NOT WIRED UP. No list endpoint in this API accepts a sort parameter, and
   * the DTOs are whitelist-validated so an unknown `?sort` is rejected outright.
   * Sorting only the loaded page would sort 20 of 4,000 rows while looking
   * authoritative — in a lending system that is a defect, not a limitation.
   * The flag exists so columns can be marked as sort candidates for whenever
   * the backend gains support.
   */
  sortable?: boolean;
  /** Drives the small-screen card layout. Defaults to "secondary". */
  priority?: "primary" | "secondary" | "detail";
  width?: string;
}

export interface DataTableProps<TRow> {
  rows: TRow[];
  columns: Column<TRow>[];
  rowKey: (row: TRow) => string;
  /**
   * Rendered when there are no rows. Pass an `EmptyState` — and never use it
   * for a failed load, which must render an error Alert instead. "No customers"
   * when the request actually failed is a lie the reader will act on.
   */
  emptyState: ReactNode;
  /** Screen-reader name for the table. Required: an unnamed table is a maze. */
  caption: string;
  density?: "comfortable" | "compact";
  stickyHeader?: boolean;
  className?: string;
}

const alignClass = (column: Column<unknown>) =>
  column.numeric || column.align === "right"
    ? "text-right"
    : column.align === "center"
      ? "text-center"
      : "text-left";

/**
 * The shared table.
 *
 * Generalised from the reports table, which was the only one of ~30 hand-rolled
 * tables to have an empty state, a scroll container and a row count. The rest
 * each re-implemented the shell and drifted.
 *
 * Pagination lives outside this component: it is URL-driven (the filters
 * already are), so it is a set of links the page owns, not table state.
 */
export function DataTable<TRow>({
  rows,
  columns,
  rowKey,
  emptyState,
  caption,
  density = "comfortable",
  stickyHeader = false,
  className,
}: DataTableProps<TRow>) {
  if (rows.length === 0) return <>{emptyState}</>;

  const cellPad = density === "compact" ? "px-4 py-2" : "px-5 py-3";

  return (
    <div
      className={cx(
        // Wide tables scroll inside their own container so the page body never
        // scrolls sideways. `overflow-y-visible` is required for a sticky
        // header to stick — `overflow-y: auto` would trap it in this box.
        "border-line rounded-panel overflow-x-auto overflow-y-visible border",
        className,
      )}
    >
      <table className="min-w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr
            className={cx(
              "border-line text-ink-muted border-b text-xs tracking-wide uppercase",
              stickyHeader && "bg-surface sticky top-0 z-1",
            )}
          >
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cx(
                  cellPad,
                  "font-medium",
                  alignClass(column as Column<unknown>),
                )}
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
              className="border-line hover:bg-surface-sunken border-b last:border-0"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(
                    cellPad,
                    "text-ink whitespace-nowrap",
                    alignClass(column as Column<unknown>),
                    column.numeric && "tabular",
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
