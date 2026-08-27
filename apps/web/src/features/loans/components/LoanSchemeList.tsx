"use client";

import type { LoanProductSummary, LoanSchemeSummary } from "@lms/types";
import { Alert } from "@lms/ui";
import { INTEREST_TYPE_OPTIONS, labelFor } from "@lms/validation";
import Link from "next/link";
import React, { useActionState, useState } from "react";

import { createSchemeAction } from "../actions/loan-config-actions";
import { Field, SelectField, SubmitButton } from "./FormParts";
import { ConfigStatusBadge, formatBps } from "./LoanBadges";

/**
 * Loan schemes (Module 06).
 *
 * A scheme is what an application actually selects: a priced offering under a
 * product, with the frequency/duration pairs a borrower may choose. Those pairs
 * are managed on the scheme's own page, because a scheme without at least one of
 * them cannot be activated.
 */
export default function LoanSchemeList({
  schemes,
  products,
  loadError = false,
  canManage = false,
}: {
  schemes: LoanSchemeSummary[];
  products: LoanProductSummary[];
  loadError?: boolean;
  canManage?: boolean;
}) {
  const [state, formAction] = useActionState(createSchemeAction, {});
  const [open, setOpen] = useState(false);

  const productName = new Map(
    products.map((product) => [product.loanProductId, product.code]),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          A scheme carries the interest type and rate. An application copies
          both at creation, so repricing a scheme never changes an existing
          application.
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="text-brand-500 shrink-0 text-sm hover:underline"
          >
            {open ? "Cancel" : "Add scheme"}
          </button>
        )}
      </div>

      {state.message && (
        <Alert
          variant="error"
          title="Could not create scheme"
          message={state.message}
        />
      )}

      {open && canManage && (
        <form
          action={formAction}
          className="grid gap-4 rounded-2xl border border-gray-200 p-5 sm:grid-cols-2 dark:border-gray-800"
        >
          <SelectField
            name="loanProductId"
            label="Loan Product"
            required
            options={products.map((product) => ({
              value: product.loanProductId,
              label: `${product.name} (${product.code})`,
            }))}
            errors={state.errors?.loanProductId}
          />
          <Field
            name="code"
            label="Scheme Code"
            required
            maxLength={50}
            placeholder="SCH-PERS-RED"
            errors={state.errors?.code}
          />
          <Field
            name="name"
            label="Scheme Name"
            required
            maxLength={150}
            errors={state.errors?.name}
          />
          <SelectField
            name="interestType"
            label="Interest Type"
            required
            options={INTEREST_TYPE_OPTIONS}
            errors={state.errors?.interestType}
          />
          <Field
            name="interestRateBps"
            label="Interest Rate (basis points)"
            required
            inputMode="numeric"
            hint="1200 is 12% a year. Integer basis points, never a decimal."
            errors={state.errors?.interestRateBps}
          />
          <div className="sm:col-span-2">
            <SubmitButton label="Create Scheme" pendingLabel="Creating…" />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Created as a draft. Add at least one duration option before
              activating it.
            </p>
          </div>
        </form>
      )}

      {loadError ? (
        <Alert
          variant="error"
          title="Could not load schemes"
          message="Please refresh the page. If this continues, contact support."
        />
      ) : schemes.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No loan schemes yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase dark:bg-white/[0.03] dark:text-gray-400">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Code
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Name
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Product
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Interest
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {schemes.map((scheme) => (
                <tr
                  key={scheme.loanSchemeId}
                  className="hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                >
                  <td className="px-5 py-4">
                    <Link
                      href={`/loans/schemes/${scheme.loanSchemeId}`}
                      className="text-brand-500 font-medium hover:underline"
                    >
                      {scheme.code}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                    {scheme.name}
                  </td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                    {productName.get(scheme.loanProductId) ?? "—"}
                  </td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                    {labelFor(INTEREST_TYPE_OPTIONS, scheme.interestType)} at{" "}
                    {formatBps(scheme.interestRateBps)}
                  </td>
                  <td className="px-5 py-4">
                    <ConfigStatusBadge status={scheme.status} />
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
