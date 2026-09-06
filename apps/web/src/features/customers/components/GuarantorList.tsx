"use client";

import type { GuarantorSummary } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import { withStoredValue, type SelectOption } from "@lms/validation";
import Link from "next/link";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { SelectField } from "@/components/form/FormFields";
// Module import, not the barrel: the barrel re-exports `server-only` api code,
// which a client component cannot pull in. See GuarantorDetail for the detail.
import {
  GuarantorKycStatusBadge,
  GuarantorStatusBadge,
} from "@/features/guarantors/components/GuarantorStatusBadge";
import {
  createGuarantorAction,
  deleteGuarantorAction,
  recordConsentAction,
  updateGuarantorAction,
  type GuarantorDuplicate,
  type GuarantorFormState,
} from "../actions/guarantor-actions";
import { ConsentStatusBadge } from "./CustomerStatusBadge";

/**
 * Guarantors and consent (Module 04 Scenarios 24-26; Module 05 throughout).
 *
 * Consent is recorded through its own control rather than as a field on the add
 * form, matching the API. That is not a layout preference: a guarantor created
 * already consenting would be an agreement nobody gave, and the two-step shape
 * is what makes the consent a deliberate act with its own timestamp.
 *
 * Whether a guarantor is *required* is not decided here. Rule 3 puts that with
 * the loan product, so this panel stores guarantors and never nags for one — a
 * customer with none is a legitimate state.
 *
 * **Deactivate and Remove are different actions with different permissions.**
 * Removal is refused once a loan refers to the guarantor (Scenario 32), and
 * deactivation is the sanctioned alternative that keeps the history (Rule 34).
 * Showing only one control would leave staff unable to do the thing the API
 * would actually accept.
 *
 * Editing and consent are hidden on an inactive guarantor rather than shown and
 * refused: the server rejects both (Rule 36), and offering a control that cannot
 * work reads as a bug rather than a rule.
 */

const initial: GuarantorFormState = {};

// `relationship` is deliberately absent: it is a master-data dropdown rather
// than a text input, so it is rendered separately after this loop.
const FIELDS = [
  ["fullName", "Full Name", true, 200],
  ["mobile", "Mobile Number", true, 10],
  // Required for a guarantor, unlike the customer's own address
  // (Module 05 Rule 13, Scenario 9).
  ["address", "Address", true, 500],
] as const;

