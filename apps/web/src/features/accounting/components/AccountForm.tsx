"use client";

import type { AccountDetail, AccountSummary } from "@lms/types";
import {
  ACCOUNT_BRANCH_SCOPE_OPTIONS,
  ACCOUNT_STATUS_OPTIONS,
  ACCOUNT_TYPE_OPTIONS,
  NORMAL_BALANCE_OPTIONS,
} from "@lms/validation";
import { Alert } from "@lms/ui";
import { useActionState, useState } from "react";

import {
  Field,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form/FormFields";

import {
  createAccountAction,
  updateAccountAction,
  type AccountFormState,
} from "../actions/account-actions";

/**
 * Create or edit an account.
 *
 * # Identity fields stay editable in the markup, and the server decides
 *
 * Whether the code, type and normal balance may change depends on how many
 * posted lines reference the account — data the client holds only as
 * `canEditIdentity`. They are disabled here when the server says so, but they
 * are still *sent*, so an attempt reaches a 409 naming the reason rather than
 * silently becoming a no-op.
 *
 * # The normal balance is pre-selected from the type
 *
 * Four of the five account types have exactly one conventional side, and the
 * server refuses the other one. Pre-selecting it turns a rule the operator
 * would otherwise discover by being refused into a default they can see.
 */

const CONVENTIONAL_BALANCE: Record<string, string> = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  INCOME: "CREDIT",
};

export default function AccountForm({
  account,
  parentOptions,
}: {
  /** Present when editing. */
  account?: AccountDetail;
  /** Candidate parents — the chart, minus this account itself. */
  parentOptions: AccountSummary[];
}) {
  const editing = Boolean(account);

  const [state, formAction] = useActionState<AccountFormState, FormData>(
    editing ? updateAccountAction : createAccountAction,
    {},
  );

  // Typed as plain strings rather than the narrow unions: `SelectField.onChange`
  // hands back whatever the <select> holds, and narrowing here would only move
  // the cast to every call site. The server validates the value regardless.
  const [accountType, setAccountType] = useState<string>(
    account?.accountType ?? "ASSET",
  );
  const [normalBalance, setNormalBalance] = useState<string>(
    account?.normalBalance ?? "DEBIT",
  );

  const onTypeChange = (value: string) => {
    setAccountType(value);
    const conventional = CONVENTIONAL_BALANCE[value];
    if (conventional) setNormalBalance(conventional);
  };

  const identityFrozen = editing && account?.canEditIdentity === false;

  return (
    <form action={formAction} className="space-y-6">
      {editing && (
        <>
          <input type="hidden" name="accountId" value={account!.accountId} />
          <input
            type="hidden"
            name="expectedVersion"
            value={account!.version}
          />
        </>
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

      {identityFrozen && (
        <div role="status" aria-live="polite">
          <Alert
            variant="info"
            title="Identity is fixed"
            message={`${account!.postedLineCount} posted ledger line(s) reference this account. Its code, type and normal balance can no longer change — altering them would change what an entry already in the ledger means. Create a new account instead.`}
          />
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="accountCode"
          label="Account Code"
          required
          maxLength={50}
          defaultValue={account?.accountCode}
          hint="Letters, digits, dot, underscore and hyphen. Unique in this organization."
          errors={state.errors?.accountCode}
        />

        <Field
          name="accountName"
          label="Account Name"
          required
          maxLength={200}
          defaultValue={account?.accountName}
          errors={state.errors?.accountName}
        />

        <SelectField
          name="accountType"
          label="Account Type"
          required
          options={ACCOUNT_TYPE_OPTIONS}
          value={accountType}
          onChange={onTypeChange}
          errors={state.errors?.accountType}
        />

        <SelectField
          name="normalBalance"
          label="Normal Balance"
          required
          options={NORMAL_BALANCE_OPTIONS}
          value={normalBalance}
          onChange={setNormalBalance}
          hint="Set from the account type. An unconventional side is refused."
          errors={state.errors?.normalBalance}
        />

        <SelectField
          name="status"
          label="Status"
          required
          options={ACCOUNT_STATUS_OPTIONS}
          defaultValue={account?.status ?? "ACTIVE"}
          errors={state.errors?.status}
        />

        <SelectField
          name="branchScope"
          label="Branch Scope"
          options={ACCOUNT_BRANCH_SCOPE_OPTIONS}
          defaultValue={account?.branchScope ?? "ORGANIZATION"}
          hint="Accounts are organization-wide; which branch a posting belongs to is carried by the journal entry."
          errors={state.errors?.branchScope}
        />

        <Field
          name="accountCategory"
          label="Category"
          maxLength={100}
          defaultValue={account?.accountCategory}
          errors={state.errors?.accountCategory}
        />

        <SelectField
          name="parentAccountId"
          label="Parent Account"
          placeholder="None — top level"
          options={parentOptions.map((candidate) => ({
            value: candidate.accountId,
            label: `${candidate.accountCode} — ${candidate.accountName}`,
          }))}
          defaultValue={account?.parentAccountId}
          errors={state.errors?.parentAccountId}
        />

        <Field
          name="effectiveFrom"
          label="Effective From"
          type="date"
          defaultValue={account?.effectiveFrom}
          errors={state.errors?.effectiveFrom}
        />

        <Field
          name="effectiveTo"
          label="Effective To"
          type="date"
          defaultValue={account?.effectiveTo}
          errors={state.errors?.effectiveTo}
        />
      </div>

      <TextAreaField
        name="description"
        label="Description"
        maxLength={1000}
        defaultValue={account?.description}
        errors={state.errors?.description}
      />

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-400">
          Posting
        </legend>

        <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-400">
          <input
            type="checkbox"
            name="isPostable"
            defaultChecked={account?.isPostable ?? true}
            className="mt-0.5"
          />
          <span>
            Postable
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              A journal line may reference this account at all.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-400">
          <input
            type="checkbox"
            name="isManualPostingAllowed"
            defaultChecked={account?.isManualPostingAllowed ?? false}
            className="mt-0.5"
          />
          <span>
            Open to manual journals
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              Narrower than postable. Leave off for an account a source module
              drives, so a hand-written entry cannot desynchronise it.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-400">
          <input
            type="checkbox"
            name="isControlAccount"
            defaultChecked={account?.isControlAccount ?? false}
            className="mt-0.5"
          />
          <span>
            Control account
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              Driven by a subsidiary ledger. A control account cannot also be
              postable.
            </span>
          </span>
        </label>

        {state.errors?.isPostable && (
          <p className="text-error-500 text-sm">{state.errors.isPostable[0]}</p>
        )}
      </fieldset>

      <SubmitButton
        label={editing ? "Save account" : "Create account"}
        pendingLabel="Saving…"
      />
    </form>
  );
}
