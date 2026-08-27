"use client";

import type { JournalDetail } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import Link from "next/link";
import { useActionState, useState } from "react";

import { SubmitButton, TextAreaField } from "@/components/form/FormFields";

import {
  deleteJournalAction,
  postJournalAction,
  reverseJournalAction,
  type JournalFormState,
} from "../actions/journal-actions";

/**
 * What the caller may do to this journal, and the forms that do it.
 *
 * # Capabilities are two questions, not one
 *
 * `journal.canPost` says the *entry* is in a state that admits posting — it is
 * a draft. `capabilities.canPost` says the *caller* holds the permission. Both
 * must be true to render the control, and neither is what actually protects the
 * endpoint: the API refuses on its own regardless of what is drawn here, which
 * is what Scenarios 44, 49 and 50 assert.
 *
 * # Each action carries its own idempotency key, minted once per mount
 *
 * Posting and reversing both move money. A key generated per render would make
 * a retry after a lost response look like a fresh request and post twice.
 */

export interface Capabilities {
  canEdit: boolean;
  canPost: boolean;
  canReverse: boolean;
}

export default function JournalActions({
  journal,
  capabilities,
}: {
  journal: JournalDetail;
  capabilities: Capabilities;
}) {
  const [postState, postAction] = useActionState<JournalFormState, FormData>(
    postJournalAction,
    {},
  );
  const [reverseState, reverseAction] = useActionState<
    JournalFormState,
    FormData
  >(reverseJournalAction, {});
  const [deleteState, deleteAction] = useActionState<
    JournalFormState,
    FormData
  >(deleteJournalAction, {});

  const [postKey] = useState(() => crypto.randomUUID());
  const [reverseKey] = useState(() => crypto.randomUUID());
  const [confirmingReverse, setConfirmingReverse] = useState(false);

  const showPost = journal.canPost && capabilities.canPost;
  const showEdit = journal.canEdit && capabilities.canEdit;
  const showDelete = journal.canDelete && capabilities.canEdit;
  const showReverse = journal.canReverse && capabilities.canReverse;

  if (!showPost && !showEdit && !showDelete && !showReverse) return null;

  const state = postState.message
    ? postState
    : reverseState.message
      ? reverseState
      : deleteState;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-400">
        Actions
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

      {(postState.success || reverseState.success) && (
        <div role="status" aria-live="polite" className="mb-4">
          <Alert
            variant="success"
            title="Done"
            message={postState.success ?? reverseState.success ?? ""}
          />
        </div>
      )}

      {/* The server's structured refusal, line by line. */}
      {state.issues && state.issues.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          className="border-error-200 dark:border-error-800 mb-4 rounded-2xl border p-4"
        >
          <p className="text-error-600 dark:text-error-400 mb-2 text-sm font-medium">
            This journal cannot be posted yet:
          </p>
          <ul className="text-error-500 list-inside list-disc space-y-1 text-sm">
            {state.issues.map((issue, index) => (
              <li key={`${issue.code}-${issue.lineNumber ?? index}`}>
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {showEdit && (
          <Link href={`/finance/journals/${journal.journalEntryId}/edit`}>
            <Button size="sm" variant="outline">
              Edit draft
            </Button>
          </Link>
        )}

        {showPost && (
          <form action={postAction}>
            <input
              type="hidden"
              name="journalEntryId"
              value={journal.journalEntryId}
            />
            <input
              type="hidden"
              name="expectedVersion"
              value={journal.version}
            />
            <input type="hidden" name="idempotencyKey" value={postKey} />
            <SubmitButton label="Post to ledger" pendingLabel="Posting…" />
          </form>
        )}

        {showDelete && (
          <form action={deleteAction}>
            <input
              type="hidden"
              name="journalEntryId"
              value={journal.journalEntryId}
            />
            <SubmitButton
              label="Discard draft"
              pendingLabel="Discarding…"
              variant="outline"
            />
          </form>
        )}

        {showReverse && !confirmingReverse && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmingReverse(true)}
          >
            Reverse…
          </Button>
        )}
      </div>

      {showPost && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Posting writes this entry to the authoritative ledger. It cannot be
          edited or deleted afterwards — only reversed.
        </p>
      )}

      {/*
        Reversal is behind a deliberate second step. It unwinds a committed
        financial posting, and the reason it asks for is what the audit trail
        will carry.
      */}
      {showReverse && confirmingReverse && (
        <form action={reverseAction} className="mt-5 space-y-4">
          <input
            type="hidden"
            name="journalEntryId"
            value={journal.journalEntryId}
          />
          <input type="hidden" name="expectedVersion" value={journal.version} />
          <input type="hidden" name="idempotencyKey" value={reverseKey} />

          <TextAreaField
            name="reversalReason"
            label="Reversal Reason"
            required
            maxLength={1000}
            placeholder="Why is this entry being reversed?"
            errors={reverseState.errors?.reversalReason}
          />

          <p className="text-xs text-gray-500 dark:text-gray-400">
            The original entry is preserved and marked reversed. A new opposite
            entry is posted; nothing is edited or deleted, and a journal may be
            reversed only once.
          </p>

          <div className="flex items-center gap-3">
            <SubmitButton label="Reverse journal" pendingLabel="Reversing…" />
            {/*
              A plain <button type="button">: `Button` does not expose `type`,
              so inside a form it renders as the HTML default `submit` and
              "Cancel" would submit the very form it is meant to abandon.
            */}
            <button
              type="button"
              onClick={() => setConfirmingReverse(false)}
              className="shadow-theme-xs inline-flex items-center rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.03]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
