"use client";

import { Alert, Badge } from "@lms/ui";
import type { RetentionPolicyDetail } from "@lms/types";
import React, { useActionState, useState } from "react";

import { Field, SelectField, SubmitButton } from "@/components/form/FormFields";

import {
  createRetentionPolicyAction,
  deleteRetentionPolicyAction,
  setRetentionPolicyStatusAction,
  updateRetentionPolicyAction,
} from "../actions/retention-actions";

/** Mirrors `RetentionRecordCategory`; the API refuses anything else. */
const CATEGORIES = [
  { value: "AUDIT_LOG", label: "Audit log" },
  { value: "LEDGER_ENTRY", label: "Ledger entry" },
  { value: "JOURNAL_ENTRY", label: "Journal entry" },
  { value: "NOTIFICATION_LOG", label: "Notification log" },
  { value: "MAINTENANCE_JOB", label: "Maintenance job" },
  { value: "USER_SESSION", label: "User session" },
  { value: "REPORT_RUN", label: "Report run" },
] as const;

const CATEGORY_LABEL = new Map(CATEGORIES.map((c) => [c.value, c.label]));

/** "—" rather than "0": null means never, and 0 days would mean immediately. */
function days(value: number | null): string {
  return value === null ? "—" : `${value} days`;
}

/**
 * Data retention policies (Scenarios 55-58).
 *
 * # Immutable evidence shows why, rather than hiding the field
 *
 * A policy over audit, ledger or journal records can never carry a purge
 * schedule (Rule 76). The purge input is disabled with the reason stated, not
 * removed: an absent field reads as an oversight, while a disabled one with an
 * explanation teaches the rule.
 *
 * # Delete is offered only where it is possible
 *
 * `deletable` comes from the API — false once the policy has governed real
 * processing. Deactivate is offered in its place rather than a Delete button
 * certain to be refused, but the server is still the enforcement (Scenario 56).
 */
