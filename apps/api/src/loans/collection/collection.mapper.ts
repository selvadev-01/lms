import type { AllocationResult } from '@lms/emi';
import { todayInKolkata } from '@lms/emi';
import type {
  AllocationPreview,
  CollectionAllocationView,
  CollectionDetail,
  CollectionSummary,
} from '@lms/types';

import {
  toEmiRow,
  type EmiLike,
} from '../repayment/repayment-schedule.service';

/**
 * The relations every collection read needs.
 *
 * One shape, so the list and the detail cannot disagree about what a
 * collection's loan or customer is called.
 */
export const COLLECTION_INCLUDE = {
  loan: { select: { loanNumber: true } },
  customer: { select: { fullName: true } },
  // `name`, not `fullName`: a `User` and a `Customer` spell it differently.
  collectorUser: { select: { name: true } },
  allocations: {
    include: {
      emi: { select: { installmentNumber: true, dueDate: true } },
    },
  },
  reversedByCollection: { select: { collectionId: true } },
} as const;

/**
 * A collection row with the relations above.
 *
 * Structural rather than the generated Prisma payload type: the mapper stays
 * readable, a spec can build one by hand without a database, and the only
 * columns named here are the ones actually rendered. The `Pick` on the scalar
 * side is what keeps it honest — a renamed column is a compile error rather
 * than an `undefined` that reaches the UI.
 */
export interface CollectionRow {
  collectionId: string;
  loanId: string;
  branchId: string;
  customerId: string;
  collectorUserId: string;
  collectionDate: Date;
  collectedAt: Date;
  paymentType: string;
  paymentMode: string;
  amountPaise: bigint;
  transactionReference: string | null;
  idempotencyKey: string;
  requestFingerprint?: string | null;
  status: string;
  verificationStatus: string;
  receiptNumber: string | null;
  penaltyPaidPaise: bigint;
  interestPaidPaise: bigint;
  principalPaidPaise: bigint;
  feesPaidPaise: bigint;
  unallocatedAmountPaise: bigint;
  journalEntryId: string | null;
  postedAt: Date | null;
  postedBy: string | null;
  reversalOfCollectionId: string | null;
  reversalReason: string | null;
  reversedAt: Date | null;
  reversedBy: string | null;
  offlineCollected: boolean;
  offlineTransactionUuid: string | null;
  deviceId: string | null;
  syncedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  loan: { loanNumber: string };
  customer: { fullName: string };
  collectorUser?: { name: string } | null;
  allocations?: {
    emiId: string | null;
    component: string;
    amountPaise: bigint;
    emi?: { installmentNumber: number; dueDate: Date } | null;
  }[];
  reversedByCollection?: { collectionId: string } | null;
}

/**
 * Every money field crosses the wire as a paise digit string, never a number.
 *
 * A `bigint` serialized by `JSON.stringify` throws; one coerced to `Number`
 * loses precision above 2^53. Converting explicitly at this boundary is what
 * keeps both from happening by accident.
 */
export function toCollectionSummary(row: CollectionRow): CollectionSummary {
  return {
    collectionId: row.collectionId,
    loanId: row.loanId,
    loanNumber: row.loan.loanNumber,
    customerId: row.customerId,
    customerName: row.customer.fullName,
    branchId: row.branchId,
    ...(row.receiptNumber ? { receiptNumber: row.receiptNumber } : {}),
    collectionDate: row.collectionDate.toISOString().slice(0, 10),
    collectedAt: row.collectedAt.toISOString(),
    paymentMode: row.paymentMode as CollectionSummary['paymentMode'],
    paymentType: row.paymentType as CollectionSummary['paymentType'],
    amountPaise: row.amountPaise.toString(),
    status: row.status as CollectionSummary['status'],
    offlineCollected: row.offlineCollected,
    collectorUserId: row.collectorUserId,
    ...(row.collectorUser ? { collectorName: row.collectorUser.name } : {}),
    createdAt: row.createdAt.toISOString(),
    // The concurrency token, exposed as `version` exactly as every other
    // versioned record does.
    version: row.updatedAt.toISOString(),
  };
}

