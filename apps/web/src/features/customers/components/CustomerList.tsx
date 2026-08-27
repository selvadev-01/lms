"use client";

import type { CustomerSummary } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState } from "react";

import {
  CustomerStatusBadge,
  CustomerTypeBadge,
  KycStatusBadge,
} from "./CustomerStatusBadge";

/**
 * Customer search and list (Module 04, Scenarios 18-21).
 *
 * One search box over Name / ID / Phone, matching the source. Splitting it into
 * three fields would mean a user who typed a phone number into the "name" box
 * gets nothing back and concludes the customer does not exist.
 *
 * The search submits through the URL rather than local state, so a result set is
 * linkable and survives a refresh — branch staff routinely open a customer, go
 * back, and expect their search still to be there.
 *
 * `loadError` renders as an alert that is deliberately distinct from an empty
 * list: "you have no customers" and "we could not reach your customers" are
 * different claims, and conflating them is the dishonest option.
 */
export default function CustomerList({
  customers,
  loadError = false,
  canCreate = false,
  initialSearch = "",
}: {
  customers: CustomerSummary[];
  loadError?: boolean;
  canCreate?: boolean;
  initialSearch?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(initialSearch);

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams(params.toString());
    const trimmed = term.trim();

    if (trimmed) next.set("search", trimmed);
    else next.delete("search");

    router.push(`/customers${next.size > 0 ? `?${next.toString()}` : ""}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={search} className="flex w-full max-w-md gap-2">
          <input
            type="search"
            name="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search by name, customer ID or phone"
            aria-label="Search customers"
            className="shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:ring-3 focus:outline-hidden dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30"
          />
          <Button size="sm">Search</Button>
        </form>

        {canCreate && (
          <Link href="/customers/new">
            <Button size="sm">Add Customer</Button>
          </Link>
        )}
      </div>

      {loadError ? (
        <Alert
          variant="error"
          title="Customer list unavailable"
          message="We could not load customers just now. Refresh to try again."
        />
      ) : customers.length === 0 ? (
        <div
          className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400"
          role="status"
        >
          {initialSearch
            ? `No customers match "${initialSearch}".`
            : "No customers yet."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="max-w-full overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b border-gray-100 dark:border-gray-800">
                <tr>
                  {[
                    "Customer",
                    "Customer ID",
                    "Mobile",
                    "Type",
                    "KYC",
                    "Status",
                    "Branch",
                  ].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {customers.map((customer) => (
                  <tr key={customer.customerId}>
                    <td className="px-5 py-4 text-sm">
                      <Link
                        href={`/customers/${customer.customerId}`}
                        className="hover:text-brand-500 font-medium text-gray-800 dark:text-white/90"
                      >
                        {customer.fullName}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {customer.customerCode}
                    </td>
                    {/*
                      Masked server-side (Q-CUST-21). The full number is on the
                      profile, which is one record and one audit entry per read.
                    */}
                    <td className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {customer.mobile}
                    </td>
                    <td className="px-5 py-4 text-sm">
                      <CustomerTypeBadge type={customer.customerType} />
                    </td>
                    <td className="px-5 py-4 text-sm">
                      <KycStatusBadge status={customer.kycStatus} />
                    </td>
                    <td className="px-5 py-4 text-sm">
                      <CustomerStatusBadge status={customer.status} />
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {customer.branchName ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
