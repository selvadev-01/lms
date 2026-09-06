"use client";

import type { DisbursalQueueItem, DisbursementSummary } from "@lms/types";
import { Alert, Button, Pagination } from "@lms/ui";
import { DISBURSEMENT_STATUS_OPTIONS } from "@lms/validation";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState } from "react";

import { formatDate, formatPaise } from "@/lib/format";
import { DisbursementStatusBadge } from "./DisbursementBadges";

/**
 * The disbursal screen: an action queue above a record list (Scenario 1).
 *
 * Two tables rather than one, because they answer different questions. The
 * queue is "who is waiting for money" — loans whose agreement is signed,
 * ordered oldest first, which is the order a branch should work them. The list
 * below is the audit view: every disbursement in scope, searchable by
 * reference, loan number or customer, for the reconciliation questions the
 * source's Open Questions 146-151 ask about.
 *
 * Nothing is filtered here. The server decides which rows the caller may see;
 * filtering a list the client already holds would mean the out-of-scope rows
 * had already been sent (Scenario 3). There is no branch control on this screen
 * for the same reason — the API has no parameter that would accept one.
 *
 * `loadError` renders distinctly from an empty queue: "nothing is awaiting
 * disbursal" and "we could not reach your disbursements" are different claims,
 * and only one of them is ever true.
 */
export default function DisbursementQueue({
  queue,
  disbursements,
  queueError = false,
  listError = false,
  initialSearch = "",
  initialStatus = "",
  page = 1,
  pageSize = 25,
  total = 0,
}: {
  queue: DisbursalQueueItem[];
  disbursements: DisbursementSummary[];
  queueError?: boolean;
  listError?: boolean;
  initialSearch?: string;
  initialStatus?: string;
  page?: number;
  pageSize?: number;
  /** Rows matching the filters across every page, not just this one. */
  total?: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(initialSearch);

  function push(next: URLSearchParams) {
    router.push(
      `/loans/disbursements${next.size > 0 ? `?${next.toString()}` : ""}`,
    );
  }

  /**
   * Changing a filter returns to the first page.
   *
   * Otherwise someone on page 3 who narrows the search lands on page 3 of a
   * result set that may only have one page, sees nothing, and concludes the
   * search found no matches.
   */
  function pushFiltered(next: URLSearchParams) {
    next.delete("page");
    push(next);
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams(params.toString());
    const trimmed = term.trim();

    if (trimmed) next.set("search", trimmed);
    else next.delete("search");

    pushFiltered(next);
  }

  function filterStatus(status: string) {
    const next = new URLSearchParams(params.toString());

    if (status) next.set("status", status);
    else next.delete("status");

    pushFiltered(next);
  }

  /** Page links keep every active filter and change only `page`. */
  function hrefForPage(next: number) {
    const search = new URLSearchParams(params.toString());
    if (next <= 1) search.delete("page");
    else search.set("page", String(next));
    return `/loans/disbursements${search.size > 0 ? `?${search.toString()}` : ""}`;
  }

  /** Loans with no disbursement scheduled yet — the real action queue. */
  const awaiting = queue.filter((item) => !item.disbursementId);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-medium text-gray-800 dark:text-white/90">
            Awaiting disbursal
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Signed agreements with no disbursement scheduled, oldest first.
          </p>
        </div>

        {queueError ? (
          <Alert
            variant="error"
            title="Could not load the disbursal queue"
            message="Please refresh the page. If this continues, contact support."
          />
        ) : awaiting.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            No loans are awaiting disbursal.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase dark:bg-white/[0.03] dark:text-gray-400">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Application
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Customer
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Sanctioned
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Agreement signed
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {awaiting.map((item) => (
                  <tr
                    key={item.applicationId}
                    className="hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                  >
                    <td className="px-5 py-4 font-medium text-gray-800 dark:text-white/90">
                      {item.applicationNumber}
                    </td>
                    <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                      {item.customerName}
                      <span className="block text-xs text-gray-400">
                        {item.customerCode}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                      {formatPaise(item.sanctionedAmountPaise)}
                    </td>
                    <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                      {formatDate(item.agreementSignedAt)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/loans/disbursements/new?applicationId=${encodeURIComponent(item.applicationId)}`}
                      >
                        <Button type="button" size="sm">
                          Schedule
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-medium text-gray-800 dark:text-white/90">
          Disbursements
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <form onSubmit={search} className="flex w-full max-w-md gap-2">
            <input
              type="search"
              name="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search by transaction reference, loan number or customer"
              aria-label="Search disbursements"
              className="shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:ring-3 focus:outline-hidden dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30"
            />
            <Button type="submit" size="sm">
              Search
            </Button>
          </form>

          <div className="flex items-center gap-2">
            <label htmlFor="disbursement-status-filter" className="sr-only">
              Filter by status
            </label>
            {/* Controlled off the URL rather than `defaultValue`, so the shown
                value always matches the result set. */}
            <select
              id="disbursement-status-filter"
              value={initialStatus}
              onChange={(event) => filterStatus(event.target.value)}
              className="h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:text-white/90"
            >
              <option value="">All statuses</option>
              {DISBURSEMENT_STATUS_OPTIONS.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {listError ? (
          <Alert
            variant="error"
            title="Could not load disbursements"
            message="Please refresh the page. If this continues, contact support."
          />
        ) : disbursements.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No disbursements match this view.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase dark:bg-white/[0.03] dark:text-gray-400">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Loan
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Customer
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Scheduled
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Reference
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {disbursements.map((row) => (
                  <tr
                    key={row.disbursementId}
                    className="hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                  >
                    <td className="px-5 py-4">
                      <Link
                        href={`/loans/disbursements/${row.disbursementId}`}
                        className="text-brand-500 font-medium hover:underline"
                      >
                        {row.loanNumber}
                      </Link>
                      <span className="block text-xs text-gray-400">
                        {row.applicationNumber}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                      {row.customerName}
                    </td>
                    <td className="px-5 py-4 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                      {formatPaise(row.amountPaise)}
                    </td>
                    <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                      {formatDate(row.scheduledDate)}
                    </td>
                    <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                      {row.transactionReference ?? "—"}
                    </td>
                    <td className="px-5 py-4">
                      <DisbursementStatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Only once there is more than a page of them. The API has always
            paginated this list at 25; until the page param was forwarded the
            extra rows were simply unreachable and unmentioned. */}
        {!listError && total > pageSize && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            hrefFor={hrefForPage}
            linkComponent={Link}
            className="mt-4"
          />
        )}
      </section>
    </div>
  );
}