export function toCollectionDetail(row: CollectionRow): CollectionDetail {
  const allocations: CollectionAllocationView[] = (row.allocations ?? [])
    .map((allocation) => ({
      emiId: allocation.emiId ?? '',
      installmentNumber: allocation.emi?.installmentNumber ?? 0,
      dueDate: allocation.emi?.dueDate.toISOString().slice(0, 10) ?? '',
      component: allocation.component as CollectionAllocationView['component'],
      amountPaise: allocation.amountPaise.toString(),
    }))
    // Stable order for rendering: by installment, then by appropriation order.
    .sort((a, b) => {
      if (a.installmentNumber !== b.installmentNumber) {
        return a.installmentNumber - b.installmentNumber;
      }
      return componentRank(a.component) - componentRank(b.component);
    });

  return {
    ...toCollectionSummary(row),
    penaltyPaidPaise: row.penaltyPaidPaise.toString(),
    interestPaidPaise: row.interestPaidPaise.toString(),
    principalPaidPaise: row.principalPaidPaise.toString(),
    feesPaidPaise: row.feesPaidPaise.toString(),
    unallocatedAmountPaise: row.unallocatedAmountPaise.toString(),
    allocations,
    idempotencyKey: row.idempotencyKey,
    verificationStatus:
      row.verificationStatus as CollectionDetail['verificationStatus'],
    ...(row.journalEntryId ? { journalEntryId: row.journalEntryId } : {}),
    ...(row.transactionReference
      ? { transactionReference: row.transactionReference }
      : {}),
    ...(row.offlineTransactionUuid
      ? { offlineTransactionUuid: row.offlineTransactionUuid }
      : {}),
    ...(row.deviceId ? { deviceId: row.deviceId } : {}),
    ...(row.syncedAt ? { syncedAt: row.syncedAt.toISOString() } : {}),
    ...(row.postedAt ? { postedAt: row.postedAt.toISOString() } : {}),
    ...(row.postedBy ? { postedBy: row.postedBy } : {}),
    ...(row.reversalOfCollectionId
      ? { reversalOfCollectionId: row.reversalOfCollectionId }
      : {}),
    ...(row.reversedByCollection
      ? { reversedByCollectionId: row.reversedByCollection.collectionId }
      : {}),
    ...(row.reversalReason ? { reversalReason: row.reversalReason } : {}),
    ...(row.reversedAt ? { reversedAt: row.reversedAt.toISOString() } : {}),
    ...(row.reversedBy ? { reversedBy: row.reversedBy } : {}),
    ...(row.failureReason ? { failureReason: row.failureReason } : {}),
  };
}

/** Appropriation order, for stable rendering within one installment. */
function componentRank(component: string): number {
  switch (component) {
    case 'PENALTY':
      return 0;
    case 'INTEREST':
      return 1;
    case 'PRINCIPAL':
      return 2;
    default:
      return 3;
  }
}

/**
 * The advisory preview of what an amount would settle.
 *
 * Resolves each allocation line back to its installment so the form can show
 * which due dates a payment reaches. A loan-level penalty line has no
 * installment — its synthetic `penalty:` id is not an emiId — and renders with
 * installment 0.
 */
export function toAllocationPreview(
  result: AllocationResult,
  emis: EmiLike[],
  options: { wouldCloseLoan: boolean },
): AllocationPreview {
  const today = todayInKolkata();
  const byId = new Map(emis.map((emi) => [emi.emiId, toEmiRow(emi, today)]));

  const lines: CollectionAllocationView[] = result.lines.map((line) => {
    const emi = byId.get(line.emiId);
    return {
      emiId: line.emiId.startsWith('penalty:') ? '' : line.emiId,
      installmentNumber: emi?.installmentNumber ?? 0,
      dueDate: emi?.dueDate ?? '',
      component: line.component,
      amountPaise: line.amountPaise.toString(),
    };
  });

  return {
    amountPaise: result.totalAllocatedPaise.toString(),
    penaltyPaise: result.penaltyPaise.toString(),
    interestPaise: result.interestPaise.toString(),
    principalPaise: result.principalPaise.toString(),
    feesPaise: result.feesPaise.toString(),
    unallocatedPaise: result.unallocatedPaise.toString(),
    lines,
    fullySettledEmiIds: result.fullySettledEmiIds.filter(
      (id) => !id.startsWith('penalty:'),
    ),
    wouldCloseLoan: options.wouldCloseLoan,
  };
}
