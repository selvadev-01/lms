import type { CollectionSummary } from "@lms/types";
import Link from "next/link";

import { formatDate, formatPaise } from "@/lib/format";

import {
  CollectionStatusBadge,
  OfflineBadge,
  paymentModeLabel,
} from "./CollectionBadges";

/**
 * Collections within the caller's scope (Scenarios 1, 4).
 *
 * A server component. The rows it renders are already confined to the caller's
 * organization and branch by the API — there is no branch filter here, and no
 * request parameter through which one could be widened.
 */
export default function CollectionList({
  collections,
}: {
  collections: CollectionSummary[];
}) {
  if (collections.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No collections yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800 dark:text-gray-400">
            <th className="px-5 py-3 font-medium">Receipt</th>
            <th className="px-5 py-3 font-medium">Date</th>
            <th className="px-5 py-3 font-medium">Customer</th>
            <th className="px-5 py-3 font-medium">Loan</th>
            <th className="px-5 py-3 font-medium">Mode</th>
            <th className="px-5 py-3 text-right font-medium">Amount</th>
            <th className="px-5 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {collections.map((collection) => (
            <tr
              key={collection.collectionId}
              className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
            >
              <td className="px-5 py-3">
                <Link
                  href={`/loans/collections/${collection.collectionId}`}
                  className="text-brand-600 dark:text-brand-400 font-medium hover:underline"
                >
                  {/*
                    A reversal row has no receipt number — Rule 20 forbids
                    reusing one — so it is labelled rather than shown blank.
                  */}
                  {collection.receiptNumber ?? "Reversal"}
                </Link>
              </td>
              <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                {formatDate(collection.collectionDate)}
              </td>
              <td className="px-5 py-3 text-gray-800 dark:text-white/90">
                {collection.customerName}
              </td>
              <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                {collection.loanNumber}
              </td>
              <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                {paymentModeLabel(collection.paymentMode)}
              </td>
              <td className="px-5 py-3 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                {formatPaise(collection.amountPaise)}
              </td>
              <td className="px-5 py-3">
                <div className="flex flex-wrap gap-1">
                  <CollectionStatusBadge status={collection.status} />
                  <OfflineBadge offline={collection.offlineCollected} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
