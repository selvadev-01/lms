import type { ReportMeta } from "@lms/types";
import DateField from "@/components/form/DateField";

/**
 * The filter bar every tabular report carries.
 *
 * A plain GET form, submitted to the same route. That is deliberate rather than
 * lazy: the page is a server component reading `searchParams`, so the browser
 * owns no request state, and Scenario 58 — a stale response must not overwrite
 * a newer visible result — cannot happen because there is no second in-flight
 * request whose ordering could invert.
 *
 * `dateBasis` is a hidden field rather than a select. Each category permits a
 * fixed set (Rule 11), the server refuses anything else, and offering a
 * dropdown of one option would be a control that cannot be used. A category
 * that grows a second permitted basis turns this into a select.
 */
export default function ReportFilters({
  meta,
  fromDate,
  toDate,
  search,
  searchLabel = "Search",
  searchPlaceholder,
  exportPath,
  canExport,
}: {
  meta: ReportMeta;
  fromDate?: string;
  toDate?: string;
  search?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  /** `/api/v1`-relative export path, e.g. `reports/portfolio/export`. */
  exportPath: string;
  canExport: boolean;
}) {
  const exportQuery = new URLSearchParams();
  if (fromDate) exportQuery.set("fromDate", fromDate);
  if (toDate) exportQuery.set("toDate", toDate);
  if (search) exportQuery.set("search", search);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <form className="flex flex-wrap items-end gap-4" method="get">
        <div>
          <label
            htmlFor="report-from"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            From
          </label>
          <DateField
            id="report-from"
            name="fromDate"
            defaultValue={fromDate}
            bare
          />
        </div>

        <div>
          <label
            htmlFor="report-to"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            To
          </label>
          <DateField id="report-to" name="toDate" defaultValue={toDate} bare />
        </div>

        <div className="min-w-[14rem] flex-1">
          <label
            htmlFor="report-search"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            {searchLabel}
          </label>
          <input
            id="report-search"
            name="search"
            type="search"
            defaultValue={search}
            placeholder={searchPlaceholder}
            className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
          />
        </div>

        {/*
          A plain `<button>` rather than the shared `Button`, which has no
          `type` prop and renders as `submit` — correct here, but the export
          link below is an anchor for the same reason in reverse: a download is
          a navigation, not a form submission.
        */}
        <button
          type="submit"
          className="bg-brand-500 hover:bg-brand-600 h-11 rounded-lg px-5 text-sm font-medium text-white"
        >
          Apply
        </button>

        {canExport && (
          <div className="flex gap-2">
            <a
              href={`/api/v1/${exportPath}?${exportQuery.toString()}&format=csv`}
              className="flex h-11 items-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
            >
              Export CSV
            </a>
            <a
              href={`/api/v1/${exportPath}?${exportQuery.toString()}&format=pdf`}
              className="flex h-11 items-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
            >
              Export PDF
            </a>
          </div>
        )}
      </form>

      <ReportMetaLine meta={meta} />
    </div>
  );
}

/**
 * What the report says about itself.
 *
 * Rule 10 requires every report to declare its date basis and Rule 37 requires
 * a freshness indicator wherever data is aggregated. Both are stated here
 * rather than left implicit, and so is the masking state — Rule 49 wants a
 * reader able to tell a masked value from an absent one, which means saying
 * that masking is in effect rather than leaving them to infer it from initials.
 */
export function ReportMetaLine({ meta }: { meta: ReportMeta }) {
  return (
    <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
      Filtered by{" "}
      <span className="font-medium">{basisLabel(meta.dateBasis)}</span>
      {meta.branchId ? (
        <> · {meta.branchName ?? "one branch"}</>
      ) : (
        <> · all branches</>
      )}{" "}
      · data as at{" "}
      <time dateTime={meta.dataFreshAt}>
        {new Date(meta.dataFreshAt).toLocaleString("en-IN")}
      </time>
      {meta.piiMasked && (
        <> · customer details are masked for your permissions</>
      )}
    </p>
  );
}

function basisLabel(basis: ReportMeta["dateBasis"]): string {
  switch (basis) {
    case "APPLICATION_DATE":
      return "application date";
    case "DISBURSAL_DATE":
      return "disbursal date";
    case "DUE_DATE":
      return "EMI due date";
    case "COLLECTION_DATE":
      return "collection date";
    case "ACCOUNTING_DATE":
      return "accounting business date";
    case "BUSINESS_DATE":
      return "business date";
  }
}