export default function RetentionPolicyList({
  policies,
  loadError = false,
  canManage = false,
}: {
  policies: RetentionPolicyDetail[];
  loadError?: boolean;
  canManage?: boolean;
}) {
  const [createState, createAction] = useActionState(
    createRetentionPolicyAction,
    {},
  );
  const [editState, editAction] = useActionState(
    updateRetentionPolicyAction,
    {},
  );
  const [statusState, statusAction] = useActionState(
    setRetentionPolicyStatusAction,
    {},
  );
  const [deleteState, deleteAction] = useActionState(
    deleteRetentionPolicyAction,
    {},
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("");

  if (loadError) {
    return (
      <Alert
        variant="error"
        title="Retention policies unavailable"
        message="We could not load the retention policies. Refresh to try again."
      />
    );
  }

  const success =
    createState.success ??
    editState.success ??
    statusState.success ??
    deleteState.success;
  const failure =
    createState.message ??
    editState.message ??
    statusState.message ??
    deleteState.message;

  // Immutability is a property of the CATEGORY, and the API derives it the same
  // way — this only decides whether to offer the input.
  const newIsImmutable = [
    "AUDIT_LOG",
    "LEDGER_ENTRY",
    "JOURNAL_ENTRY",
  ].includes(category);

  return (
    <div className="space-y-5">
      {success ? (
        <Alert variant="success" title="Done" message={success} />
      ) : null}
      {failure ? (
        <Alert variant="error" title="Not applied" message={failure} />
      ) : null}

      {policies.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No retention policies are configured. Nothing is archived or purged
          until one is.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-gray-200 text-xs text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">Policy</th>
                <th className="px-3 py-2">Retain</th>
                <th className="px-3 py-2">Archive</th>
                <th className="px-3 py-2">Purge</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr
                  key={policy.retentionPolicyId}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="px-3 py-3">
                    <div className="font-medium text-gray-800 dark:text-white/90">
                      {policy.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {CATEGORY_LABEL.get(policy.recordCategory) ??
                        policy.recordCategory}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {policy.immutableEvidence ? (
                        <Badge color="warning">Protected evidence</Badge>
                      ) : null}
                      {policy.legalHoldSupported ? (
                        <Badge color="info">Legal hold</Badge>
                      ) : null}
                      {!policy.deletable ? (
                        <Badge color="light">In use</Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-700 dark:text-gray-300">
                    {days(policy.retentionPeriodDays)}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-700 dark:text-gray-300">
                    {days(policy.archiveAfterDays)}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-700 dark:text-gray-300">
                    {/* Never, and for a stated reason — an empty cell here would
                        read as "not configured yet" (Rule 76). */}
                    {policy.immutableEvidence ? (
                      <span className="text-gray-500 dark:text-gray-400">
                        Never — protected
                      </span>
                    ) : (
                      days(policy.purgeAfterDays)
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Badge
                      color={policy.status === "ACTIVE" ? "success" : "light"}
                    >
                      {policy.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-right">
                    {canManage ? (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setEditing(
                              editing === policy.retentionPolicyId
                                ? null
                                : policy.retentionPolicyId,
                            )
                          }
                          className="text-brand-500 text-xs font-medium hover:underline"
                        >
                          {editing === policy.retentionPolicyId
                            ? "Cancel"
                            : "Edit"}
                        </button>

                        <form action={statusAction}>
                          <input
                            type="hidden"
                            name="retentionPolicyId"
                            value={policy.retentionPolicyId}
                          />
                          <input
                            type="hidden"
                            name="expectedVersion"
                            value={policy.version}
                          />
                          <input
                            type="hidden"
                            name="status"
                            value={
                              policy.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"
                            }
                          />
                          <button
                            type="submit"
                            className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                          >
                            {policy.status === "ACTIVE"
                              ? "Deactivate"
                              : "Reactivate"}
                          </button>
                        </form>

                        {/* Scenario 56: a policy that has governed processing is
                            retired by deactivation, never deleted. */}
                        {policy.deletable ? (
                          <form action={deleteAction}>
                            <input
                              type="hidden"
                              name="retentionPolicyId"
                              value={policy.retentionPolicyId}
                            />
                            <button
                              type="submit"
                              className="text-error-500 text-xs font-medium hover:underline"
                            >
                              Delete
                            </button>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && editing
        ? (() => {
            const policy = policies.find(
              (p) => p.retentionPolicyId === editing,
            );
            if (!policy) return null;

            return (
              <form
                action={editAction}
                className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
              >
                <input
                  type="hidden"
                  name="retentionPolicyId"
                  value={policy.retentionPolicyId}
                />
                <input
                  type="hidden"
                  name="expectedVersion"
                  value={policy.version}
                />

                <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
                  Edit {policy.name}
                </h3>

                <Field
                  label="Policy Name"
                  name="name"
                  defaultValue={policy.name}
                  errors={editState.errors?.name}
                />
                <Field
                  label="Retention Period (days)"
                  name="retentionPeriodDays"
                  inputMode="numeric"
                  defaultValue={String(policy.retentionPeriodDays)}
                  errors={editState.errors?.retentionPeriodDays}
                />
                <Field
                  label="Archive After (days)"
                  name="archiveAfterDays"
                  inputMode="numeric"
                  defaultValue={policy.archiveAfterDays?.toString() ?? ""}
                  hint="Leave blank to never archive."
                  errors={editState.errors?.archiveAfterDays}
                />

                {policy.immutableEvidence ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    This category is protected financial, ledger or audit
                    evidence and can never be purged, so no purge schedule can
                    be set.
                  </p>
                ) : (
                  <Field
                    label="Purge After (days)"
                    name="purgeAfterDays"
                    inputMode="numeric"
                    defaultValue={policy.purgeAfterDays?.toString() ?? ""}
                    hint="Leave blank to never purge. Cannot be earlier than the retention period."
                    errors={editState.errors?.purgeAfterDays}
                  />
                )}

                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    name="legalHoldSupported"
                    defaultChecked={policy.legalHoldSupported}
                  />
                  Records in this category can carry a legal hold
                </label>

                <SubmitButton label="Save" />
              </form>
            );
          })()
        : null}

      {canManage ? (
        <form
          action={createAction}
          className="space-y-4 rounded-xl border border-dashed border-gray-300 p-4 dark:border-gray-700"
        >
          <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
            Add a retention policy
          </h3>

          <Field
            label="Policy Name"
            name="name"
            errors={createState.errors?.name}
          />
          <SelectField
            label="Record Category"
            name="recordCategory"
            options={CATEGORIES.map((c) => ({
              value: c.value,
              label: c.label,
            }))}
            value={category}
            onChange={setCategory}
            errors={createState.errors?.recordCategory}
          />
          <Field
            label="Retention Period (days)"
            name="retentionPeriodDays"
            inputMode="numeric"
            errors={createState.errors?.retentionPeriodDays}
          />
          <Field
            label="Archive After (days)"
            name="archiveAfterDays"
            inputMode="numeric"
            hint="Optional. Leave blank to never archive."
            errors={createState.errors?.archiveAfterDays}
          />

          {newIsImmutable ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              This category is protected financial, ledger or audit evidence and
              can never be purged (Rule 76), so no purge schedule can be set.
            </p>
          ) : (
            <Field
              label="Purge After (days)"
              name="purgeAfterDays"
              inputMode="numeric"
              hint="Optional. Cannot be earlier than the retention period."
              errors={createState.errors?.purgeAfterDays}
            />
          )}

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" name="legalHoldSupported" />
            Records in this category can carry a legal hold
          </label>

          <SubmitButton label="Add policy" />
        </form>
      ) : null}
    </div>
  );
}
