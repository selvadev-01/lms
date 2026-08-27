import Link from "next/link";
import type { DashboardWidget } from "@lms/types";

/**
 * The frame every widget renders inside.
 *
 * # Four statuses, four different things on screen
 *
 * This component is where Scenarios 35-38 become visible. The four arms of
 * `DashboardWidget` are rendered as four distinguishable states, because the
 * whole point of keeping them separate in the type is lost if they all look
 * alike:
 *
 *  - `AVAILABLE` — the figures.
 *  - `NO_DATA` — a plain sentence saying there is nothing, with the filters
 *    left alone so the reader can widen them (Scenario 35).
 *  - `FAILED` — an error card and a Retry link. Never a zero: the union has no
 *    `data` on this arm, so there is nothing here that could render as one
 *    (Scenario 36).
 *  - `STALE` — the figures *and* a badge saying what is behind (Scenario 38).
 *
 * # Retry is a link, not a button
 *
 * Scenario 37 asks for a retry that reloads the applicable widget. A plain
 * navigation back to the page does that: the page is a server component, so
 * every widget is re-fetched and this one gets a fresh attempt. A client-side
 * refetch would be faster and would introduce exactly the stale-response
 * ordering problem the server round-trip currently makes impossible.
 */

interface WidgetShellProps {
  widget: DashboardWidget<unknown>;
  /** Preserved so Retry returns to the period and branch the user had set. */
  query?: string;
  children: React.ReactNode;
}

export function WidgetShell({ widget, query, children }: WidgetShellProps) {
  const { meta } = widget;

  return (
    <section
      aria-labelledby={`widget-${meta.widgetCode}`}
      className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2
            id={`widget-${meta.widgetCode}`}
            className="text-base font-semibold text-gray-800 dark:text-white/90"
          >
            {meta.title}
          </h2>
          {/* Names the owning module and whether the period applied, so a
              reader can tell what the figures mean without asking. */}
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {meta.periodNote}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {widget.status === "STALE" ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
              Partial
            </span>
          ) : null}
          <Link
            href={meta.drillDownHref}
            className="text-brand-500 hover:text-brand-600 text-xs font-medium"
          >
            View details
          </Link>
        </div>
      </header>

      {widget.status === "FAILED" ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
          <p className="text-sm font-medium text-red-800 dark:text-red-400">
            {widget.message}
          </p>
          {widget.retryable ? (
            <Link
              href={`/${query ? `?${query}` : ""}`}
              className="mt-2 inline-block text-xs font-medium text-red-800 underline dark:text-red-400"
            >
              Retry
            </Link>
          ) : null}
        </div>
      ) : null}

      {widget.status === "NO_DATA" ? (
        <p className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {widget.message}
        </p>
      ) : null}

      {widget.status === "STALE" ? (
        <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
          {widget.staleReason}
        </p>
      ) : null}

      {widget.status === "AVAILABLE" || widget.status === "STALE"
        ? children
        : null}
    </section>
  );
}

/**
 * A widget whose request never returned.
 *
 * Distinct from a `FAILED` envelope: that is the server saying a source is
 * down, this is the request itself failing. Both must render as an error rather
 * than as absence, so that a widget the user expected cannot silently vanish.
 */
export function WidgetFetchError({
  title,
  query,
}: {
  title: string;
  query?: string;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
        {title}
      </h2>
      <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
        <p className="text-sm font-medium text-red-800 dark:text-red-400">
          This widget could not be loaded.
        </p>
        <Link
          href={`/${query ? `?${query}` : ""}`}
          className="mt-2 inline-block text-xs font-medium text-red-800 underline dark:text-red-400"
        >
          Retry
        </Link>
      </div>
    </section>
  );
}

/** One labelled figure. `—` for an absent value, never a zero. */
export function Metric({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string | number | null;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd
        className={
          emphasis
            ? "mt-0.5 text-lg font-semibold text-gray-800 dark:text-white/90"
            : "mt-0.5 text-sm font-medium text-gray-800 dark:text-white/90"
        }
      >
        {/* A null figure is one the caller may not see or nobody has produced.
            Rendering it as 0 would be a claim about data we do not have. */}
        {value === null ? "—" : value}
      </dd>
    </div>
  );
}
