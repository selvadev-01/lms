import React from "react";

/**
 * One labelled value in a read-only view.
 *
 * The `<dl>/<dt>/<dd>` markup was hand-written in eight components before this
 * existed, and the read views this file was extracted for would have made it ten.
 * The semantics matter as much as the styling: a term-and-definition pair is what
 * a screen reader needs to announce "Mobile Number, 9999995685" rather than two
 * unrelated strings.
 *
 * Wrap a group in `<ReadFields>` rather than a bare `<dl>`, so the grid and the
 * pair markup stay together.
 */
export function ReadField({
  label,
  value,
}: {
  label: string;
  /** Null and empty both render an em dash — "not recorded", said visibly. */
  value: string | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-800 dark:text-white/90">
        {value ? value : "—"}
      </dd>
    </div>
  );
}

/** A responsive grid of `ReadField`s. */
export function ReadFields({
  children,
  columns = 2,
}: {
  children: React.ReactNode;
  columns?: 2 | 3;
}) {
  return (
    <dl
      className={`grid gap-4 ${
        columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
      }`}
    >
      {children}
    </dl>
  );
}
