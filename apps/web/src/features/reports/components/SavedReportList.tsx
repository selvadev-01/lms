import type { SavedReportListResult } from "@lms/types";

import { formatDate } from "@/lib/format";

/**
 * Saved report definitions.
 *
 * A definition is a stored filter set, not a stored result: opening one runs
 * the report fresh against the caller's own authorization, so a report saved by
 * an organization-wide user and opened by a branch user shows that branch's
 * rows (Rules 4, 27; Scenario 43). The "Run" link therefore carries the saved
 * filters and nothing about scope — the server decides that on arrival.
 *
 * Inactive definitions stay listed rather than being hidden. Scenario 41 keeps
 * their history available while blocking new output, and a row that vanished on
 * deactivation would leave the user unable to see what they had turned off.
 */
export default function SavedReportList({
  result,
}: {
  result: SavedReportListResult;
}) {
  if (result.items.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        You have no saved reports yet. Apply filters on any report and save them
        to return to the same view later.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
            <th className="px-5 py-3 font-medium">Name</th>
            <th className="px-5 py-3 font-medium">Report</th>
            <th className="px-5 py-3 font-medium">Visibility</th>
            <th className="px-5 py-3 font-medium">Owner</th>
            <th className="px-5 py-3 font-medium">Branch</th>
            <th className="px-5 py-3 font-medium">Last run</th>
            <th className="px-5 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {result.items.map((item) => (
            <tr
              key={item.reportDefinitionId}
              className="border-b border-gray-100 last:border-0 dark:border-gray-800"
            >
              <td className="px-5 py-3 text-gray-800 dark:text-white/90">
                {item.name}
              </td>
              <td className="px-5 py-3 text-gray-700 dark:text-gray-300">
                {categoryLabel(item.category)}
              </td>
              <td className="px-5 py-3 text-gray-700 dark:text-gray-300">
                {item.visibility === "SHARED" ? "Shared" : "Private"}
              </td>
              <td className="px-5 py-3 text-gray-700 dark:text-gray-300">
                {item.ownerName ?? "—"}
              </td>
              <td className="px-5 py-3 text-gray-700 dark:text-gray-300">
                {item.branchName ?? "All branches"}
              </td>
              <td className="px-5 py-3 text-gray-700 dark:text-gray-300">
                {item.lastRunAt ? formatDate(item.lastRunAt) : "Never"}
              </td>
              <td className="px-5 py-3">
                <span
                  className={
                    item.status === "ACTIVE"
                      ? "rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/10 dark:text-green-400"
                      : "rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  }
                >
                  {item.status === "ACTIVE" ? "Active" : "Inactive"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function categoryLabel(category: string): string {
  switch (category) {
    case "DASHBOARD":
      return "Dashboard";
    case "PORTFOLIO":
      return "Loan Portfolio";
    case "APPLICATIONS":
      return "Applications";
    case "DISBURSALS":
      return "Disbursal";
    case "COLLECTIONS":
      return "Repayment & Collections";
    case "FIELD_COLLECTIONS":
      return "Field Collection & Reconciliation";
    case "OVERDUE_RECOVERY":
      return "Overdue & Recovery";
    case "FINANCIAL":
      return "Financial";
    default:
      return category;
  }
}
