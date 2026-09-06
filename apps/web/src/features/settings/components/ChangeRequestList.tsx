"use client";

import { Alert, Badge } from "@lms/ui";
import type { SettingChangeDetail } from "@lms/types";
import React, { useActionState, useState } from "react";

import { Field, SubmitButton } from "@/components/form/FormFields";

import {
  approveChangeAction,
  cancelChangeAction,
  rejectChangeAction,
} from "../actions/settings-actions";

/** Terminal states cannot be acted on again (Scenario 13). */
const TERMINAL = new Set(["REJECTED", "CANCELLED", "APPLIED", "FAILED"]);

const STATUS_COLOR: Record<string, "success" | "error" | "warning" | "light"> =
  {
    APPLIED: "success",
    REJECTED: "error",
    FAILED: "error",
    PENDING_APPROVAL: "warning",
    CANCELLED: "light",
  };

/**
 * The configuration change queue (Scenarios 10-13).
 *
 * # Approve is offered even on your own request, and refused by the server
 *
 * Hiding the button for a change you submitted would make the maker-checker
 * rule invisible — an approver would never learn why they cannot act, and a
 * Branch Admin testing the boundary would see nothing at all. The server refuses
 * with an explanation (Scenario 11); this screen surfaces it.
 *
 * That is the same reasoning the pages use for permissions: reach the screen,
 * be refused at the act. A hidden control proves nothing.
 */
export default function ChangeRequestList({
  changes,
  loadError = false,
  canApprove = false,
  currentUserId,
}: {
  changes: SettingChangeDetail[];
  loadError?: boolean;
  canApprove?: boolean;
  currentUserId?: string;
}) {
  const [approveState, approveAction] = useActionState(approveChangeAction, {});
  const [rejectState, rejectAction] = useActionState(rejectChangeAction, {});
  const [cancelState, cancelAction] = useActionState(cancelChangeAction, {});
  const [rejecting, setRejecting] = useState<string | null>(null);

  if (loadError) {
    return (
      <Alert
        variant="error"
        title="Change requests unavailable"
        message="We could not load the configuration change queue. Refresh to try again."
      />
    );
  }

  const banner =
    approveState.message ?? rejectState.message ?? cancelState.message;
  const success =
    approveState.success ?? rejectState.success ?? cancelState.success;

  return (
    <div className="space-y-5">
      {success ? (
        <Alert variant="success" title="Done" message={success} />
      ) : null}
      {banner ? (
        <Alert variant="error" title="Not applied" message={banner} />
      ) : null}

      {changes.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No configuration changes.
        </p>
      ) : (
        <div className="space-y-3">
          {changes.map((change) => {
            const isTerminal = TERMINAL.has(change.status);
            const isMine = currentUserId === change.requestedBy;

            return (
              <div
                key={change.changeRequestId}
                className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                        {change.changeRequestNumber}
                      </span>
                      <Badge color={STATUS_COLOR[change.status] ?? "light"}>
                        {change.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="mt-1 font-medium text-gray-800 dark:text-white/90">
                      {change.settingName}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Requested value:{" "}
                      <span className="font-mono">
                        {String(change.requestedValue ?? "")}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {change.changeReason}
                    </div>
                    {change.rejectionReason ? (
                      <div className="text-error-500 mt-1 text-xs">
                        Rejected: {change.rejectionReason}
                      </div>
                    ) : null}
                    {change.failureReason ? (
                      <div className="text-error-500 mt-1 text-xs">
                        Could not apply: {change.failureReason}
                      </div>
                    ) : null}
                  </div>

                  {!isTerminal ? (
                    <div className="flex items-center gap-3">
                      {canApprove ? (
                        <>
                          <form action={approveAction}>
                            <input
                              type="hidden"
                              name="changeRequestId"
                              value={change.changeRequestId}
                            />
                            <button
                              type="submit"
                              className="text-success-600 text-xs font-medium hover:underline"
                            >
                              Approve
                            </button>
                          </form>
                          <button
                            type="button"
                            onClick={() =>
                              setRejecting(
                                rejecting === change.changeRequestId
                                  ? null
                                  : change.changeRequestId,
                              )
                            }
                            className="text-error-500 text-xs font-medium hover:underline"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}

                      {isMine ? (
                        <form action={cancelAction}>
                          <input
                            type="hidden"
                            name="changeRequestId"
                            value={change.changeRequestId}
                          />
                          <button
                            type="submit"
                            className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                          >
                            Withdraw
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {rejecting === change.changeRequestId ? (
                  <form action={rejectAction} className="mt-4 space-y-3">
                    <input
                      type="hidden"
                      name="changeRequestId"
                      value={change.changeRequestId}
                    />
                    {/* Mandatory (Scenario 12) — a rejection without a reason
                        tells the submitter nothing about what to change. */}
                    <Field
                      label="Rejection Reason"
                      name="rejectionReason"
                      errors={rejectState.errors?.rejectionReason}
                    />
                    <SubmitButton label="Confirm rejection" />
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
