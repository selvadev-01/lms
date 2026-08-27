export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
      <div className="grid grid-cols-12 gap-4 md:gap-6">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="col-span-12 h-40 animate-pulse rounded-2xl bg-gray-200 sm:col-span-6 xl:col-span-3 dark:bg-gray-800"
          />
        ))}
        <div className="col-span-12 h-80 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
      </div>
    </div>
  );
}
