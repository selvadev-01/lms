"use client";

import type { GuarantorSummary } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import {
  CONSENT_STATUS_OPTIONS,
  GUARANTOR_STATUS_OPTIONS,
} from "@lms/validation";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState } from "react";

// Module import, not the barrel: the barrel re-exports `server-only` api code,
// which a client component cannot pull in. See GuarantorDetail for the detail.
import { ConsentStatusBadge } from "@/features/customers/components/CustomerStatusBadge";
import {
  GuarantorKycStatusBadge,
  GuarantorStatusBadge,
} from "./GuarantorStatusBadge";

/**
 * The guarantor directory (Module 05, GUA-001, Scenario 1).
 *
 * One search box over name, mobile and customer, matching the customer list and
 * the API: splitting it would mean someone who typed a mobile number into the
 * "name" box gets nothing back and concludes the guarantor is not on file.
 *
 * The search submits through the URL rather than local state, so a result set is
 * linkable and survives a refresh.
 *
 * **Inactive guarantors are listed, not hidden.** Scenario 1 asks that they be
 * "clearly identified", which is what the status badge does. Filtering them out
 * would make a deactivated guarantor indistinguishable from a deleted one —
 * exactly the confusion Rule 35 is about.
 *
 * Mobile numbers arrive masked from the API and are rendered as received. A
 * directory is a browsing surface, and a full column of third-party numbers
 * would be a standing disclosure to anyone who opens the page (Q-GUAR-65).
 */
export default function GuarantorDirectory({
  guarantors,
  loadError = false,
  initialSearch = "",
}: {
  guarantors: GuarantorSummary[];
  loadError?: boolean;
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

    router.push(`/guarantors${next.size > 0 ? `?${next.toString()}` : ""}`);
  }

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);

    router.push(`/guarantors${next.size > 0 ? `?${next.toString()}` : ""}`);
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
            placeholder="Search by guarantor name, mobile or customer"
            aria-label="Search guarantors"
            className="shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:ring-3 focus:outline-hidden dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30"
          />
          <Button type="submit" size="sm">
            Search
          </Button>
        </form>

        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Filter by status"
            value={params.get("status") ?? ""}
            onChange={(event) => setFilter("status", event.target.value)}
            className="h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:text-white/90"
          >
            <option value="">All statuses</option>
            {GUARANTOR_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by consent"
            value={params.get("consentStatus") ?? ""}
            onChange={(event) => setFilter("consentStatus", event.target.value)}
            className="h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700 dark:text-white/90"
          >
            <option value="">All consent states</option>
            {CONSENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/*
        Deliberately distinct from an empty list: "you have no guarantors" and
        "we could not reach your guarantors" are different claims.
      */}
      {loadError && (
        <Alert
          variant="error"
          title="Could not load guarantors"
          message="The guarantor directory is temporarily unavailable. Please try again shortly."
        />
      )}

      {!loadError && guarantors.length === 0 ? (
        <p
          className="rounded-2xl border border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
          role="status"
        >
          No guarantors match this search.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-200 text-left dark:border-gray-800">
                <th className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">
                  Guarantor
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">
                  Mobile
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">
                  Consent
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">
                  KYC
                </th>
              </tr>
            </thead>
            <tbody>
              {guarantors.map((guarantor) => (
                <tr
                  key={guarantor.guarantorId}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="px-4 py-3 text-sm">
                    <Link
                      href={`/guarantors/${guarantor.guarantorId}`}
                      className="text-brand-500 hover:underline"
                    >
                      {guarantor.fullName}
                    </Link>
                    {guarantor.relationship && (
                      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                        {guarantor.relationship}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {guarantor.mobile}
                  </td>
                  <td className="px-4 py-3">
                    <GuarantorStatusBadge status={guarantor.status} />
                  </td>
                  <td className="px-4 py-3">
                    <ConsentStatusBadge status={guarantor.consentStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <GuarantorKycStatusBadge status={guarantor.kycStatus} />
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
