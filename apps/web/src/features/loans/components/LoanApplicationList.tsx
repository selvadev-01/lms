"use client";

import type { LoanApplicationSummary } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import {
  APPLICATION_STATUS_OPTIONS,
  LOAN_TYPE_OPTIONS,
  labelFor,
} from "@lms/validation";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState } from "react";

import { ApplicationStatusBadge, formatPaise } from "./LoanBadges";

/**
 * The stages staff actually queue on, as one-click filters.
 *
 * Not every status — a chip row listing all nine would be a second, worse copy
 * of the dropdown beside it. These are the four where somebody is waiting to
 * act: review, approval, the customer's answer, and the signature.
 */
const QUICK_FILTERS = [
  { label: "To review", value: "SUBMITTED" },
  { label: "Under review", value: "UNDER_REVIEW" },
  { label: "Awaiting sanction", value: "APPROVED" },
  { label: "Awaiting customer", value: "SANCTIONED" },
] as const;

/**
 * Loan application list (APP-001, Scenarios 1-4).
 *
 * Search and status both submit through the URL rather than local state, so a
 * result set is linkable and survives a refresh — branch staff routinely open an
 * application, go back, and expect their filter still to be there.
 *
 * Nothing is filtered here. The server decides which applications the caller may
 * see; filtering a list the client already holds would mean the out-of-scope
 * rows had already been sent (Scenario 3).
 *
 * `loadError` renders distinctly from an empty list: "no applications match"
 * and "we could not reach your applications" are different claims, and only one
 * of them is ever true.
 */
export default function LoanApplicationList({
  applications,
  loadError = false,
  canCreate = false,
  initialSearch = "",
  initialStatus = "",
}: {
  applications: LoanApplicationSummary[];
  loadError?: boolean;
  canCreate?: boolean;
  initialSearch?: string;
  initialStatus?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(initialSearch);

  function push(next: URLSearchParams) {
    router.push(
      `/loans/applications${next.size > 0 ? `?${next.toString()}` : ""}`,
    );
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams(params.toString());
    const trimmed = term.trim();

    if (trimmed) next.set("search", trimmed);
    else next.delete("search");

    push(next);
  }

  function filterStatus(status: string) {
    const next = new URLSearchParams(params.toString());

    if (status) next.set("status", status);
    else next.delete("status");

    push(next);
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
            placeholder="Search by application ID, customer name or ID"
            aria-label="Search loan applications"
            className="shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:ring-3 focus:outline-hidden dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30"
          />
          <Button type="submit" size="sm">
            Search
          </Button>
        </form>

        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="sr-only">
            Filter by status
          </label>
          {/* Controlled off the URL, not `defaultValue`: the quick filters
              below write the same parameter, and an uncontrolled select would
              keep showing the status the user last picked by hand. */}
          <select
            id="status-filter"
            value={initialStatus}
            onChange={(event) => filterStatus(event.target.value)}
            className="h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
          >
            <option value="">All statuses</option>
            {APPLICATION_STATUS_OPTIONS.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>

          {canCreate && (
            <Link href="/loans/applications/new">
              <Button type="button" size="sm">
                New Application
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/**
       * The review queue, as a filter rather than a second route.
       *
       * Module 08's menu names a "Review / Approval" screen. A separate page
       * would be this same list under another name, reading the same endpoint —
       * two routes that drift the moment either is touched. These write the
       * status parameter the list already honours.
       */}
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_FILTERS.map((filter) => {
          const active = initialStatus === filter.value;

          return (
            <button
              key={filter.label}
              type="button"
              onClick={() => filterStatus(active ? "" : filter.value)}
              aria-pressed={active}
              className={
                active
                  ? "bg-brand-500 rounded-full px-3 py-1.5 text-xs font-medium text-white"
                  : "rounded-full border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.03]"
              }
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {loadError ? (
        <Alert
          variant="error"
          title="Could not load applications"
          message="Please refresh the page. If this continues, contact support."
        />
      ) : applications.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No loan applications match this view.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase dark:bg-white/[0.03] dark:text-gray-400">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Application
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Customer
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Type
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Scheme
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {applications.map((application) => (
                <tr
                  key={application.applicationId}
                  className="hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                >
                  <td className="px-5 py-4">
                    <Link
                      href={`/loans/applications/${application.applicationId}`}
                      className="text-brand-500 font-medium hover:underline"
                    >
                      {application.applicationNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                    <span className="block">{application.customerName}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {application.customerCode}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                    {labelFor(LOAN_TYPE_OPTIONS, application.loanType)}
                  </td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                    {application.schemeName}
                  </td>
                  <td className="px-5 py-4 text-right font-medium text-gray-800 dark:text-white/90">
                    {formatPaise(application.requestedAmountPaise)}
                  </td>
                  <td className="px-5 py-4">
                    <ApplicationStatusBadge status={application.status} />
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