function SubmitButton({
  label,
  variant = "primary",
}: {
  label: string;
  variant?: "primary" | "outline";
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

/** The add and edit forms differ only in their defaults and their action. */
function GuarantorFields({
  errors,
  guarantor,
  relationshipOptions,
}: {
  errors: Record<string, string[] | undefined>;
  guarantor?: GuarantorSummary;
  relationshipOptions: SelectOption[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {FIELDS.map(([name, label, required, maxLength]) => (
        <div key={name}>
          <label
            htmlFor={`guarantor-${guarantor?.guarantorId ?? "new"}-${name}`}
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            {label}
            {required && <span className="text-error-500"> *</span>}
          </label>
          <input
            id={`guarantor-${guarantor?.guarantorId ?? "new"}-${name}`}
            name={name}
            maxLength={maxLength}
            defaultValue={guarantor?.[name] ?? ""}
            aria-invalid={errors[name] ? true : undefined}
            className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm dark:border-gray-700 dark:text-white/90"
          />
          {errors[name] && (
            <p className="text-error-500 mt-1.5 text-sm">{errors[name]?.[0]}</p>
          )}
        </div>
      ))}

      <SelectField
        name="relationship"
        label="Relationship"
        placeholder="Not specified"
        // Keeps whatever the record already holds selectable — these were free
        // text before this became a managed list, so existing guarantors carry
        // values that are not in it.
        options={withStoredValue(relationshipOptions, guarantor?.relationship)}
        defaultValue={guarantor?.relationship ?? ""}
        errors={errors.relationship}
      />
    </div>
  );
}

export default function GuarantorList({
  customerId,
  guarantors,
  canManage = false,
  canView = false,
  canDeactivate = false,
  canDelete = false,
  relationshipOptions = [],
}: {
  customerId: string;
  guarantors: GuarantorSummary[];
  canManage?: boolean;
  canView?: boolean;
  canDeactivate?: boolean;
  canDelete?: boolean;
  /**
   * From the RELATIONSHIP master-data list, fetched by the page. Empty renders
   * a select with only the placeholder — the field is optional, so a failed
   * lookup costs this one field rather than the whole form.
   */
  relationshipOptions?: SelectOption[];
}) {
  const [createState, createFormAction] = useActionState(
    createGuarantorAction,
    initial,
  );
  const [updateState, updateFormAction] = useActionState(
    updateGuarantorAction,
    initial,
  );
  const [consentState, consentFormAction] = useActionState(
    recordConsentAction,
    initial,
  );
  const [deleteState, deleteFormAction] = useActionState(
    deleteGuarantorAction,
    initial,
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const state = createState.message
    ? createState
    : updateState.message
      ? updateState
      : consentState.message
        ? consentState
        : deleteState;

  const errors = createState.errors ?? {};
  const editErrors = updateState.errors ?? {};

  /**
   * Scenario 10 — the API refused because this mobile is already on the
   * customer. The match is named and the resubmission carries `force`, so the
   * override is a deliberate act rather than a retry that quietly succeeds.
   */
  const duplicates = (createState as { duplicateOf?: GuarantorDuplicate[] })
    .duplicateOf;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
          Guarantors
        </h3>
        {canManage && !adding && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAdding(true)}
          >
            Add Guarantor
          </Button>
        )}
      </div>

      {state.message && (
        <Alert
          variant="error"
          title="Could not continue"
          message={state.message}
        />
      )}
      {state.success && (
        <Alert variant="success" title="Done" message={state.success} />
      )}

      {/* Scenarios 32, 55 — what is in the way, and what to do instead. */}
      {state.blockedBy && state.blockedBy.length > 0 && (
        <div className="rounded-2xl border border-gray-200 p-4 text-sm dark:border-gray-800">
          <p className="text-gray-600 dark:text-gray-300">
            Referenced by:{" "}
            {state.blockedBy
              .map((blocker) => `${blocker.label} (${blocker.count})`)
              .join(", ")}
          </p>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            Deactivate the guarantor instead — historical loan records are kept.
          </p>
        </div>
      )}

      {guarantors.length === 0 && !adding ? (
        <p
          className="rounded-2xl border border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
          role="status"
        >
          No guarantors recorded for this customer.
        </p>
      ) : (
        <ul className="space-y-3">
          {guarantors.map((guarantor) => {
            const inactive = guarantor.status === "INACTIVE";

            return (
              <li
                key={guarantor.guarantorId}
                className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                      {canView ? (
                        <Link
                          href={`/guarantors/${guarantor.guarantorId}`}
                          className="text-brand-500 hover:underline"
                        >
                          {guarantor.fullName}
                        </Link>
                      ) : (
                        guarantor.fullName
                      )}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {guarantor.mobile}
                      {guarantor.relationship
                        ? ` · ${guarantor.relationship}`
                        : ""}
                    </p>
                    {guarantor.address && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {guarantor.address}
                      </p>
                    )}
                    {/*
                      Scenario 25 — the decision and when it was made. The
                      timestamp appears only for GIVEN, because a rejection has a
                      decision but no consent.
                    */}
                    {guarantor.consentAt && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Consent recorded{" "}
                        {new Date(guarantor.consentAt).toLocaleString()}
                      </p>
                    )}
                    {inactive && guarantor.deactivationReason && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Deactivated: {guarantor.deactivationReason}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <GuarantorStatusBadge status={guarantor.status} />
                    <ConsentStatusBadge status={guarantor.consentStatus} />
                    <GuarantorKycStatusBadge status={guarantor.kycStatus} />

                    {canManage &&
                      !inactive &&
                      guarantor.consentStatus !== "GIVEN" && (
                        <form action={consentFormAction}>
                          <input
                            type="hidden"
                            name="customerId"
                            value={customerId}
                          />
                          <input
                            type="hidden"
                            name="guarantorId"
                            value={guarantor.guarantorId}
                          />
                          <input
                            type="hidden"
                            name="expectedVersion"
                            value={guarantor.version}
                          />
                          <input
                            type="hidden"
                            name="consentStatus"
                            value="GIVEN"
                          />
                          <SubmitButton
                            label="Record Consent"
                            variant="outline"
                          />
                        </form>
                      )}

                    {canManage && !inactive && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEditing(
                            editing === guarantor.guarantorId
                              ? null
                              : guarantor.guarantorId,
                          )
                        }
                      >
                        {editing === guarantor.guarantorId ? "Close" : "Edit"}
                      </Button>
                    )}

                    {/*
                      Deactivation lives on the guarantor detail screen, where
                      the reason it requires has room and the consequences can be
                      stated. Linking there beats a second confirmation dialog.
                    */}
                    {canDeactivate && canView && (
                      <Link href={`/guarantors/${guarantor.guarantorId}`}>
                        <Button type="button" size="sm" variant="outline">
                          {inactive ? "Reactivate" : "Deactivate"}
                        </Button>
                      </Link>
                    )}

                    {canDelete && (
                      <form action={deleteFormAction}>
                        <input
                          type="hidden"
                          name="customerId"
                          value={customerId}
                        />
                        <input
                          type="hidden"
                          name="guarantorId"
                          value={guarantor.guarantorId}
                        />
                        <SubmitButton label="Remove" variant="outline" />
                      </form>
                    )}
                  </div>
                </div>

                {canManage && editing === guarantor.guarantorId && (
                  <form
                    action={updateFormAction}
                    className="mt-4 space-y-4 border-t border-gray-200 pt-4 dark:border-gray-800"
                  >
                    <input type="hidden" name="customerId" value={customerId} />
                    <input
                      type="hidden"
                      name="guarantorId"
                      value={guarantor.guarantorId}
                    />
                    {/* Scenario 46 — refuses a write over a change not seen. */}
                    <input
                      type="hidden"
                      name="expectedVersion"
                      value={guarantor.version}
                    />

                    <GuarantorFields
                      errors={editErrors}
                      guarantor={guarantor}
                      relationshipOptions={relationshipOptions}
                    />

                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Changing the mobile number resets consent to pending — the
                      person who agreed may not be the person now recorded.
                    </p>

                    <div className="flex justify-end gap-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                      <SubmitButton label="Save Changes" />
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && adding && (
        <form
          action={createFormAction}
          className="space-y-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-800"
        >
          <input type="hidden" name="customerId" value={customerId} />

          <GuarantorFields
            errors={errors}
            relationshipOptions={relationshipOptions}
          />

          {duplicates && duplicates.length > 0 && (
            <div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
              <p className="text-gray-600 dark:text-gray-300">
                Already on this customer:{" "}
                {duplicates
                  .map((match) => `${match.fullName} (${match.mobile})`)
                  .join(", ")}
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <input type="checkbox" name="force" value="true" />
                Add this guarantor anyway
              </label>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <SubmitButton label="Add Guarantor" />
          </div>
        </form>
      )}
    </div>
  );
}
