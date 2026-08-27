/**
 * Shown while the reporting dashboard is generated.
 *
 * Mirrors the shape of the loaded screen — a filter bar above a table — so the
 * layout does not jump when the rows arrive.
 */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Generating the reporting dashboard…</span>

      <div
        className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
        aria-hidden="true"
      >
        <div className="h-11 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800/60" />
      </div>

      <div
        className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
        aria-hidden="true"
      >
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="h-12 animate-pulse rounded bg-gray-100 dark:bg-gray-800/60"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
