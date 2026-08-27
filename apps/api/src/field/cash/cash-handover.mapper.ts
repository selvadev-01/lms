import type {
  CashHandoverDetail,
  CashHandoverStatus,
  CashHandoverSummary,
} from '@lms/types';

import {
  toFieldCollectionSummary,
  type FieldCollectionRow,
} from '../collection/field-collection.mapper';

/**
 * The relations every handover read needs.
 *
 * One shape, so the list and the detail cannot disagree about what a
 * handover's agent or branch is called.
 *
 * `collections` is included on both, not only the detail: a list row showing
 * how many collections a handover carries is the cheapest way to spot one that
 * claims more cash than it should, and the count is free once the rows are
 * loaded.
 */
export const CASH_HANDOVER_INCLUDE = {
  branch: { select: { name: true } },
  fieldAgent: { select: { name: true, employeeCode: true } },
  receivedByUser: { select: { name: true } },
  collections: {
    include: {
      loan: { select: { loanNumber: true } },
      customer: { select: { fullName: true } },
      collectorUser: { select: { name: true } },
      allocations: {
        include: {
          emi: { select: { installmentNumber: true, dueDate: true } },
        },
      },
      reversedByCollection: { select: { collectionId: true } },
      gpsCheckIn: {
        select: { latitude: true, longitude: true, accuracyMeters: true },
      },
      custodyHandover: { select: { handoverNumber: true } },
    },
  },
  reconciliations: {
    select: { reconciliationId: true, reconciliationNumber: true },
  },
  reversedByHandover: { select: { handoverId: true } },
} as const;

/**
 * A handover row with the relations above.
 *
 * Structural rather than the generated Prisma payload type, for the reason
 * `CollectionRow` documents: a renamed column becomes a compile error rather
 * than an `undefined` that reaches the UI.
 */
export interface CashHandoverRow {
  handoverId: string;
  handoverNumber: string;
  branchId: string;
  fieldAgentId: string;
  businessDate: Date;
  expectedCashPaise: bigint;
  handedOverCashPaise: bigint;
  receivedCashPaise: bigint | null;
  differencePaise: bigint;
  status: string;
  notes: string | null;
  acknowledgmentReference: string | null;
  receivedBy: string | null;
  receivedAt: Date | null;
  journalEntryId: string | null;
  receiveIdempotencyKey: string | null;
  reversalOfHandoverId: string | null;
  reversalReason: string | null;
  reversedAt: Date | null;
  reversedBy: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;

  branch?: { name: string } | null;
  fieldAgent?: { name: string; employeeCode: string | null } | null;
  receivedByUser?: { name: string } | null;
  collections?: FieldCollectionRow[];
  reconciliations?: {
    reconciliationId: string;
    reconciliationNumber: string;
  }[];
  reversedByHandover?: { handoverId: string } | null;
}

export function toCashHandoverSummary(
  row: CashHandoverRow,
): CashHandoverSummary {
  return {
    handoverId: row.handoverId,
    handoverNumber: row.handoverNumber,
    branchId: row.branchId,
    ...(row.branch ? { branchName: row.branch.name } : {}),
    fieldAgentId: row.fieldAgentId,
    ...(row.fieldAgent ? { agentName: row.fieldAgent.name } : {}),
    businessDate: row.businessDate.toISOString().slice(0, 10),
    expectedCashPaise: row.expectedCashPaise.toString(),
    handedOverCashPaise: row.handedOverCashPaise.toString(),
    ...(row.receivedCashPaise !== null
      ? { receivedCashPaise: row.receivedCashPaise.toString() }
      : {}),
    // Signed. Negative means the branch counted less than the agent declared.
    differencePaise: row.differencePaise.toString(),
    status: row.status as CashHandoverStatus,
    ...(row.receivedBy ? { receivedBy: row.receivedBy } : {}),
    ...(row.receivedByUser ? { receivedByName: row.receivedByUser.name } : {}),
    ...(row.receivedAt ? { receivedAt: row.receivedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
    // The concurrency token, exposed as `version` for the reason every other
    // module does: one idiom, echoed back as `expectedVersion`.
    version: row.updatedAt.toISOString(),
  };
}

export function toCashHandoverDetail(row: CashHandoverRow): CashHandoverDetail {
  const reconciliation = row.reconciliations?.[0];

  return {
    ...toCashHandoverSummary(row),
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.acknowledgmentReference
      ? { acknowledgmentReference: row.acknowledgmentReference }
      : {}),
    ...(row.journalEntryId ? { journalEntryId: row.journalEntryId } : {}),
    // The custody trail (Rule 23), as a foreign key rather than a report.
    collections: (row.collections ?? []).map(toFieldCollectionSummary),
    ...(row.reversalOfHandoverId
      ? { reversalOfHandoverId: row.reversalOfHandoverId }
      : {}),
    ...(row.reversedByHandover
      ? { reversedByHandoverId: row.reversedByHandover.handoverId }
      : {}),
    ...(row.reversalReason ? { reversalReason: row.reversalReason } : {}),
    ...(row.reversedAt ? { reversedAt: row.reversedAt.toISOString() } : {}),
    ...(row.reversedBy ? { reversedBy: row.reversedBy } : {}),
    createdBy: row.createdBy,
    ...(reconciliation
      ? {
          reconciliationId: reconciliation.reconciliationId,
          reconciliationNumber: reconciliation.reconciliationNumber,
        }
      : {}),
  };
}
