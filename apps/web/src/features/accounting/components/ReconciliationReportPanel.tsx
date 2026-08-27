import type { ReconciliationFinding, ReconciliationReport } from "@lms/types";
import { Alert } from "@lms/ui";

import { formatDate } from "@/lib/format";

/**
 * What reconciliation found.
 *
 * A server component; pure render. There is no "fix" control on this screen and
 * none behind it — the API has no write path at all. Scenario 59 requires that
 * the system not "silently fabricate a balancing entry" and Scenario 60 that it
 * not "automatically delete historical records", and the way to guarantee both
 * is for the code to be incapable of acting. A finding is an instruction to a
 * person.
 */

function FindingGroup({
  title,
  explanation,
  findings,
}: {
  title: string;
  explanation: string;
  findings: ReconciliationFinding[];
}) {
  if (findings.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
        {title} ({findings.length})
      </h3>
      <p className="mt-1 mb-4 text-xs text-gray-500 dark:text-gray-400">
        {explanation}
      </p>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
              <th className="px-5 py-3 font-medium">Module</th>
              <th className="px-5 py-3 font-medium">Reference</th>
              <th className="px-5 py-3 font-medium">Occurred</th>
              <th className="px-5 py-3 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding) => (
              <tr
                key={`${finding.kind}-${finding.sourceId}`}
                className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
              >
                <td className="px-5 py-3 text-gray-800 dark:text-white/90">
                  {finding.sourceModule}
                </td>
                <td className="px-5 py-3 text-gray-500 tabular-nums dark:text-gray-400">
                  {finding.sourceReference ?? finding.sourceId}
                </td>
                <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                  {formatDate(finding.occurredOn)}
                </td>
                <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                  {finding.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ReconciliationReportPanel({
  report,
}: {
  report: ReconciliationReport;
}) {
  const clean = report.summary.findingCount === 0;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <dl className="grid gap-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
              Source events checked
            </dt>
            <dd className="mt-1 text-sm font-medium text-gray-800 tabular-nums dark:text-white/90">
              {report.summary.sourceEventsChecked}
            </dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
              Journals checked
            </dt>
            <dd className="mt-1 text-sm font-medium text-gray-800 tabular-nums dark:text-white/90">
              {report.summary.journalsChecked}
            </dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
              Findings
            </dt>
            <dd className="mt-1 text-sm font-medium text-gray-800 tabular-nums dark:text-white/90">
              {report.summary.findingCount}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          {formatDate(report.fromDate)} to {formatDate(report.toDate)}. Counts
          are shown so that an empty report is distinguishable from an empty
          window — &ldquo;nothing wrong&rdquo; and &ldquo;nothing looked
          at&rdquo; are different claims.
        </p>
      </div>

      {clean ? (
        <div role="status" aria-live="polite">
          <Alert
            variant="success"
            title="Every source transaction reconciles"
            message="No missing, duplicate or unbalanced journals were found in this period."
          />
        </div>
      ) : (
        <div role="alert" aria-live="assertive">
          <Alert
            variant="warning"
            title="Inconsistencies found"
            message="These are flagged for investigation, not repaired. Nothing on this screen changes the ledger — a correction is posted as a journal like any other."
          />
        </div>
      )}

      <FindingGroup
        title="Missing journals"
        explanation="A source transaction records that money moved, but no ledger entry accounts for it."
        findings={report.missingJournals}
      />

      <FindingGroup
        title="Duplicate journals"
        explanation="One source event has more than one authoritative journal, so the ledger is overstated by the duplicate's amount."
        findings={report.duplicateJournals}
      />

      <FindingGroup
        title="Unbalanced journals"
        explanation="A posted entry whose debits do not equal its credits. The database trigger should make this impossible; a finding here means it is no longer installed."
        findings={report.unbalancedJournals}
      />
    </div>
  );
}
