"use client";

import type { LoanProductSummary } from "@lms/types";
import { Alert } from "@lms/ui";
import { LOAN_TYPE_OPTIONS, labelFor } from "@lms/validation";
import Link from "next/link";
import React, { useActionState, useState } from "react";

import { createProductAction } from "../actions/loan-config-actions";
import { Field, SelectField, SubmitButton } from "./FormParts";
import { ConfigStatusBadge } from "./LoanBadges";

/**
 * Loan products (Module 06).
 *
 * The create form is inline rather than on its own route: a product is three
 * fields, and a separate page for three fields is a navigation nobody wants.
 * Schemes get their own detail page because they carry duration options.
 *
 * `canManage` hides the form from a Branch Admin, who holds `loans.products.view`
 * and nothing else. Hiding is not the control — the API refuses the write — but
 * offering a form that is certain to be refused would be dishonest.
 */
export default function LoanProductList({
  products,
  loadError = false,
  canManage = false,
}: {
  products: LoanProductSummary[];
  loadError?: boolean;
  canManage?: boolean;
}) {
  const [state, formAction] = useActionState(createProductAction, {});
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Products group the schemes a borrower can apply against, and carry the
          loan type.
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="text-brand-500 text-sm hover:underline"
          >
            {open ? "Cancel" : "Add product"}
          </button>
        )}
      </div>

      {state.message && (
        <Alert
          variant="error"
          title="Could not create product"
          message={state.message}
        />
      )}

      {open && canManage && (
        <form
          action={formAction}
          className="grid gap-4 rounded-2xl border border-gray-200 p-5 sm:grid-cols-3 dark:border-gray-800"
        >
          <Field
            name="code"
            label="Product Code"
            required
            maxLength={50}
            placeholder="PROD-PERSONAL"
            errors={state.errors?.code}
            hint="Uppercase letters, digits, hyphen and underscore."
          />
          <Field
            name="name"
            label="Product Name"
            required
            maxLength={150}
            errors={state.errors?.name}
          />
          <SelectField
            name="loanType"
            label="Loan Type"
            required
            options={LOAN_TYPE_OPTIONS}
            errors={state.errors?.loanType}
          />
          <div className="sm:col-span-3">
            <SubmitButton label="Create Product" pendingLabel="Creating…" />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Created as a draft. A product with no schemes cannot be borrowed
              against, so it is not offered until you activate it.
            </p>
          </div>
        </form>
      )}

      {loadError ? (
        <Alert
          variant="error"
          title="Could not load products"
          message="Please refresh the page. If this continues, contact support."
        />
      ) : products.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No loan products yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase dark:bg-white/[0.03] dark:text-gray-400">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Code
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Name
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Type
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {products.map((product) => (
                <tr
                  key={product.loanProductId}
                  className="hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                >
                  <td className="px-5 py-4">
                    <Link
                      href={`/loans/products/${product.loanProductId}`}
                      className="text-brand-500 font-medium hover:underline"
                    >
                      {product.code}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                    {product.name}
                  </td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                    {labelFor(LOAN_TYPE_OPTIONS, product.loanType)}
                  </td>
                  <td className="px-5 py-4">
                    <ConfigStatusBadge status={product.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
