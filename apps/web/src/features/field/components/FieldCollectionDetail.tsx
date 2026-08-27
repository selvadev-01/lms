import type { FieldCollectionDetail as FieldCollectionDetailData } from "@lms/types";
import { Alert } from "@lms/ui";
import Link from "next/link";

import { CollectionStatusBadge } from "@/features/collections";
import { formatDate, formatPaise } from "@/lib/format";

import { CustodyBadge, GpsEvidenceBadge } from "./CashBadges";
import VerifyCollectionForm from "./VerifyCollectionForm";

export interface Capabilities {
  canVerify: boolean;
}

/**
 * One field collection in full (Scenario 3).
 *
 * A server component; only the verification form below is interactive.
 *
 * Three panels, in the order an operator asks about them: what was collected
 * and how it was allocated, where the cash is now, and what evidence the agent
 * captured. The allocation is the Module 11 record unchanged — Module 12 adds
 * custody and evidence and nothing about the payment itself.
 */
export default function FieldCollectionDetail({
  collection,
  capabilities,
}: {
  collection: FieldCollectionDetailData;
  capabilities: Capabilities;
}) {
  const awaitingReview =
    collection.verificationStatus === "PENDING_VERIFICATION";

  return (
    <div className="space-y-6">
      {/* A capture that synced from a device has not been reviewed. Saying so
          at the top is the difference between a supervisor noticing and not. */}
      {awaitingReview ? (
        <Alert
          variant="warning"
          title="Awaiting review"
          message="This collection was captured offline and has not been confirmed. The payment is posted; confirming records that the capture was genuine."
        />
      ) : null}

      {collection.custodyHandoverId ? (
        <Alert
          variant="info"
          title="Cash handed over"
          message={`This cash was handed to the branch on ${collection.custodyHandoverNumber ?? "a handover"}. Reversing the collection requires reversing that handover first.`}
        />
      ) : null}

      <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {collection.receiptNumber ?? "Reversal"}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {formatDate(collection.collectionDate)} ·{" "}
              {collection.customerName}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CollectionStatusBadge status={collection.status} />
            {collection.paymentMode === "CASH" ? (
              <CustodyBadge handoverNumber={collection.custodyHandoverNumber} />
            ) : null}
          </div>
        </div>

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Amount">
            <span className="tabular-nums">
              {formatPaise(collection.amountPaise)}
            </span>
          </Detail>
          <Detail label="Loan">{collection.loanNumber}</Detail>
          <Detail label="Payment mode">{collection.paymentMode}</Detail>
          <Detail label="Collected by">
            {collection.collectorName ?? "—"}
          </Detail>
        </dl>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 text-sm font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
          Allocation
        </h3>
        {/* Server-computed, in the appropriation order the source fixes:
            penalty, interest, principal, fees. The client never proposes a
            split. */}
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Penalty">
            <span className="tabular-nums">
              {formatPaise(collection.penaltyPaidPaise)}
            </span>
          </Detail>
          <Detail label="Interest">
            <span className="tabular-nums">
              {formatPaise(collection.interestPaidPaise)}
            </span>
          </Detail>
          <Detail label="Principal">
            <span className="tabular-nums">
              {formatPaise(collection.principalPaidPaise)}
            </span>
          </Detail>
          <Detail label="Fees">
            <span className="tabular-nums">
              {formatPaise(collection.feesPaidPaise)}
            </span>
          </Detail>
        </dl>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 text-sm font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
          Field evidence
        </h3>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="GPS capture">
            {/*
              The reported status, always shown — never inferred from whether
              coordinates are present. A failed capture has no coordinates, and
              rendering "no location" rather than "capture failed" is exactly
              the silent promotion Rule 41 and Scenario 55 forbid.
            */}
            {collection.gpsCaptureStatus ? (
              <GpsEvidenceBadge status={collection.gpsCaptureStatus} />
            ) : (
              <span className="text-gray-400">Not recorded</span>
            )}
          </Detail>
          <Detail label="Location">
            {collection.gpsLatitude && collection.gpsLongitude ? (
              <span className="tabular-nums">
                {collection.gpsLatitude}, {collection.gpsLongitude}
                {collection.gpsAccuracyMeters ? (
                  <span className="ml-1 text-xs text-gray-400">
                    ±{collection.gpsAccuracyMeters}m
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </Detail>
          <Detail label="Device">{collection.deviceId ?? "—"}</Detail>
          <Detail label="Customer acknowledgment">
            {collection.customerAckReference ?? "—"}
          </Detail>
          <Detail label="Captured at">
            {collection.collectedAt ? formatDate(collection.collectedAt) : "—"}
          </Detail>
          <Detail label="Synced at">
            {collection.syncedAt ? formatDate(collection.syncedAt) : "—"}
          </Detail>
        </dl>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 text-sm font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
          Verification
        </h3>
        <dl className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Status">{collection.verificationStatus}</Detail>
          <Detail label="Notes">{collection.verificationNotes ?? "—"}</Detail>
          <Detail label="Custody">
            {collection.custodyHandoverNumber ? (
              <Link
                href={`/field/cash-handovers/${collection.custodyHandoverId}`}
                className="text-brand-600 dark:text-brand-400 hover:underline"
              >
                {collection.custodyHandoverNumber}
              </Link>
            ) : (
              <span className="text-gray-400">With agent</span>
            )}
          </Detail>
        </dl>

        {/* Rendered only when the caller holds the permission *and* there is a
            decision left to make. Authority is resolved on the server and
            passed down — components never test permissions themselves. */}
        {capabilities.canVerify && awaitingReview ? (
          <VerifyCollectionForm
            collectionId={collection.collectionId}
            version={collection.version}
          />
        ) : null}
      </section>
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-gray-800 dark:text-white/90">
        {children}
      </dd>
    </div>
  );
}
