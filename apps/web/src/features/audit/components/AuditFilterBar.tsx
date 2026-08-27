/**
 * Audit filters (Scenario 38).
 *
 * A plain `<form method="get">` rather than a client component: the page is a
 * server component that re-renders from `searchParams`, so the filters ARE the
 * URL. That also makes a filtered view linkable and bookmarkable, which matters
 * for an auditor citing what they looked at.
 *
 * Filtering is enforced server-side regardless of what is sent here — a
 * branch-confined reader is narrowed whatever they ask for.
 */
export default function AuditFilterBar({
  filters,
  exportHref,
  canExport = false,
}: {
  filters: {
    action?: string;
    entityType?: string;
    from?: string;
    to?: string;
  };
  exportHref: string;
  canExport?: boolean;
}) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
    >
      <label className="text-xs text-gray-600 dark:text-gray-300">
        <span className="mb-1 block">Action</span>
        <input
          type="text"
          name="action"
          defaultValue={filters.action ?? ""}
          placeholder="SETTING_UPDATED"
          className="h-9 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <label className="text-xs text-gray-600 dark:text-gray-300">
        <span className="mb-1 block">Entity type</span>
        <input
          type="text"
          name="entityType"
          defaultValue={filters.entityType ?? ""}
          placeholder="setting"
          className="h-9 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <label className="text-xs text-gray-600 dark:text-gray-300">
        <span className="mb-1 block">From</span>
        <input
          type="date"
          name="from"
          defaultValue={filters.from ?? ""}
          className="h-9 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <label className="text-xs text-gray-600 dark:text-gray-300">
        <span className="mb-1 block">To</span>
        <input
          type="date"
          name="to"
          defaultValue={filters.to ?? ""}
          className="h-9 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <button
        type="submit"
        className="h-9 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600"
      >
        Filter
      </button>

      {/* A plain link, not a fetch: the browser downloads the CSV directly and
          the cookie goes with it. The export is refused server-side without
          `audit.export` (Scenario 42), and it audits itself before writing a
          byte (Rule 57). */}
      {canExport ? (
        <a
          href={exportHref}
          className="h-9 rounded-lg border border-gray-300 px-4 text-sm font-medium leading-9 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Export CSV
        </a>
      ) : null}
    </form>
  );
}
