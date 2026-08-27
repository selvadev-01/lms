import type { RecoveryCaseDetail as RecoveryCaseDetailData } from "@lms/types";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@lms/ui";
import Link from "next/link";

import { formatDate, formatPaise } from "@/lib/format";
import AssignRecoveryCaseForm from "./AssignRecoveryCaseForm";
import CloseRecoveryCaseForm from "./CloseRecoveryCaseForm";
import EscalateRecoveryCaseForm from "./EscalateRecoveryCaseForm";
import IssueLegalNoticeForm from "./IssueLegalNoticeForm";
import ProposeSettlementForm from "./ProposeSettlementForm";
import RecordRecoveryActionForm from "./RecordRecoveryActionForm";
import SettlementDecisionForm from "./SettlementDecisionForm";
import WriteOffLoanForm from "./WriteOffLoanForm";
import {
  DelinquencyBucketBadge,
  NpaStatusBadge,
  PromiseMissedBadge,
  RecoveryCaseStatusBadge,
  RecoveryPriorityBadge,
  SettlementStatusBadge,
} from "./RecoveryBadges";

/**
 * What the viewer may do with this case.
 *
 * Resolved server-side by the page and passed as a plain boolean bag, the
 * house pattern. The route guard and the API are the real boundary; hiding a
 * control the caller cannot use is UX, not security — which is why a viewer
 * who somehow reached a hidden action still gets a 403 from the API.
 */
export interface Capabilities {
  canAssign: boolean;
  canRecordAction: boolean;
  canEscalate: boolean;
  canClose: boolean;
  canProposeSettlement: boolean;
  canApproveSettlement: boolean;
  canIssueNotice: boolean;
  canWriteOff: boolean;
}

/**
 * One recovery case, with its history.
 *
 * # Why the assignment history is rendered in full
 *
 * Rule 25 requires reassignment to preserve historical assignment information,
 * and Scenario 3 requires the case screen to show it in chronological order
 * with its actors and timestamps. Rendering only the current assignee would
 * make the stored history invisible and the rule unverifiable from the UI.
 */
