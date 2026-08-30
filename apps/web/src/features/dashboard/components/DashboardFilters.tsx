import type { DashboardLayout } from "@lms/types";
import DateField from "@/components/form/DateField";

/**
 * The period and branch controls.
 *
 * # A plain GET form, with no client state
 *
 * Submitting navigates, the page re-renders as a server component, and every
 * widget is re-fetched with the new filters. There is no client-side request
 * whose ordering could invert, so a slow response for an old period cannot
 * overwrite a newer one — the same reasoning the reports screens follow.
 *
 * # The branch selector is disabled, not hidden, when the caller is confined
 *
 * A branch-confined user sees their branch named and cannot change it. Hiding
 * the control entirely would leave them wondering which branch they are looking
 * at; disabling it answers that and makes the constraint visible. Either way
 * the server refuses another branch (Scenario 7) — this is a courtesy, not the
 * boundary.
 */

interface DashboardFiltersProps {
  layout: DashboardLayout;
  periodType: string;
  fromDate: string;
  toDate: string;
  /** Set when the previous submission was rejected, so it can be shown. */
  error?: string;
}

const PERIODS = [
  { value: "TODAY", label: "Today" },
  { value: "THIS_WEEK", label: "This Week" },
  { value: "THIS_MONTH", label: "This Month" },
  { value: "CUSTOM", label: "Custom Date Range" },
];

export function DashboardFilters({
  layout,
  periodType,
  fromDate,
  toDate,
  error,
}: DashboardFiltersProps) {
  const { scope, availableBranches } = layout;

  return (
    <form
      method="get"
      action="/"
      className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Period
          </span>
          <select
            name="periodType"
            defaultValue={periodType}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          >
            {PERIODS.map((period) => (
              <option key={period.value} value={period.value}>
                {period.label}
              </option>
            ))}
          </select>
        </label>

        {/* Always rendered rather than toggled by script: the page has no
            client-side JavaScript driving this form, and a user switching to
            Custom needs the fields already present to fill in. */}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            From (custom only)
          </span>
          <DateField name="fromDate" defaultValue={fromDate} bare />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            To (custom only)
          </span>
          <DateField name="toDate" defaultValue={toDate} bare />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Branch
          </span>
          <select
            name="branchId"
            defaultValue={scope.branchId ?? ""}
            disabled={scope.branchLocked}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:disabled:bg-gray-800"
          >
            {/* Offered only to a caller who may actually look across branches.
                For a confined caller the single option is their own branch. */}
            {scope.branchLocked ? null : <option value="">All branches</option>}
            {availableBranches.map((branch) => (
              <option key={branch.branchId} value={branch.branchId}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="bg-brand-500 hover:bg-brand-600 rounded-lg px-4 py-2 text-sm font-medium text-white"
        >
          Apply
        </button>
      </div>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Business date {scope.businessDate}
        {scope.branchName ? ` · ${scope.branchName}` : " · All branches"}
      </p>

      {/* Scenario 5: the rejected filter is reported and the previous view is
          still on screen behind it, so nothing was lost. */}
      {error ? (
        <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
