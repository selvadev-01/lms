"use client";

import type { AccountDetail } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import { useActionState, useState } from "react";

import { SubmitButton, TextAreaField } from "@/components/form/FormFields";

import {
  activateAccountAction,
  deactivateAccountAction,
  deleteAccountAction,
  type AccountFormState,
} from "../actions/account-actions";

/**
 * Deactivate, reactivate or delete an account.
 *
 * # Why deleting is offered at all
 *
 * It almost always refuses, and that is the point (Scenario 10). An account
 * that has ever been posted to can never be removed — the answer is
 * "deactivate instead", and an operator only believes that once they have been
 * told *what* is holding the account: the 409 names each blocker and they are
 * rendered below.
 *
 * Deactivating is the ordinary path. The account stays visible for historical
 * reporting and stops accepting new postings; nothing about the entries that
 * already reference it changes.
 */
export default function AccountDangerZone({
  account,
}: {
  account: AccountDetail;
}) {
  const [deactivateState, deactivateAction] = useActionState<
    AccountFormState,
    FormData
  >(deactivateAccountAction, {});
  const [activateState, activateAction] = useActionState<
    AccountFormState,
    FormData
  >(activateAccountAction, {});
  const [deleteState, deleteAction] = useActionState<
    AccountFormState,
    FormData
  >(deleteAccountAction, {});

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const state = deactivateState.message
    ? deactivateState
    : activateState.message
      ? activateState
      : deleteState;

  const success = deactivateState.success ?? activateState.success ?? undefined;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-400">
        Lifecycle
      </h3>

      {state.message && (
        <div role="alert" aria-live="assertive" className="mb-4">
          <Alert
            variant="error"
            title="Could not complete"
            message={state.message}
          />
        </div>
      )}

      {success && (
        <div role="status" aria-live="polite" className="mb-4">
          <Alert variant="success" title="Done" message={success} />
        </div>
      )}

      {/*
        What is holding the account, named. "Deactivate instead" is only
        actionable advice if the operator can see why deletion was refused.
      */}
      {state.blockedBy && state.blockedBy.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          className="border-warning-200 dark:border-warning-800 mb-4 rounded-2xl border p-4"
        >
          <p className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
            This account is referenced and cannot be deleted:
          </p>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-500 dark:text-gray-400">
            {state.blockedBy.map((blocker) => (
              <li key={blocker.entity}>
                {blocker.label}: {blocker.count}
              </li>
            ))}
          </ul>
        </div>
      )}

      {account.status === "ACTIVE" ? (
        <form action={deactivateAction} className="space-y-4">
          <input type="hidden" name="accountId" value={account.accountId} />
          <input type="hidden" name="expectedVersion" value={account.version} />

          <TextAreaField
            name="reason"
            label="Reason"
            maxLength={500}
            placeholder="Optional. Why is this account being closed to new postings?"
            errors={deactivateState.errors?.reason}
          />

          <div className="flex items-center gap-3">
            <SubmitButton
              label="Deactivate"
              pendingLabel="Deactivating…"
              variant="outline"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Stays visible for historical reporting; accepts no new postings.
            </p>
          </div>
        </form>
      ) : (
        <form action={activateAction} className="flex items-center gap-3">
          <input type="hidden" name="accountId" value={account.accountId} />
          <input type="hidden" name="expectedVersion" value={account.version} />
          <SubmitButton label="Reactivate" pendingLabel="Activating…" />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Reopens the account for new postings.
          </p>
        </form>
      )}

      <div className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-800">
        {confirmingDelete ? (
          <form action={deleteAction} className="space-y-3">
            <input type="hidden" name="accountId" value={account.accountId} />
            <p className="text-sm text-gray-700 dark:text-gray-400">
              Delete this account permanently? This is possible only while
              nothing references it.
            </p>
            <div className="flex items-center gap-3">
              <SubmitButton
                label="Delete permanently"
                pendingLabel="Deleting…"
                variant="outline"
              />
              {/*
              A plain <button type="button">: `Button` does not expose `type`,
              so inside a form it renders as the HTML default `submit` and
              "Cancel" would submit the very form it is meant to abandon.
            */}
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="shadow-theme-xs inline-flex items-center rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.03]"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!account.canDelete}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete account
            </Button>
            {!account.canDelete && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {account.postedLineCount} posted line(s) and{" "}
                {account.childAccountCount} child account(s) reference this
                account. Deactivate it instead.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
