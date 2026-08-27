import type { CollectionStatus } from "@lms/types";
import { Badge } from "@lms/ui";
import {
  COLLECTION_PAYMENT_MODE_OPTIONS,
  COLLECTION_STATUS_OPTIONS,
  labelFor,
} from "@lms/validation";

/**
 * Status badges for the collection surfaces.
 *
 * Server components — no `"use client"`. They render text and colour from props
 * and hold no state, so shipping them to the browser would cost bundle size for
 * nothing. Same reasoning as `DisbursementBadges`.
 */

/**
 * Collection lifecycle colour.
 *
 * POSTED is the only success: it is the one state in which money has actually
 * been taken and recorded. CREATED and SYNCED are `warning` because both mean a
 * payment exists somewhere that the ledger does not yet know about — to an
 * operator that is the same call to action.
 *
 * REVERSED is `light` rather than `error`. A reversal is a deliberate,
 * authorized correction, and colouring it red would make a correctly-handled
 * mistake look like a system failure. FAILED is `error` because it is one.
 *
 * `Record<CollectionStatus, ...>` rather than a partial map, so a new status
 * stops the compiler here.
 */
const COLLECTION_TONE: Record<
  CollectionStatus,
  "success" | "warning" | "error" | "info" | "light"
> = {
  CREATED: "warning",
  SYNCED: "warning",
  POSTED: "success",
  REVERSED: "light",
  FAILED: "error",
};

export function CollectionStatusBadge({
  status,
}: {
  status: CollectionStatus;
}) {
  return (
    <Badge color={COLLECTION_TONE[status]}>
      {labelFor(COLLECTION_STATUS_OPTIONS, status)}
    </Badge>
  );
}

export function paymentModeLabel(mode: string): string {
  return labelFor(COLLECTION_PAYMENT_MODE_OPTIONS, mode);
}

/**
 * Marks a collection that was taken on a device rather than at a branch.
 *
 * Rendered only when true. An online collection carrying an "Online" badge
 * would be noise on every row.
 */
export function OfflineBadge({ offline }: { offline: boolean }) {
  if (!offline) return null;

  return <Badge color="info">Offline</Badge>;
}