export default function RecoveryCaseDetail({
  recoveryCase,
  capabilities,
}: {
  recoveryCase: RecoveryCaseDetailData;
  capabilities: Capabilities;
}) {
  const isClosed = recoveryCase.status === "CLOSED";

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {recoveryCase.caseNumber ?? "Recovery case"}
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              <Link
                href={`/overdues/${recoveryCase.loanId}`}
                className="text-brand-500 hover:underline"
              >
                {recoveryCase.loanNumber}
              </Link>
              {" · "}
              {recoveryCase.customerName}
              {recoveryCase.branchName ? ` · ${recoveryCase.branchName}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RecoveryCaseStatusBadge status={recoveryCase.status} />
            <RecoveryPriorityBadge priority={recoveryCase.priority} />
            <NpaStatusBadge status={recoveryCase.npaStatus} />
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Figure label="Opened" value={formatDate(recoveryCase.openedDate)} />
          <Figure
            label="Assigned officer"
            value={recoveryCase.assignedAgentName ?? "Unassigned"}
          />
          <Figure
            label="Days past due"
            value={String(recoveryCase.daysPastDue)}
          />
          <Figure
            label="Total overdue"
            value={formatPaise(recoveryCase.totalOverduePaise)}
            emphasis
          />
        </dl>

        <div className="mt-4">
          <DelinquencyBucketBadge bucket={recoveryCase.bucket} />
        </div>

        {isClosed ? (
          <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
            <p className="text-sm font-medium text-gray-800 dark:text-white/90">
              Closed {formatDate(recoveryCase.closedDate)} —{" "}
              {recoveryCase.resolutionType?.toLowerCase().replace(/_/g, " ")}
            </p>
            {recoveryCase.closureReason ? (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {recoveryCase.closureReason}
              </p>
            ) : null}
            {recoveryCase.remainingOutstandingPaise ? (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Remaining outstanding at closure:{" "}
                {formatPaise(recoveryCase.remainingOutstandingPaise)}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/*
        Assignment history, in full. Rule 25 and Scenario 3: the previous
        assignee must remain visible after a reassignment, so this renders the
        whole chain rather than only the current holder.
      */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Assignment history
        </h3>

        {recoveryCase.assignments.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            This case has never been assigned.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {recoveryCase.assignments.map((assignment) => (
              <li
                key={assignment.assignmentId}
                className="rounded-xl border border-gray-100 p-3 dark:border-white/[0.05]"
              >
                <p className="text-sm text-gray-800 dark:text-white/90">
                  {assignment.fromUserName
                    ? `${assignment.fromUserName} → ${assignment.toUserName}`
                    : `Assigned to ${assignment.toUserName}`}
                </p>
                <p className="text-theme-xs mt-0.5 text-gray-500 dark:text-gray-400">
                  by {assignment.assignedByName ?? "—"} ·{" "}
                  {formatDate(assignment.assignedAt.slice(0, 10))}
                </p>
                {assignment.reason ? (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {assignment.reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Recovery activity
        </h3>

        {recoveryCase.actions.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            No activity recorded yet.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {recoveryCase.actions.map((action) => (
              <li
                key={action.recoveryActionId}
                className="rounded-xl border border-gray-100 p-3 dark:border-white/[0.05]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/recovery-actions/${action.recoveryActionId}`}
                    className="text-brand-500 text-sm font-medium hover:underline"
                  >
                    {action.actionType.replace(/_/g, " ")}
                  </Link>
                  <div className="flex items-center gap-2">
                    {action.promiseMissed ? <PromiseMissedBadge /> : null}
                    <span className="text-theme-xs text-gray-400 dark:text-gray-500">
                      {formatDate(action.actionDate)}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                  {action.outcome?.replace(/_/g, " ").toLowerCase()}
                  {action.performedByName ? ` · ${action.performedByName}` : ""}
                </p>
                {action.promiseToPayAmountPaise && action.promiseToPayDate ? (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Promised {formatPaise(action.promiseToPayAmountPaise)} by{" "}
                    {formatDate(action.promiseToPayDate)}
                    {/*
                      A promise records an intention. It reduces no balance
                      (Rule 15, Scenario 15), so it is never shown as a payment.
                    */}
                  </p>
                ) : null}
                {action.notes ? (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {action.notes}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {recoveryCase.settlements.length > 0 ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
            Settlements
          </h3>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                <TableRow>
                  <HeaderCell>Agreed</HeaderCell>
                  <HeaderCell>Status</HeaderCell>
                  <HeaderCell align="end">Settlement</HeaderCell>
                  <HeaderCell align="end">Waived</HeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {recoveryCase.settlements.map((settlement) => (
                  <TableRow key={settlement.settlementId}>
                    <TableCell className="px-5 py-3 text-start text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(settlement.agreedDate)}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-start">
                      <SettlementStatusBadge status={settlement.status} />
                    </TableCell>
                    <TableCell className="px-5 py-3 text-end text-sm text-gray-700 dark:text-gray-300">
                      {formatPaise(settlement.settlementAmountPaise)}
                    </TableCell>
                    <TableCell className="px-5 py-3 text-end text-sm font-medium text-gray-800 dark:text-white/90">
                      {settlement.waivedAmountPaise
                        ? formatPaise(settlement.waivedAmountPaise)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      {recoveryCase.legalNotices.length > 0 ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
            Legal notices
          </h3>
          <ul className="mt-4 space-y-2">
            {recoveryCase.legalNotices.map((notice) => (
              <li
                key={notice.legalNoticeId}
                className="text-sm text-gray-700 dark:text-gray-300"
              >
                {formatDate(notice.noticeDate)} — {notice.status.toLowerCase()}{" "}
                (expires {formatDate(notice.expiryDate)})
                {notice.noticeReference ? ` · ${notice.noticeReference}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        Actions are hidden on a closed case rather than disabled. Every one of
        them is refused server-side once the case is closed (Scenario 33), so
        rendering them would offer the operator a control that can only fail.
      */}
      {!isClosed ? (
        <section className="grid gap-6 lg:grid-cols-2">
          {capabilities.canRecordAction ? (
            <RecordRecoveryActionForm
              recoveryCaseId={recoveryCase.recoveryCaseId}
            />
          ) : null}
          {capabilities.canAssign ? (
            <AssignRecoveryCaseForm
              recoveryCaseId={recoveryCase.recoveryCaseId}
              version={recoveryCase.version}
              currentAssigneeId={recoveryCase.assignedAgentId}
            />
          ) : null}
          {capabilities.canEscalate ? (
            <EscalateRecoveryCaseForm
              recoveryCaseId={recoveryCase.recoveryCaseId}
              version={recoveryCase.version}
            />
          ) : null}
          {capabilities.canClose ? (
            <CloseRecoveryCaseForm
              recoveryCaseId={recoveryCase.recoveryCaseId}
              version={recoveryCase.version}
            />
          ) : null}
          {capabilities.canProposeSettlement ? (
            <ProposeSettlementForm
              recoveryCaseId={recoveryCase.recoveryCaseId}
            />
          ) : null}
          {capabilities.canIssueNotice ? (
            <IssueLegalNoticeForm
              recoveryCaseId={recoveryCase.recoveryCaseId}
            />
          ) : null}
        </section>
      ) : null}

      {/*
        Settlements awaiting a decision, one panel each.

        Rendered outside the grid above and only for an approver, because these
        are the approval authority's acts rather than the desk's — and rendered
        per settlement rather than once, since a case may carry a rejected
        proposal and a live one at the same time. The component returns null for
        anything already completed, rejected or cancelled.
      */}
      {!isClosed && capabilities.canApproveSettlement
        ? recoveryCase.settlements.map((settlement) => (
            <SettlementDecisionForm
              key={settlement.settlementId}
              recoveryCaseId={recoveryCase.recoveryCaseId}
              settlement={settlement}
            />
          ))
        : null}

      {/*
        Write-off last, and alone.

        Separated from the action grid deliberately: it is the only control here
        that cannot be undone, and sitting it beside "record activity" would
        give the two the same visual weight. The permission is granted to no
        seeded role, so most operators never see this at all.
      */}
      {!isClosed && capabilities.canWriteOff ? (
        <WriteOffLoanForm
          recoveryCaseId={recoveryCase.recoveryCaseId}
          version={recoveryCase.version}
        />
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-theme-xs text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? "mt-1 text-lg font-semibold text-gray-800 dark:text-white/90"
            : "mt-1 text-sm font-medium text-gray-800 dark:text-white/90"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function HeaderCell({
  children,
  align = "start",
}: {
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  return (
    <TableCell
      isHeader
      className={`px-5 py-3 text-${align} text-theme-xs font-medium text-gray-500 dark:text-gray-400`}
    >
      {children}
    </TableCell>
  );
}
