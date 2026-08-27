"use client";

import { Alert, Badge } from "@lms/ui";
import type { MasterDataCategory } from "@lms/validation";
import React, { useActionState, useState } from "react";

import { Field, SelectField, SubmitButton } from "@/components/form/FormFields";

import {
  createMasterDataValueAction,
  deleteMasterDataValueAction,
  updateMasterDataValueAction,
} from "../actions/master-data-actions";
import type { MasterDataValueDetail } from "../api/master-data";

/**
 * One option list, with inline add and per-row edit.
 *
 * The create form is inline rather than on its own route: a value is three
 * fields, and an admin adding four genders in a row should not navigate four
 * times.
 *
 * `canManage` hides the controls from a Branch Admin, who holds
 * `master_data.view` and nothing else. Hiding is not the control — the API
 * refuses the write — but offering a form certain to be refused is dishonest.
 *
 * A seeded row shows a "Standard" badge and no delete button. That is not the
 * enforcement either (the server returns a 409), it is the row explaining
 * itself: business logic reads these values by code, so deleting one would
 * quietly change behaviour rather than fail loudly.
 */
export default function MasterDataList({
  category,
  values,
  loadError = false,
  canManage = false,
}: {
  category: MasterDataCategory;
  values: MasterDataValueDetail[];
  loadError?: boolean;
  canManage?: boolean;
}) {
  const [createState, createAction] = useActionState(
    createMasterDataValueAction,
    {},
  );
  const [updateState, updateAction] = useActionState(
    updateMasterDataValueAction,
    {},
  );
  const [deleteState, deleteAction] = useActionState(
    deleteMasterDataValueAction,
    {},
  );
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // One banner rather than three: only one form can have been submitted last,
  // and stacking three alert slots would leave stale messages on screen.
  const state = createState.message
    ? createState
    : updateState.message
      ? updateState
      : deleteState.message
        ? deleteState
        : createState.success
          ? createState
          : updateState.success
            ? updateState
            : deleteState;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          These values fill the matching dropdown wherever it appears. Retire
          one by setting it Inactive — existing records keep showing its label.
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setAdding((current) => !current)}
            className="text-brand-500 text-sm hover:underline"
          >
            {adding ? "Cancel" : "Add value"}
          </button>
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

      {/*
        Deliberately distinct from an empty list: "this list has no values" and
        "we could not load it" mean different things to an admin, and collapsing
        them would show a configured list as empty during an outage.
      */}
      {loadError && (
        <Alert
          variant="error"
          title="Could not load these values"
          message="The list could not be read. This is not the same as the list being empty — try again shortly."
        />
      )}

      {adding && canManage && (
        <form
          action={createAction}
          noValidate
          className="grid gap-4 rounded-2xl border border-gray-200 p-4 sm:grid-cols-2 dark:border-gray-800"
        >
          <input type="hidden" name="category" value={category} />
          <Field
            name="code"
            label="Code"
            required
            maxLength={50}
            hint="Stored on the record. Uppercase, digits and underscores."
            errors={createState.errors?.code}
          />
          <Field
            name="label"
            label="Label"
            required
            maxLength={200}
            hint="What the user sees in the dropdown."
            errors={createState.errors?.label}
          />
          <Field
            name="displayOrder"
            label="Display order"
            inputMode="numeric"
            hint="Lower sorts first. Leave blank to add at the end."
            errors={createState.errors?.displayOrder}
          />
          <div className="flex items-end">
            <SubmitButton label="Add value" pendingLabel="Adding…" />
          </div>
        </form>
      )}

      {values.length === 0 && !loadError ? (
        <p
          className="rounded-2xl border border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
          role="status"
        >
          No values configured for this list yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-2xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {values.map((value) => (
            <li key={value.valueId} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {value.label}
                    <span className="ml-2 font-mono text-xs font-normal text-gray-500 dark:text-gray-400">
                      {value.code}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Order {value.displayOrder}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    size="sm"
                    color={value.status === "ACTIVE" ? "success" : "light"}
                  >
                    {value.status === "ACTIVE" ? "Active" : "Inactive"}
                  </Badge>

                  {value.isSystem && (
                    <Badge size="sm" color="info">
                      Standard
                    </Badge>
                  )}

                  {canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditingId((current) =>
                          current === value.valueId ? null : value.valueId,
                        )
                      }
                      className="text-brand-500 text-sm hover:underline"
                    >
                      {editingId === value.valueId ? "Close" : "Edit"}
                    </button>
                  )}

                  {/*
                    No delete button on a seeded row. The server refuses it with
                    a 409 either way; not offering it is how the row says so
                    before the admin spends a click finding out.
                  */}
                  {canManage && !value.isSystem && (
                    <form action={deleteAction} className="inline">
                      <input
                        type="hidden"
                        name="valueId"
                        value={value.valueId}
                      />
                      <SubmitButton
                        label="Delete"
                        pendingLabel="Deleting…"
                        variant="outline"
                      />
                    </form>
                  )}
                </div>
              </div>

              {editingId === value.valueId && canManage && (
                <form
                  action={updateAction}
                  noValidate
                  className="mt-4 grid gap-4 border-t border-gray-200 pt-4 sm:grid-cols-3 dark:border-gray-800"
                >
                  <input type="hidden" name="valueId" value={value.valueId} />
                  {/*
                    `code` is not editable, here or in the API. Business rows
                    store it as a loose string, so a rename would orphan every
                    record already carrying the old value while looking like it
                    worked.
                  */}
                  <Field
                    name="label"
                    label="Label"
                    required
                    maxLength={200}
                    defaultValue={value.label}
                    errors={updateState.errors?.label}
                  />
                  <Field
                    name="displayOrder"
                    label="Display order"
                    inputMode="numeric"
                    defaultValue={String(value.displayOrder)}
                    errors={updateState.errors?.displayOrder}
                  />
                  <SelectField
                    name="status"
                    label="Status"
                    defaultValue={value.status}
                    // A value always has a status, so no blank first option.
                    placeholder=""
                    options={[
                      { value: "ACTIVE", label: "Active" },
                      { value: "INACTIVE", label: "Inactive" },
                    ]}
                    errors={updateState.errors?.status}
                  />
                  <div className="sm:col-span-3">
                    <SubmitButton label="Save changes" />
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
