"use client";

import { Alert, Badge } from "@lms/ui";
import type { MaintenanceJobDetail } from "@lms/types";
import React, { useActionState } from "react";

import { retryMaintenanceJobAction } from "../actions/maintenance-actions";

const STATUS_COLOR: Record<string, "success" | "error" | "warning" | "light"> =
  {
    SUCCEEDED: "success",
    FAILED: "error",
    RECOVERY_REQUIRED: "error",
    RUNNING: "warning",
    RETRY_SCHEDULED: "warning",
    QUEUED: "light",
    CANCELLED: "light",
  };

/**
 * Maintenance runs and their steps (Scenarios 26-31).
 *
 * # Retry is offered only where it is meaningful
 *
 * A run is retryable only when it FAILED *and* the failing step said it could be
 * retried. A terminal non-retryable failure shows RECOVERY_REQUIRED and no
 * button, because Scenario 31 requires that no automatic retry continues —
 * offering one would invite an operator to loop on something needing
 * intervention.
 *
 * # Redacted failure detail says so
 *
 * `isFailureRedacted` distinguishes "withheld by permission" from "no detail
 * recorded" (Scenario 27). Rendering an empty cell for the first would misreport
 * a failed run as unexplained.
 */
export default function MaintenanceJobTable({
  jobs,
  loadError = false,
  canRetry = false,
}: {
  jobs: MaintenanceJobDetail[];
  loadError?: boolean;
  canRetry?: boolean;
}) {
  const [retryState, retryAction] = useActionState(
    retryMaintenanceJobAction,
    {},
  );

  if (loadError) {
    return (
      <Alert
        variant="error"
        title="Maintenance jobs unavailable"
        message="We could not load the maintenance history. Refresh to try again."
      />
    );
  }

  return (
    <div className="space-y-4">
      {retryState.success ? (
        <Alert variant="success" title="Retry started" message={retryState.success} />
      ) : null}
      {retryState.message ? (
        <Alert variant="error" title="Not retried" message={retryState.message} />
      ) : null}

      {jobs.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No maintenance runs recorded.
        </p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div
              key={job.jobRunId}
              className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800 dark:text-white/90">
                      {job.jobType}
                    </span>
                    <Badge color={STATUS_COLOR[job.status] ?? "light"}>
                      {job.status.replace(/_/g, " ")}
                    </Badge>
                    {/* Rule 63 — scheduled and manual work must be
                        distinguishable in operational history. */}
                    <Badge color="light">{job.triggerType}</Badge>
                  </div>

                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Business date {job.businessDate ?? "—"} · attempt{" "}
                    {job.attemptNumber} · {job.succeededCount} step(s) succeeded
                    {job.failedCount > 0 ? `, ${job.failedCount} failed` : ""}
                  </div>

                  {job.failureSummary ? (
                    <div className="mt-1 text-xs text-error-500">
                      {job.failureSummary}
                    </div>
                  ) : job.isFailureRedacted && job.status === "FAILED" ? (
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Failure detail is restricted.
                    </div>
                  ) : null}
                </div>

                {canRetry && job.retryable ? (
                  <form action={retryAction}>
                    <input type="hidden" name="jobRunId" value={job.jobRunId} />
                    <button
                      type="submit"
                      className="text-xs font-medium text-brand-500 hover:underline"
                    >
                      Retry
                    </button>
                  </form>
                ) : null}
              </div>

              {job.steps.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3 dark:border-gray-800">
                  {job.steps.map((step) => (
                    <li
                      key={step.jobStepId}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="font-mono text-gray-600 dark:text-gray-300">
                        {step.stepCode}
                      </span>
                      <span className="flex items-center gap-2">
                        {step.failureSummary ? (
                          <span className="text-gray-500 dark:text-gray-400">
                            {step.failureSummary}
                          </span>
                        ) : null}
                        <Badge
                          color={STATUS_COLOR[step.status] ?? "light"}
                        >
                          {step.status}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
