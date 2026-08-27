/**
 * Shown while an option list is fetched from the API.
 *
 * Mirrors the tab strip and row shape of the loaded screen so the layout does
 * not jump when the data arrives.
 */
export default function Loading() {
  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading option values…</span>

      <div className="mb-6 flex gap-2" aria-hidden="true">
        {[0, 1, 2, 3].map((tab) => (
          <div
            key={tab}
            className="h-8 w-32 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800"
          />
        ))}
      </div>
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="h-14 animate-pulse rounded bg-gray-100 dark:bg-gray-800/60"
          />
        ))}
      </div>
    </div>
  );
}
