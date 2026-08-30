"use client";

import type { AccountSummary, JournalDetail } from "@lms/types";
import { MANUAL_JOURNAL_TYPE_OPTIONS } from "@lms/validation";
import { Alert } from "@lms/ui";
import { useActionState, useState } from "react";

import {
  Field,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form/FormFields";

import {
  createJournalAction,
  updateJournalAction,
  type JournalFormState,
} from "../actions/journal-actions";
import JournalLineBuilder from "./JournalLineBuilder";
import { todayIso } from "@/lib/business-date";

/**
 * Author or edit a manual journal.
 *
 * # The idempotency key is minted once per mount
 *
 * `useState(() => crypto.randomUUID())` runs its initializer exactly once for
 * the life of the component, so a double-submit or a retry after a lost
 * response carries the *same* key and returns the draft that already exists.
 * Minting one per render — or inside the action — would make every retry look
 * like a new journal, which is precisely what the key exists to prevent.
 *
 * # Only two entry types are offered
 *
 * `MANUAL_JOURNAL_TYPE_OPTIONS` is two of the fifteen `JournalEntryType`
 * members. The other thirteen belong to source modules and are written by
 * `LedgerService`; offering them here would let a hand-written journal
 * masquerade as a disbursal and reconcile against a source transaction that
 * does not exist.
 */
export default function JournalForm({
  accounts,
  journal,
}: {
  accounts: AccountSummary[];
  /** Present when editing an existing draft. */
  journal?: JournalDetail;
}) {
  const editing = Boolean(journal);

  const [state, formAction] = useActionState<JournalFormState, FormData>(
    editing ? updateJournalAction : createJournalAction,
    {},
  );

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [entryType, setEntryType] = useState(journal?.entryType ?? "MANUAL");

  // The Kolkata business date, not `toISOString()`. That returns the UTC date,
  // so a journal entered after 18:30 IST defaulted to the previous day.
  const today = todayIso();

  return (
    <form action={formAction} className="space-y-6">
      {editing && (
        <>
          <input
            type="hidden"
            name="journalEntryId"
            value={journal!.journalEntryId}
          />
          <input
            type="hidden"
            name="expectedVersion"
            value={journal!.version}
          />
        </>
      )}
      {!editing && (
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      )}

      {state.message && (
        <div role="alert" aria-live="assertive">
          <Alert
            variant="error"
            title="Could not save"
            message={state.message}
          />
        </div>
      )}

      {state.success && (
        <div role="status" aria-live="polite">
          <Alert variant="success" title="Saved" message={state.success} />
        </div>
      )}

      {/*
        The server's structured refusal, rendered line by line. A single message
        would say "this journal is not valid"; naming each issue against its line
        is what lets the operator fix it.
      */}
      {state.issues && state.issues.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          className="border-error-200 dark:border-error-800 rounded-2xl border p-4"
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

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="entryDate"
          label="Business Date"
          type="date"
          required
          defaultValue={journal?.entryDate ?? today}
          errors={state.errors?.entryDate}
        />

        <SelectField
          name="entryType"
          label="Journal Type"
          required
          options={MANUAL_JOURNAL_TYPE_OPTIONS}
          value={entryType}
          onChange={setEntryType}
          errors={state.errors?.entryType}
        />
      </div>

      <TextAreaField
        name="description"
        label="Description"
        required
        maxLength={1000}
        defaultValue={journal?.description}
        errors={state.errors?.description}
      />

      {/*
        Shown only for an adjustment. An adjustment corrects something already
        posted, and a correction whose reason is not recorded cannot be reviewed
        later — so the server requires it and the field appears when it applies
        rather than sitting empty on every manual journal.
      */}
      {entryType === "ADJUSTMENT" && (
        <TextAreaField
          name="adjustmentReason"
          label="Adjustment Reason"
          required
          maxLength={1000}
          defaultValue={journal?.adjustmentReason}
          errors={state.errors?.adjustmentReason}
        />
      )}

      <Field
        name="approvalReference"
        label="Approval Reference"
        maxLength={150}
        defaultValue={journal?.approvalReference}
        hint="Optional. A ticket or approval note this entry was authorised under."
        errors={state.errors?.approvalReference}
      />

      <div>
        <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-400">
          Journal Lines <span className="text-error-500">*</span>
        </h3>
        <JournalLineBuilder
          accounts={accounts}
          initialLines={journal?.lines.map((line) => ({
            accountId: line.accountId,
            debitPaise: line.debitPaise,
            creditPaise: line.creditPaise,
            ...(line.description ? { description: line.description } : {}),
          }))}
        />
        {state.errors?.lines && (
          <p className="text-error-500 mt-2 text-sm">{state.errors.lines[0]}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton
          label={editing ? "Save draft" : "Create draft"}
          pendingLabel="Saving…"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          A draft moves no money. Post it from the journal page when it is
          ready.
        </p>
      </div>
    </form>
  );
}
