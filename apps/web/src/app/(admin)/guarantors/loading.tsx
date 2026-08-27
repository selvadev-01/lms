/**
 * Shown while guarantors are fetched from the API.
 *
 * Mirrors the search bar and table shape of the loaded screen so the layout does
 * not jump when the data arrives.
 */
export default function Loading() {
  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading guarantors…</span>

      <div className="mb-8 h-11 w-full max-w-md animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="h-12 animate-pulse rounded bg-gray-100 dark:bg-gray-800/60"
          />
        ))}
      </div>
    </div>
  );
}
