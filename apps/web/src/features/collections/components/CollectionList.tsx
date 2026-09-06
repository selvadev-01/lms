import type { CollectionSummary } from "@lms/types";
import { DataTable, EmptyState, Pagination, type Column } from "@lms/ui";
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
 *
 * Pagination is link-based for the same reason it can be: this stays a server
 * component, and the page is an address like every other filter on the screen.
 * The API has always returned 20 rows at a time; until `page` was forwarded the
 * rest were unreachable and the count was never shown.
 */
export default function CollectionList({
  collections,
  page = 1,
  pageSize = 20,
  total,
  activeParams,
}: {
  collections: CollectionSummary[];
  page?: number;
  pageSize?: number;
  /** Rows matching the filters across every page, not just this one. */
  total?: number;
  /**
   * The screen's current search/status/date filters, so a page link can carry
   * them. A server component cannot read `useSearchParams`, and a bare
   * `?page=2` would REPLACE the query string rather than extend it — silently
   * dropping every filter the moment someone turned the page.
   */
  activeParams?: Record<string, string | undefined>;
}) {
  const columns: Column<CollectionSummary>[] = [
    {
      key: "receipt",
      header: "Receipt",
      priority: "primary",
      cell: (collection) => (
        <Link
          href={`/loans/collections/${collection.collectionId}`}
          className="text-accent focus-visible:ring-focus rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          {/*
            A reversal row has no receipt number — Rule 20 forbids reusing one —
            so it is labelled rather than shown blank.
          */}
          {collection.receiptNumber ?? "Reversal"}
        </Link>
      ),
    },
    {
      key: "date",
      header: "Date",
      numeric: true,
      cell: (collection) => formatDate(collection.collectionDate),
    },
    {
      key: "customer",
      header: "Customer",
      priority: "primary",
      cell: (collection) => collection.customerName,
    },
    {
      key: "loan",
      header: "Loan",
      cell: (collection) => (
        <span className="text-ink-muted tabular">{collection.loanNumber}</span>
      ),
    },
    {
      key: "mode",
      header: "Mode",
      priority: "detail",
      cell: (collection) => (
        <span className="text-ink-muted">
          {paymentModeLabel(collection.paymentMode)}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      cell: (collection) => (
        <span className="font-medium">
          {formatPaise(collection.amountPaise)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (collection) => (
        <div className="flex flex-wrap gap-1">
          <CollectionStatusBadge status={collection.status} />
          <OfflineBadge offline={collection.offlineCollected} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        caption="Collections"
        rows={collections}
        columns={columns}
        rowKey={(collection) => collection.collectionId}
        emptyState={
          <EmptyState
            title="No collections yet"
            description="Payments recorded against a loan instalment appear here."
          />
        }
      />

      {/* Only once there is more than one page of them. */}
      {total !== undefined && total > pageSize && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          linkComponent={Link}
          hrefFor={(next) => {
            const query = new URLSearchParams();
            for (const [key, value] of Object.entries(activeParams ?? {})) {
              if (value) query.set(key, value);
            }
            if (next > 1) query.set("page", String(next));
            return `/loans/collections${query.size > 0 ? `?${query}` : ""}`;
          }}
        />
      )}
    </div>
  );
}
