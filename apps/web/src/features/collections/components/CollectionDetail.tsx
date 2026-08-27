import type {
  CollectionDetail as CollectionDetailData,
  LedgerEntryDetail,
} from "@lms/types";
import { Alert } from "@lms/ui";
import Link from "next/link";

import LedgerPanel from "@/features/disbursements/components/LedgerPanel";
import { formatDate, formatPaise } from "@/lib/format";

import AllocationSummary from "./AllocationSummary";
import {
  CollectionStatusBadge,
  OfflineBadge,
  paymentModeLabel,
} from "./CollectionBadges";
import ReverseCollectionForm from "./ReverseCollectionForm";

/**
 * One collection in full (Scenarios 2, 3, 25, 27, 31).
 *
 * A server component. `LedgerPanel` is reused from the disbursal feature rather
 * than copied: it renders a `LedgerEntryDetail`, which is the same shape
 * whichever module posted the entry, and a second copy would be a second place
 * for the balance display to drift.
 *
 * # There is no edit control, and that is not an omission
 *
 * A posted collection is immutable (Rules 21, 22) and financial records are
 * retained (Rule 44) — the database refuses an edit or a delete outright. The
 * only correction is a reversal, which is why that is the sole mutation offered
 * here.
 */

export interface Capabilities {
  canReverse: boolean;
}

export default function CollectionDetail({
  collection,
  ledger,
  capabilities,
}: {
  collection: CollectionDetailData;
  ledger: LedgerEntryDetail | null;
  capabilities: Capabilities;
}) {
  const isReversal = Boolean(collection.reversalOfCollectionId);
  const isReversed = collection.status === "REVERSED" && !isReversal;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {collection.receiptNumber ?? "Reversal"}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {collection.customerName} · {collection.loanNumber}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            <CollectionStatusBadge status={collection.status} />
            <OfflineBadge offline={collection.offlineCollected} />
          </div>
        </div>

        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Amount" value={formatPaise(collection.amountPaise)} />
          <Detail
            label="Collection date"
            value={formatDate(collection.collectionDate)}
          />
          <Detail
            label="Payment mode"
            value={paymentModeLabel(collection.paymentMode)}
          />
          {collection.transactionReference && (
            <Detail
              label="Payment reference"
              value={collection.transactionReference}
            />
          )}
          {collection.collectorName && (
            <Detail label="Collected by" value={collection.collectorName} />
          )}
          {collection.postedAt && (
            <Detail label="Posted" value={formatDate(collection.postedAt)} />
          )}
          {collection.deviceId && (
            <Detail label="Device" value={collection.deviceId} />
          )}
        </dl>
      </section>

      {/*
        A reversal row points back at what it undid, and a reversed original
        points forward. Either way the operator can reach the other half of the
        pair — a reversal that could not be traced to its original would be an
        audit trail with a gap in it.
      */}
      {isReversal && collection.reversalOfCollectionId && (
        <Alert
          variant="info"
          title="This is a reversal"
          message={`It reverses collection ${collection.reversalOfCollectionId}.`}
        />
      )}

      {isReversed && (
        <Alert
          variant="warning"
          title="This collection was reversed"
          message={
            collection.reversalReason
              ? `Reason: ${collection.reversalReason}`
              : "A reversing entry was posted against it."
          }
        />
      )}

      {collection.reversedByCollectionId && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          <Link
            href={`/loans/collections/${collection.reversedByCollectionId}`}
            className="text-brand-600 dark:text-brand-400 hover:underline"
          >
            View the reversal
          </Link>
        </p>
      )}

      <AllocationSummary
        components={{
          penaltyPaise: collection.penaltyPaidPaise,
          interestPaise: collection.interestPaidPaise,
          principalPaise: collection.principalPaidPaise,
          feesPaise: collection.feesPaidPaise,
          unallocatedPaise: collection.unallocatedAmountPaise,
          totalPaise: collection.amountPaise,
        }}
        lines={collection.allocations}
      />

      {ledger && <LedgerPanel entry={ledger} />}

      {/*
        Offered only to a caller holding the permission, and only for a posted
        collection — a reversal cannot itself be reversed (Scenario 33), and the
        API refuses that regardless of what is rendered.
      */}
      {capabilities.canReverse && collection.status === "POSTED" && (
        <ReverseCollectionForm
          collectionId={collection.collectionId}
          expectedVersion={collection.version}
        />
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-gray-500 uppercase dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 font-medium text-gray-800 dark:text-white/90">
        {value}
      </dd>
    </div>
  );
}
