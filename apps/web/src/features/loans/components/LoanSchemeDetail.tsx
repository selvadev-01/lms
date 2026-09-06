"use client";

import type { LoanSchemeDetail as SchemeDetail } from "@lms/types";
import { Alert } from "@lms/ui";
import {
  INTEREST_TYPE_OPTIONS,
  LOAN_TYPE_OPTIONS,
  REPAYMENT_FREQUENCY_OPTIONS,
  labelFor,
} from "@lms/validation";
import React, { useActionState } from "react";

import {
  addSchemeDurationAction,
  setDurationStatusAction,
  setSchemeStatusAction,
} from "../actions/loan-config-actions";
import { SelectField, SubmitButton } from "./FormParts";
import { ConfigStatusBadge, formatBps } from "./LoanBadges";

/**
 * A scheme's own page: its price, and the terms a borrower may choose (Module 06).
 *
 * # Why this screen has to exist
 *
 * A scheme is a price list, and a duration option is an entry in it. Until one
 * exists the scheme cannot be activated and no application can select it — the
 * API's `selectable` filter excludes a scheme with no ACTIVE duration row, so a
 * scheme without terms is invisible to the wizard however correct it otherwise
 * looks.
 *
 * `LoanSchemeList` has always linked here and this route did not exist, so the
 * only way to add a term was a direct API call or a seed script. That also made
 * the frequency list unreachable in practice: the wizard offers only frequencies
 * some scheme carries a term for, so "Daily" or a five-year monthly option could
 * not be introduced through the product at all.
 *
 * # Why the frequency and duration are two separate controls
 *
 * They are stored as a pair and validated as a pair — `(frequency,
 * durationCount)` is the unique key, and `assertSelectable` matches on both. 12
 * monthly being offered says nothing about 12 weekly, so the form makes the user
 * state each explicitly rather than inferring a unit from the number.
 */
