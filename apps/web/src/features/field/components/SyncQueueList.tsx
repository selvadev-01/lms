"use client";

import type { SyncItemStatus, SyncQueueItem } from "@lms/types";
import { Alert, Badge } from "@lms/ui";
import { useActionState } from "react";

import { SubmitButton } from "@/components/form/FormFields";
import { formatDate } from "@/lib/format";
import type { ActionState } from "@/lib/api-call";

import { retrySyncItemAction } from "../actions/sync-queue-actions";

/**
 * What devices say they are holding (Scenario 13, and the retry of Scenario 16).
 *
 * A client component only because each row carries a retry form. The rows
 * themselves are a device's assertion about its own state — nothing financial
 * turns on them, and a capture becomes real only when it posts through the sync
 * endpoint.
 *
 * `attemptCount` is the column that matters: an item retried five times is a
 * different problem from one that failed once, and only the count tells them
 * apart.
 */

const TONE: Record<
  SyncItemStatus,
  "success" | "warning" | "error" | "info" | "light"
> = {
  QUEUED: "info",
  SYNCING: "warning",
  SYNCED: "success",
  FAILED: "error",
  // A conflict is not a failure to retry blindly — it means an authoritative
  // record already exists — so it reads differently from FAILED.
  CONFLICT: "warning",
};

export default function SyncQueueList({ items }: { items: SyncQueueItem[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    retrySyncItemAction,
    {},
  );

  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No device is reporting unflushed work.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {state.message ? (
        <Alert
          variant="error"
          title="Could not re-queue"
          message={state.message}
        />
      ) : null}
      {state.success ? (
        <Alert variant="success" title="Re-queued" message={state.success} />
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
              <th className="px-5 py-3 font-medium">Transaction</th>
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Queued</th>
              <th className="px-5 py-3 text-right font-medium">Attempts</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.syncItemId}
                className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
              >
                <td className="px-5 py-3 font-mono text-xs text-gray-800 dark:text-white/90">
                  {item.clientTransactionId}
                </td>
                <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                  {item.userName ?? "—"}
                </td>
                <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                  {item.entityType}
                </td>
                <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                  {formatDate(item.queuedAt)}
                </td>
                <td className="px-5 py-3 text-right text-gray-500 tabular-nums dark:text-gray-400">
                  {item.attemptCount}
                </td>
                <td className="px-5 py-3">
                  <div className="space-y-1">
                    <Badge color={TONE[item.status]}>{item.status}</Badge>
                    {item.lastError ? (
                      <p className="max-w-xs text-xs text-gray-400">
                        {item.lastError}
                      </p>
                    ) : null}
                  </div>
                </td>
                <td className="px-5 py-3 text-right">
                  {/* Re-queuing does not re-post the capture. The stored
                      payload is a device's record, not a posting request; it
                      posts through the sync endpoint where validation, scope
                      and eligibility all run. */}
                  {item.status === "FAILED" || item.status === "CONFLICT" ? (
                    <form action={formAction}>
                      <input
                        type="hidden"
                        name="syncItemId"
                        value={item.syncItemId}
                      />
                      <SubmitButton
                        label="Re-queue"
                        pendingLabel="…"
                        variant="outline"
                      />
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
