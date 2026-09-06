"use client";

import type { CustomerDetail } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import {
  CUSTOMER_TYPE_OPTIONS,
  customerTypeSchema,
  withStoredValue,
  type SelectOption,
} from "@lms/validation";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

// Only `SelectField`: this file has its own local `Field`, which predates the
// shared primitives and differs slightly. Consolidating the two is worth doing
// but is a change to every input on this form, not a drive-by.
import { SelectField } from "@/components/form/FormFields";
import {
  createCustomerAction,
  updateCustomerAction,
  type CustomerFormState,
} from "../actions/customer-actions";

/**
 * Customer registration and profile edit (Module 04, Scenarios 1-5, 23).
 *
 * One component for both, because the fields are the same and the differences
 * are three: create asks for a customer type, edit carries a version handle, and
 * only create can surface a duplicate. Two components would mean two places to
 * keep a field list in step.
 *
 * **Customer type is a required choice with no default.** Scenario 3 requires
 * creation without it to be rejected, and a pre-selected radio would make that
 * unreachable from the UI — the user would never see the rule that exists to
 * stop an accidental KYC customer being created as LOCAL.
 *
 * The type selector explains what each choice commits the branch to, because
 * choosing wrongly is expensive: a LOCAL customer skips document collection
 * entirely, and undoing that means a conversion only a Super Admin can perform.
 */