export default function LoanSchemeDetail({
  scheme,
  canManage = false,
}: {
  scheme: SchemeDetail;
  canManage?: boolean;
}) {
  const [addState, addAction] = useActionState(addSchemeDurationAction, {});
  const [statusState, statusAction] = useActionState(
    setDurationStatusAction,
    {},
  );
  const [schemeState, schemeAction] = useActionState(setSchemeStatusAction, {});

  const active = scheme.durations.filter((row) => row.status === "ACTIVE");

  /**
   * Activation is gated on a live term rather than merely offered and refused.
   * The API enforces it; hiding the control when it cannot succeed is the
   * honest presentation of the same rule.
   */
  const activatable = active.length > 0;

  return (
    <div className="space-y-6">
      {/* --- identity and price ------------------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {scheme.name}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {scheme.code} · {scheme.productName} (
            {labelFor(LOAN_TYPE_OPTIONS, scheme.loanType)}) ·{" "}
            {labelFor(INTEREST_TYPE_OPTIONS, scheme.interestType)} at{" "}
            {formatBps(scheme.interestRateBps)}
          </p>
        </div>
        <ConfigStatusBadge status={scheme.status} />
      </div>

      {schemeState.message && (
        <Alert
          variant="error"
          title="Could not change the scheme's status"
          message={schemeState.message}
        />
      )}
      {schemeState.success && (
        <Alert variant="success" title="Saved" message={schemeState.success} />
      )}

      {/* --- lifecycle ---------------------------------------------------- */}
      {canManage && (
        <form action={schemeAction} className="flex items-center gap-3">
          <input type="hidden" name="schemeId" value={scheme.loanSchemeId} />
          <input
            type="hidden"
            name="status"
            value={scheme.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"}
          />
          {/* Optimistic concurrency: a stale version is a 409 rather than a
              silent overwrite of another admin's change. */}
          <input type="hidden" name="expectedVersion" value={scheme.version} />
          {scheme.status === "ACTIVE" ? (
            <SubmitButton label="Withdraw scheme" pendingLabel="Withdrawing…" />
          ) : (
            activatable && (
              <SubmitButton
                label="Activate scheme"
                pendingLabel="Activating…"
              />
            )
          )}
          {scheme.status !== "ACTIVE" && !activatable && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Add at least one duration option before activating this scheme.
            </p>
          )}
        </form>
      )}

      {/* --- the terms ---------------------------------------------------- */}
      <div>
        <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Duration options
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          The repayment terms a borrower may choose. A frequency appears in the
          application wizard only while this scheme offers an active term for
          it.
        </p>
      </div>

      {addState.message && (
        <Alert
          variant="error"
          title="Could not add the option"
          message={addState.message}
        />
      )}
      {addState.success && (
        <Alert variant="success" title="Saved" message={addState.success} />
      )}
      {statusState.message && (
        <Alert
          variant="error"
          title="Could not update the option"
          message={statusState.message}
        />
      )}
      {statusState.success && (
        <Alert variant="success" title="Saved" message={statusState.success} />
      )}

      {canManage && (
        <form
          action={addAction}
          noValidate
          className="grid gap-4 rounded-2xl border border-gray-200 p-4 sm:grid-cols-3 dark:border-gray-800"
        >
          <input type="hidden" name="schemeId" value={scheme.loanSchemeId} />
          <SelectField
            name="frequency"
            label="Frequency"
            required
            options={REPAYMENT_FREQUENCY_OPTIONS}
            errors={addState.errors?.frequency}
          />
          {/* A count of periods, not of months: 12 means twelve of whatever the
              frequency above is. The API caps it at 10,000, which is generous
              even for a daily product. */}
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Number of periods <span className="text-error-500">*</span>
            </span>
            <input
              name="durationCount"
              inputMode="numeric"
              required
              placeholder="12"
              className="focus:border-brand-300 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
            />
            <span className="mt-1.5 block text-xs text-gray-500 dark:text-gray-400">
              12 monthly is one year; 100 daily is roughly three months.
            </span>
            {addState.errors?.durationCount?.[0] && (
              <span className="text-error-500 mt-1.5 block text-xs">
                {addState.errors.durationCount[0]}
              </span>
            )}
          </label>
          <div className="flex items-end">
            <SubmitButton label="Add option" pendingLabel="Adding…" />
          </div>

          {/* A range, for a term the borrower states rather than picks.
              Offered on every frequency because the rule is the same, but it is
              daily loans that need it: those are sold as "until this date", so
              the count is whatever the dates imply and no published list can
              cover it. Leave both blank for an ordinary fixed term. */}
          <fieldset className="rounded-lg border border-gray-200 p-4 sm:col-span-3 dark:border-gray-800">
            <legend className="px-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              Allow any duration in a range (optional)
            </legend>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              Leave blank for a fixed term. Set both to let the borrower choose
              any number of periods between them — the number above becomes the
              default. Use this for daily loans, which run to a date.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm text-gray-700 dark:text-gray-300">
                  Minimum periods
                </span>
                <input
                  name="minDurationCount"
                  inputMode="numeric"
                  placeholder="30"
                  className="focus:border-brand-300 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
                />
                {addState.errors?.minDurationCount?.[0] && (
                  <span className="text-error-500 mt-1.5 block text-xs">
                    {addState.errors.minDurationCount[0]}
                  </span>
                )}
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm text-gray-700 dark:text-gray-300">
                  Maximum periods
                </span>
                <input
                  name="maxDurationCount"
                  inputMode="numeric"
                  placeholder="180"
                  className="focus:border-brand-300 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
                />
                {addState.errors?.maxDurationCount?.[0] && (
                  <span className="text-error-500 mt-1.5 block text-xs">
                    {addState.errors.maxDurationCount[0]}
                  </span>
                )}
              </label>
            </div>
          </fieldset>
        </form>
      )}

      {scheme.durations.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          No duration options yet. This scheme cannot be activated, and no
          application can select it, until one is added.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-white/[0.02]">
              <tr>
                <th className="px-5 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Frequency
                </th>
                <th className="px-5 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Periods
                </th>
                <th className="px-5 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Status
                </th>
                {canManage && (
                  <th className="px-5 py-3 font-medium text-gray-500 dark:text-gray-400">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {scheme.durations.map((row) => (
                <tr key={row.loanSchemeDurationId}>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                    {labelFor(REPAYMENT_FREQUENCY_OPTIONS, row.frequency)}
                  </td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                    {row.minDurationCount !== null &&
                    row.maxDurationCount !== null ? (
                      <>
                        {row.minDurationCount}–{row.maxDurationCount}
                        <span className="block text-xs text-gray-500 dark:text-gray-400">
                          any, default {row.durationCount}
                        </span>
                      </>
                    ) : (
                      row.durationCount
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <ConfigStatusBadge status={row.status} />
                  </td>
                  {canManage && (
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-3">
                        <form action={statusAction}>
                          <input
                            type="hidden"
                            name="schemeId"
                            value={scheme.loanSchemeId}
                          />
                          <input
                            type="hidden"
                            name="durationId"
                            value={row.loanSchemeDurationId}
                          />
                          <input
                            type="hidden"
                            name="intent"
                            value={
                              row.status === "ACTIVE"
                                ? "deactivate"
                                : "activate"
                            }
                          />
                          <button
                            type="submit"
                            className="text-brand-500 text-sm hover:underline"
                          >
                            {row.status === "ACTIVE"
                              ? "Deactivate"
                              : "Activate"}
                          </button>
                        </form>
                        {/* Deletion is refused by the API once an application
                            has used the term — an application stores the pair as
                            values, with no foreign key to protect it. The button
                            is offered anyway so the refusal explains itself
                            rather than the option silently missing. */}
                        <form action={statusAction}>
                          <input
                            type="hidden"
                            name="schemeId"
                            value={scheme.loanSchemeId}
                          />
                          <input
                            type="hidden"
                            name="durationId"
                            value={row.loanSchemeDurationId}
                          />
                          <input type="hidden" name="intent" value="delete" />
                          <button
                            type="submit"
                            className="text-error-500 text-sm hover:underline"
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
