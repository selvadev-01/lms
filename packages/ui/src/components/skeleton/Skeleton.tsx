import React from "react";

import { cx } from "../../lib/cn";

/**
 * A loading placeholder.
 *
 * Deliberately NOT announced: the surrounding `loading.tsx` already carries
 * `role="status" aria-live="polite"` and an `sr-only` message. Marking each bar
 * as well would announce a dozen meaningless "loading" strings, so every
 * skeleton element is `aria-hidden`.
 */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        "bg-surface-sunken animate-pulse rounded",
        // `animate-pulse` is neutralised by the reduced-motion block in the
        // design tokens, leaving a static grey block. That is the correct
        // fallback: still legible as "not loaded yet".
        className,
      )}
      {...rest}
    />
  );
}

/**
 * Table-shaped placeholder. `columns` should match the real table so the
 * layout does not jump when data lands.
 */
export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cx("space-y-3", className)} aria-hidden="true">
      <div className="flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonPanel({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        "border-line bg-surface rounded-panel space-y-4 border p-5 lg:p-6",
        className,
      )}
      aria-hidden="true"
    >
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

export default Skeleton;