const initial: CustomerFormState = {};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Field({
  name,
  label,
  errors,
  required = false,
  type = "text",
  defaultValue,
  maxLength,
  placeholder,
}: {
  name: string;
  label: string;
  errors?: string[];
  required?: boolean;
  type?: string;
  defaultValue?: string;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
      >
        {label}
        {required && <span className="text-error-500"> *</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={errors ? true : undefined}
        aria-describedby={errors ? `${name}-error` : undefined}
        className="shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:ring-3 focus:outline-hidden dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30"
      />
      {errors && (
        <p id={`${name}-error`} className="text-error-500 mt-1.5 text-sm">
          {errors[0]}
        </p>
      )}
    </div>
  );
}

export default function CustomerForm({
  customer,
  branches = [],
  needsBranch = false,
  genderOptions = [],
}: {
  /** Absent when registering; present when editing. */
  customer?: CustomerDetail;
  /** Offered only to an organization-wide caller, who has no branch of their own. */
  branches?: Array<{ branchId: string; name: string }>;
  needsBranch?: boolean;
  /**
   * From the GENDER master-data list, fetched by the page. Empty renders a
   * select with only the placeholder — the field is optional, so a failed
   * lookup costs this one field rather than the whole form.
   */
  genderOptions?: SelectOption[];
}) {
  const editing = customer !== undefined;
  const [state, formAction] = useActionState(
    editing ? updateCustomerAction : createCustomerAction,
    initial,
  );
  const [customerType, setCustomerType] = useState<"KYC" | "LOCAL" | "">("");

  const errors = state.errors ?? {};

  return (
    <form action={formAction} className="space-y-6">
      {editing && (
        <>
          <input type="hidden" name="customerId" value={customer.customerId} />
          {/*
            The version the form was rendered with (Q-CUST-22). A stale tab
            submitting this is refused by the server rather than overwriting a
            change someone else committed in the meantime.
          */}
          <input
            type="hidden"
            name="expectedVersion"
            value={customer.version}
          />
        </>
      )}

      {state.message && (
        <Alert variant="error" title="Could not save" message={state.message} />
      )}
      {state.success && (
        <Alert variant="success" title="Saved" message={state.success} />
      )}

      {/*
        Scenario 5 — the duplicate is named rather than described, so the user
        can tell whether this really is the same person before overriding.
      */}
      {state.duplicateOf && state.duplicateOf.length > 0 && (
        <div className="border-warning-300 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/10 rounded-2xl border p-4">
          <p className="text-sm font-medium text-gray-800 dark:text-white/90">
            A customer with this mobile number already exists
          </p>
          <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            {state.duplicateOf.map((match) => (
              <li key={match.customerId}>
                {match.fullName} ({match.customerCode}) — {match.status}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            Continue only if this is a different person sharing the number.
          </p>
          <div className="mt-3">
            {/* The override is its own submit, so it can never be the default. */}
            <button
              type="submit"
              name="force"
              value="true"
              className="bg-warning-500 hover:bg-warning-600 rounded-lg px-4 py-2 text-sm font-medium text-white"
            >
              Create anyway
            </button>
          </div>
        </div>
      )}

      {!editing && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-400">
            Customer Type <span className="text-error-500">*</span>
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {CUSTOMER_TYPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`cursor-pointer rounded-2xl border p-4 ${
                  customerType === option.value
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                    : "border-gray-200 dark:border-gray-800"
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="customerType"
                    value={option.value}
                    checked={customerType === option.value}
                    // The registry carries `string` values, while this state is
                    // the narrow union the branch logic below depends on. Parse
                    // rather than cast, so an option that is not a customer type
                    // cannot reach the state at all.
                    onChange={() => {
                      const parsed = customerTypeSchema.safeParse(option.value);
                      if (parsed.success) setCustomerType(parsed.data);
                    }}
                    className="h-4 w-4"
                  />
                  <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {option.label}
                  </span>
                </span>
                <span className="mt-1.5 block text-xs text-gray-500 dark:text-gray-400">
                  {option.hint}
                </span>
              </label>
            ))}
          </div>
          {errors.customerType && (
            <p className="text-error-500 mt-1.5 text-sm">
              {errors.customerType[0]}
            </p>
          )}
        </fieldset>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="fullName"
          label="Full Name"
          required
          maxLength={200}
          defaultValue={customer?.fullName}
          errors={errors.fullName}
        />
        <Field
          name="mobile"
          label="Mobile Number"
          required
          maxLength={10}
          defaultValue={customer?.mobile}
          errors={errors.mobile}
          placeholder="10-digit number"
        />
        <Field
          name="email"
          label="Email"
          type="email"
          maxLength={320}
          defaultValue={customer?.email}
          errors={errors.email}
        />
        <Field
          name="dateOfBirth"
          label="Date of Birth"
          type="date"
          defaultValue={customer?.dateOfBirth}
          errors={errors.dateOfBirth}
        />
        <SelectField
          name="gender"
          label="Gender"
          placeholder="Not specified"
          // A record saved before this became a managed list — or under a value
          // since retired — keeps its own value as an option. Without this the
          // select would fall back to the placeholder and silently blank a
          // field the user never touched when they save an unrelated edit.
          options={withStoredValue(genderOptions, customer?.gender)}
          defaultValue={customer?.gender ?? ""}
          errors={errors.gender}
        />

        {needsBranch && !editing && (
          <SelectField
            name="branchId"
            label="Branch"
            required
            placeholder="Select a branch"
            options={branches.map((branch) => ({
              value: branch.branchId,
              label: branch.name,
            }))}
          />
        )}
      </div>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-400">
          Address
        </legend>
        <Field
          name="addressLine1"
          label="Address Line 1"
          required
          maxLength={250}
          defaultValue={customer?.addressLine1}
          errors={errors.addressLine1}
        />
        <Field
          name="addressLine2"
          label="Address Line 2"
          maxLength={250}
          defaultValue={customer?.addressLine2}
          errors={errors.addressLine2}
        />
        <Field
          name="city"
          label="City / Town"
          maxLength={100}
          defaultValue={customer?.city}
          errors={errors.city}
        />
        <Field
          name="state"
          label="State"
          maxLength={100}
          defaultValue={customer?.state}
          errors={errors.state}
        />
        <Field
          name="pincode"
          label="Postal Code"
          maxLength={10}
          defaultValue={customer?.pincode}
          errors={errors.pincode}
        />
      </fieldset>

      <div className="flex justify-end gap-3">
        <SubmitButton label={editing ? "Save Changes" : "Create Customer"} />
      </div>
    </form>
  );
}
