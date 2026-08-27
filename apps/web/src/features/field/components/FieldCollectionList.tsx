import type { FieldCollectionSummary } from "@lms/types";
import Link from "next/link";

import { formatDate, formatPaise } from "@/lib/format";

import { CollectionStatusBadge } from "@/features/collections";

import { CustodyBadge, GpsEvidenceBadge } from "./CashBadges";

/**
 * Field collections within the caller's scope (Scenarios 1, 2).
 *
 * A server component. The rows are already confined by the API to the caller's
 * organization, branch **and** — for an agent without review authority — to
 * their own collections. There is no filter here through which any of that
 * could be widened.
 *
 * The custody column is the one that earns its place on a list rather than a
 * detail page: "which of my collections is the branch still waiting for" is the
 * question an agent opens this screen to answer.
 */
export default function FieldCollectionList({
  collections,
}: {
  collections: FieldCollectionSummary[];
}) {
  if (collections.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No field collections yet.
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
            <th className="px-5 py-3 font-medium">Agent</th>
            <th className="px-5 py-3 text-right font-medium">Amount</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium">GPS</th>
            <th className="px-5 py-3 font-medium">Custody</th>
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
                  href={`/field/collections/${collection.collectionId}`}
                  className="text-brand-600 dark:text-brand-400 font-medium hover:underline"
                >
                  {/* A reversal row has no receipt number — Rule 20 forbids
                      reusing one — so it is labelled rather than shown blank. */}
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
                {collection.collectorName ?? "—"}
              </td>
              <td className="px-5 py-3 text-right font-medium text-gray-800 tabular-nums dark:text-white/90">
                {formatPaise(collection.amountPaise)}
              </td>
              <td className="px-5 py-3">
                <CollectionStatusBadge status={collection.status} />
              </td>
              <td className="px-5 py-3">
                {collection.gpsCaptureStatus ? (
                  <GpsEvidenceBadge status={collection.gpsCaptureStatus} />
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                )}
              </td>
              <td className="px-5 py-3">
                {/* Only cash creates custody: a UPI payment taken in front of a
                    customer settles through the bank and never enters the
                    handover pool, so a custody badge on it would be a lie. */}
                {collection.paymentMode === "CASH" ? (
                  <CustodyBadge
                    handoverNumber={collection.custodyHandoverNumber}
                  />
                ) : (
                  <span className="text-xs text-gray-400">Not cash</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
