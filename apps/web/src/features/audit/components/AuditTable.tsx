import { Badge } from "@lms/ui";
import type { AuditEventListResult } from "@lms/types";
import Link from "next/link";

/**
 * The audit trail (Scenarios 36-38).
 *
 * A server component with no client interactivity, and no action of any kind.
 * That absence is deliberate: Rules 46 and 47 make the trail immutable to
 * application users, so there is no edit affordance here to be re-enabled later
 * by someone who assumes one was merely forgotten.
 *
 * Filters live in the URL rather than component state, following the master-data
 * precedent — the page is a server component and a filter in local state would
 * be lost on every navigation.
 */
export default function AuditTable({
  result,
  loadError = false,
}: {
  result: AuditEventListResult | null;
  loadError?: boolean;
}) {
  if (loadError || !result) {
    return (
      <p className="text-error-500 text-sm">
        We could not load the audit trail. Refresh to try again.
      </p>
    );
  }

  if (result.items.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No audit events match these filters.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-gray-200 text-xs text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {result.items.map((event) => (
              <tr
                key={event.auditId}
                className="border-b border-gray-100 dark:border-gray-800"
              >
                <td className="px-3 py-3 text-xs whitespace-nowrap text-gray-600 dark:text-gray-300">
                  {new Date(event.occurredAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}
                </td>
                <td className="px-3 py-3">
                  <span className="font-mono text-xs">{event.action}</span>
                </td>
                <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-300">
                  {event.entityType}
                </td>
                <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-300">
                  {/* A scheduled run has no human actor (Rule 63). Saying so
                      beats an empty cell that reads as missing data. */}
                  {event.actorName ?? <Badge color="light">System</Badge>}
                </td>
                <td className="px-3 py-3 text-right">
                  <Link
                    href={`/admin/audit/${event.auditId}`}
                    className="text-brand-500 text-xs font-medium hover:underline"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Showing {result.items.length} of {result.total} events (page{" "}
        {result.page}).
      </p>
    </div>
  );
}
