/**
 * Shown while the check-in status is fetched from the API.
 *
 * Mirrors the card shape of the loaded panel so the layout does not jump when
 * the status arrives.
 */
export default function Loading() {
  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">
        Checking your location verification status…
      </span>

      <div className="mb-3 h-6 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      <div className="mb-8 h-4 w-72 animate-pulse rounded bg-gray-100 dark:bg-gray-800/60" />
      <div
        className="h-11 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800"
        aria-hidden="true"
      />
    </div>
  );
}
