import type {
  CashDiscrepancyResolution,
  CashDiscrepancyType,
  CashReconciliationDetail,
  CashReconciliationStatus,
  CashReconciliationSummary,
} from '@lms/types';

/** The relations every reconciliation read needs. */
export const CASH_RECONCILIATION_INCLUDE = {
  branch: { select: { name: true } },
  fieldAgent: { select: { name: true } },
  resolvedByUser: { select: { name: true } },
  handover: { select: { handoverNumber: true } },
} as const;

/**
 * A reconciliation row with the relations above.
 *
 * Structural rather than the generated Prisma payload, for the reason
 * `CollectionRow` documents.
 */
export interface CashReconciliationRow {
  reconciliationId: string;
  reconciliationNumber: string;
  branchId: string;
  fieldAgentId: string;
  handoverId: string | null;
  businessDate: Date;
  expectedCashPaise: bigint;
  actualCashPaise: bigint;
  differencePaise: bigint;
  status: string;
  discrepancyType: string | null;
  discrepancyReason: string | null;
  resolutionAction: string | null;
  resolutionNotes: string | null;
  approvalReference: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  approvedBy: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;

  branch?: { name: string } | null;
  fieldAgent?: { name: string } | null;
  resolvedByUser?: { name: string } | null;
  handover?: { handoverNumber: string } | null;
}

export function toCashReconciliationSummary(
  row: CashReconciliationRow,
): CashReconciliationSummary {
  return {
    reconciliationId: row.reconciliationId,
    reconciliationNumber: row.reconciliationNumber,
    branchId: row.branchId,
    ...(row.branch ? { branchName: row.branch.name } : {}),
    fieldAgentId: row.fieldAgentId,
    ...(row.fieldAgent ? { agentName: row.fieldAgent.name } : {}),
    ...(row.handoverId ? { handoverId: row.handoverId } : {}),
    ...(row.handover ? { handoverNumber: row.handover.handoverNumber } : {}),
    businessDate: row.businessDate.toISOString().slice(0, 10),
    expectedCashPaise: row.expectedCashPaise.toString(),
    actualCashPaise: row.actualCashPaise.toString(),
    // Signed, and the only place in this module a money string may start with
    // `-`. Negative is a shortage.
    differencePaise: row.differencePaise.toString(),
    status: row.status as CashReconciliationStatus,
    ...(row.discrepancyType
      ? { discrepancyType: row.discrepancyType as CashDiscrepancyType }
      : {}),
    createdAt: row.createdAt.toISOString(),
    version: row.updatedAt.toISOString(),
  };
}

export function toCashReconciliationDetail(
  row: CashReconciliationRow,
): CashReconciliationDetail {
  return {
    ...toCashReconciliationSummary(row),
    ...(row.discrepancyReason
      ? { discrepancyReason: row.discrepancyReason }
      : {}),
    ...(row.resolutionAction
      ? {
          resolutionAction: row.resolutionAction as CashDiscrepancyResolution,
        }
      : {}),
    ...(row.resolutionNotes ? { resolutionNotes: row.resolutionNotes } : {}),
    // The Module 14 journal entry number, when the resolution needed an
    // accounting adjustment. This module posts none itself.
    ...(row.approvalReference
      ? { approvalReference: row.approvalReference }
      : {}),
    ...(row.resolvedBy ? { resolvedBy: row.resolvedBy } : {}),
    ...(row.resolvedByUser ? { resolvedByName: row.resolvedByUser.name } : {}),
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
    ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    createdBy: row.createdBy,
  };
}
