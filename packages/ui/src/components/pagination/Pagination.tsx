import React from "react";

import { cx } from "../../lib/cn";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /**
   * Builds the href for a page. Callers keep every existing filter param and
   * change only `page` — pagination that silently drops the active filters is
   * worse than no pagination.
   */
  hrefFor: (page: number) => string;
  linkComponent?: React.ElementType;
  className?: string;
}

/**
 * Link-based pagination.
 *
 * Anchors rather than buttons, deliberately: this app keeps list state in the
 * URL, so a page is a real address. That makes it shareable, back/forward
 * works, and it still functions if JavaScript has not loaded — which matters on
 * the field routes.
 *
 * The "Showing x–y of z" wording is carried over verbatim from the reports
 * table so nothing regresses for readers used to it.
 */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
  linkComponent: Link = "a",
  className,
}: PaginationProps) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const linkClass =
    "border-line text-ink hover:bg-surface-sunken focus-visible:ring-focus rounded-control border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none";
  // A disabled anchor is not a thing, so the edge cases render as plain text
  // rather than a link that goes nowhere.
  const mutedClass =
    "border-line text-ink-subtle rounded-control border px-3 py-1.5 text-sm";

  return (
    <nav
      aria-label="Pagination"
      className={cx(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      <p className="text-ink-muted text-sm">
        Showing {first}–{last} of {total}
      </p>

      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} rel="prev" className={linkClass}>
            Previous
          </Link>
        ) : (
          <span className={mutedClass}>Previous</span>
        )}

        <span className="text-ink-muted text-sm" aria-current="page">
          Page {page} of {lastPage}
        </span>

        {page < lastPage ? (
          <Link href={hrefFor(page + 1)} rel="next" className={linkClass}>
            Next
          </Link>
        ) : (
          <span className={mutedClass}>Next</span>
        )}
      </div>
    </nav>
  );
}

export default Pagination;
