/**
 * Shown while the sync queue are fetched.
 *
 * Mirrors the table shape of the loaded screen so the layout does not jump when
 * the data arrives.
 */
export default function Loading() {
  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading the sync queue…</span>

      <div className="mb-6 h-5 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="h-12 animate-pulse rounded bg-gray-100 dark:bg-gray-800/60"
          />
        ))}
      </div>
    </div>
  );
}
