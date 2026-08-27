import type { Metadata } from "next";
import { PERMISSIONS } from "@lms/constants";
import { notFound } from "next/navigation";
import Link from "next/link";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { requirePermissions } from "@/features/auth/utils/require-permissions";
import { fetchRecoveryAction } from "@/features/recovery";
import { PromiseMissedBadge } from "@/features/recovery";
import { formatDate, formatPaise } from "@/lib/format";

export const metadata: Metadata = { title: "Recovery Activity" };
export const dynamic = "force-dynamic";

/**
 * One recovery activity.
 *
 * A detail-only route with no list sibling — an activity is always reached from
 * its case. Scope resolves through that case server-side, so an officer cannot
 * read a colleague's activity by guessing an id.
 *
 * A finalized activity is shown read-only. Scenario 32 requires a correction to
 * be a follow-up action rather than a rewrite, and the API refuses the edit
 * regardless; rendering an edit form here would offer a control that can only
 * fail.
 */
export default async function RecoveryActionDetailPage({
  params,
}: {
  params: Promise<{ recoveryActionId: string }>;
}) {
  await requirePermissions(PERMISSIONS.RECOVERY_CASES_VIEW);
  const { recoveryActionId } = await params;

  const detail = await fetchRecoveryAction(recoveryActionId);

  if (detail.status === "not-found") notFound();
  if (detail.status !== "ok") throw new Error("Could not load activity");

  const { action } = detail;

  return (
    <div>
      <PageBreadcrumb pageTitle="Recovery Activity" />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {action.actionType.replace(/_/g, " ")}
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {formatDate(action.actionDate)}
              {action.performedByName ? ` · ${action.performedByName}` : ""}
            </p>
          </div>
          {action.promiseMissed ? <PromiseMissedBadge /> : null}
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Figure
            label="Outcome"
            value={action.outcome?.replace(/_/g, " ").toLowerCase() ?? "—"}
          />
          <Figure
            label="Next follow-up"
            value={formatDate(action.nextFollowUpDate)}
          />
          <Figure
            label="Finalized"
            value={
              action.finalizedAt
                ? formatDate(action.finalizedAt.slice(0, 10))
                : "Pending"
            }
          />
        </dl>

        {action.promiseToPayDate && action.promiseToPayAmountPaise ? (
          <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
            <p className="text-sm font-medium text-gray-800 dark:text-white/90">
              Promised {formatPaise(action.promiseToPayAmountPaise)} by{" "}
              {formatDate(action.promiseToPayDate)}
            </p>
            {/*
              Rule 15, Scenario 15: a promise records an intention and reduces
              no balance. Saying so on the screen stops an operator reading the
              figure as a payment already taken.
            */}
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              A promise does not reduce the outstanding balance. Record the
              payment through EMI Collection when it arrives.
            </p>
          </div>
        ) : null}

        {action.gpsCaptureStatus ? (
          <div className="mt-6">
            <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
              Field evidence
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Figure label="GPS capture" value={action.gpsCaptureStatus} />
              <Figure label="Device" value={action.deviceId ?? "—"} />
              <Figure
                label="Acknowledgment"
                value={action.customerAckReference ?? "—"}
              />
            </dl>
          </div>
        ) : null}

        {action.notes ? (
          <div className="mt-6">
            <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
              Notes
            </h3>
            <p className="mt-2 text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-300">
              {action.notes}
            </p>
          </div>
        ) : null}

        <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
          <Link
            href={`/recovery-cases/${action.recoveryCaseId}`}
            className="text-brand-500 hover:underline"
          >
            Back to the case
          </Link>
        </p>
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-theme-xs text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-gray-800 dark:text-white/90">
        {value}
      </dd>
    </div>
  );
}
