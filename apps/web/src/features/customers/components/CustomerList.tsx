"use client";

import type { CustomerSummary } from "@lms/types";
import { Alert, Button, DataTable, EmptyState, type Column } from "@lms/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useMemo, useState } from "react";

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
 *
 * The table is `DataTable`; the columns below are the whole of what used to be
 * ~60 lines of hand-rolled `<table>` markup. No column is `sortable` — no list
 * endpoint accepts a sort parameter, and sorting only the loaded page would be
 * a wrong answer wearing the costume of a right one.
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

  const columns = useMemo<Column<CustomerSummary>[]>(
    () => [
      {
        key: "customer",
        header: "Customer",
        priority: "primary",
        cell: (customer) => (
          <Link
            href={`/customers/${customer.customerId}`}
            className="text-ink hover:text-accent focus-visible:ring-focus rounded-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
          >
            {customer.fullName}
          </Link>
        ),
      },
      {
        key: "customerCode",
        header: "Customer ID",
        priority: "primary",
        cell: (customer) => (
          <span className="text-ink-muted tabular">
            {customer.customerCode}
          </span>
        ),
      },
      {
        key: "mobile",
        header: "Mobile",
        // Masked server-side (Q-CUST-21). The full number is on the profile,
        // which is one record and one audit entry per read.
        cell: (customer) => (
          <span className="text-ink-muted tabular">{customer.mobile}</span>
        ),
      },
      {
        key: "type",
        header: "Type",
        cell: (customer) => <CustomerTypeBadge type={customer.customerType} />,
      },
      {
        key: "kyc",
        header: "KYC",
        cell: (customer) => <KycStatusBadge status={customer.kycStatus} />,
      },
      {
        key: "status",
        header: "Status",
        cell: (customer) => <CustomerStatusBadge status={customer.status} />,
      },
      {
        key: "branch",
        header: "Branch",
        priority: "detail",
        cell: (customer) => (
          <span className="text-ink-muted">{customer.branchName ?? "—"}</span>
        ),
      },
    ],
    [],
  );

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
            className="border-line bg-surface text-ink placeholder:text-ink-subtle focus:border-accent focus:ring-focus/20 rounded-control h-9 w-full border px-3 text-sm focus:ring-3 focus:outline-none"
          />
          <Button type="submit" size="md" variant="secondary">
            Search
          </Button>
        </form>

        {canCreate && (
          <Button type="button" size="md" variant="primary" asChild>
            <Link href="/customers/new">Add Customer</Link>
          </Button>
        )}
      </div>

      {loadError ? (
        <Alert
          variant="error"
          title="Customer list unavailable"
          message="We could not load customers just now. Refresh to try again."
        />
      ) : (
        <DataTable
          caption="Customers"
          rows={customers}
          columns={columns}
          rowKey={(customer) => customer.customerId}
          emptyState={
            initialSearch ? (
              <EmptyState
                title="No matches"
                description={`No customers match "${initialSearch}".`}
                action={
                  <Link
                    href="/customers"
                    className="text-accent text-sm underline-offset-4 hover:underline"
                  >
                    Clear search
                  </Link>
                }
              />
            ) : (
              <EmptyState
                title="No customers yet"
                description="Customers you add will appear here."
                action={
                  canCreate ? (
                    <Button type="button" size="sm" variant="primary" asChild>
                      <Link href="/customers/new">Add Customer</Link>
                    </Button>
                  ) : undefined
                }
              />
            )
          }
        />
      )}
    </div>
  );
}
