import React, { type ReactNode } from "react";

import { cx } from "../../lib/cn";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** A create button, or a "Clear filters" link. */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/**
 * Shown when a list has nothing to show.
 *
 * Keeps the existing convention: `role="status"` so the outcome of a search is
 * announced, since visually the result is just an absence.
 *
 * IMPORTANT: an empty result and a failed load are different things and must
 * look different. A failed load renders an `Alert variant="error"`, never this
 * — telling someone "no customers found" when the request actually failed is a
 * lie they will act on.
 *
 * Prefer `NoResults` below when filters are active: offering "Clear filters"
 * is far more useful than repeating that nothing matched.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cx(
        "border-line rounded-panel flex flex-col items-center border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="text-ink-subtle mb-3" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="text-ink text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-ink-muted mt-1 max-w-sm text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * The filtered-to-nothing variant. `clearHref` should be the bare pathname, so
 * following it drops every filter param — this app keeps filters in the URL.
 */
export function NoResults({
  clearHref,
  linkComponent: Link = "a",
  className,
}: {
  clearHref: string;
  linkComponent?: React.ElementType;
  className?: string;
}) {
  return (
    <EmptyState
      className={className}
      title="No matches"
      description="No records match the current filters."
      action={
        <Link
          href={clearHref}
          className="text-accent text-sm underline-offset-4 hover:underline"
        >
          Clear filters
        </Link>
      }
    />
  );
}

export default EmptyState;
