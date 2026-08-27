import type {
  LegalNoticeRecord,
  PenaltySummary,
  RecoveryActionRecord,
  RecoveryAssignmentRecord,
  RecoveryCaseSummary,
  SettlementRecord,
} from '@lms/types';

/**
 * Prisma rows to wire shapes for Module 13.
 *
 * # Two rules every function here follows
 *
 * 1. **Every `bigint` becomes a string.** Money crosses the wire as an integer
 *    digit string; a `number` would silently lose paise above 2^53, and
 *    `JSON.stringify` throws on a `bigint` outright.
 * 2. **`updatedAt` becomes `version`.** The concurrency token is named for what
 *    it means to the client, not for the column it comes from — the same
 *    renaming `toCollectionDetail` and `toDisbursementDetail` do.
 *
 * Optional fields are spread conditionally rather than assigned `undefined`,
 * because `exactOptionalPropertyTypes` distinguishes an absent key from a
 * present-but-undefined one and the wire types declare the former.
 */

export function toPenaltySummary(row: PenaltyRow): PenaltySummary {
  return {
    penaltyId: row.penaltyId,
    loanId: row.loanId,
    ...(row.emiId ? { emiId: row.emiId } : {}),
    assessedDate: toIsoDate(row.assessedDate),
    amountPaise: row.amountPaise.toString(),
    paidAmountPaise: row.paidAmountPaise.toString(),
    outstandingAmountPaise: row.outstandingAmountPaise.toString(),
    status: row.status as PenaltySummary['status'],
    calculationType: row.calculationType,
    // Stored as Json and opaque to the client, which renders it as detail. Cast
    // rather than parsed: the shape is whatever the assessment recorded, and
    // validating it here would mean two definitions of the snapshot.
    calculationSnapshot: (row.calculationSnapshot ?? {}) as Record<
      string,
      unknown
    >,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAssignmentRecord(
  row: AssignmentRow,
): RecoveryAssignmentRecord {
  return {
    assignmentId: row.assignmentId,
    ...(row.fromUserId ? { fromUserId: row.fromUserId } : {}),
    ...(row.fromUser?.name ? { fromUserName: row.fromUser.name } : {}),
    toUserId: row.toUserId,
    toUserName: row.toUser?.name ?? '',
    assignedBy: row.assignedBy,
    ...(row.assignedByUser?.name
      ? { assignedByName: row.assignedByUser.name }
      : {}),
    assignedAt: row.assignedAt.toISOString(),
    ...(row.reason ? { reason: row.reason } : {}),
  };
}

/**
 * One recovery activity.
 *
 * `promiseMissed` is derived here rather than stored: a promise is missed when
 * its date has passed and no authoritative payment settled it (Scenario 16),
 * and both halves of that change without anyone editing this row. The caller
 * supplies the business date and whether a payment has landed, because neither
 * is knowable from the action alone.
 */
export function toActionRecord(
  row: ActionRow,
  promiseMissed?: boolean,
): RecoveryActionRecord {
  return {
    recoveryActionId: row.recoveryActionId,
    recoveryCaseId: row.recoveryCaseId,
    actionType: row.action as RecoveryActionRecord['actionType'],
    ...(row.actionDate ? { actionDate: toIsoDate(row.actionDate) } : {}),
    ...(row.outcome
      ? { outcome: row.outcome as RecoveryActionRecord['outcome'] }
      : {}),
    performedBy: row.performedBy,
    ...(row.performedByUser?.name
      ? { performedByName: row.performedByUser.name }
      : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.nextFollowUpDate
      ? { nextFollowUpDate: toIsoDate(row.nextFollowUpDate) }
      : {}),
    ...(row.promiseToPayDate
      ? { promiseToPayDate: toIsoDate(row.promiseToPayDate) }
      : {}),
    ...(row.promiseToPayAmountPaise !== null
      ? { promiseToPayAmountPaise: row.promiseToPayAmountPaise.toString() }
      : {}),
    ...(promiseMissed !== undefined ? { promiseMissed } : {}),
    ...(row.finalizedAt ? { finalizedAt: row.finalizedAt.toISOString() } : {}),
    ...(row.offlineActivityUuid
      ? { offlineActivityUuid: row.offlineActivityUuid }
      : {}),
    ...(row.deviceId ? { deviceId: row.deviceId } : {}),
    ...(row.gpsCaptureStatus
      ? {
          gpsCaptureStatus:
            row.gpsCaptureStatus as RecoveryActionRecord['gpsCaptureStatus'],
        }
      : {}),
    ...(row.gpsCheckInId ? { gpsCheckInId: row.gpsCheckInId } : {}),
    ...(row.customerAckReference
      ? { customerAckReference: row.customerAckReference }
      : {}),
    createdAt: row.createdAt.toISOString(),
    version: row.updatedAt.toISOString(),
  };
}

export function toLegalNoticeRecord(row: LegalNoticeRow): LegalNoticeRecord {
  return {
    legalNoticeId: row.legalNoticeId,
    recoveryCaseId: row.recoveryCaseId,
    noticeDate: toIsoDate(row.noticeDate),
    noticePeriodDays: row.noticePeriodDays,
    expiryDate: toIsoDate(row.expiryDate),
    status: row.status as LegalNoticeRecord['status'],
    ...(row.noticeReference ? { noticeReference: row.noticeReference } : {}),
    ...(row.documentRef ? { documentRef: row.documentRef } : {}),
    ...(row.issuedBy ? { issuedBy: row.issuedBy } : {}),
    ...(row.issuedByUser?.name ? { issuedByName: row.issuedByUser.name } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toSettlementRecord(row: SettlementRow): SettlementRecord {
  return {
    settlementId: row.settlementId,
    recoveryCaseId: row.recoveryCaseId,
    loanId: row.loanId,
    settlementAmountPaise: row.settlementAmountPaise.toString(),
    ...(row.outstandingBeforePaise !== null
      ? { outstandingBeforePaise: row.outstandingBeforePaise.toString() }
      : {}),
    ...(row.waivedAmountPaise !== null
      ? { waivedAmountPaise: row.waivedAmountPaise.toString() }
      : {}),
    status: row.status as SettlementRecord['status'],
    ...(row.agreedDate ? { agreedDate: toIsoDate(row.agreedDate) } : {}),
    ...(row.completedDate
      ? { completedDate: toIsoDate(row.completedDate) }
      : {}),
    ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}),
    ...(row.approvedByUser?.name
      ? { approvedByName: row.approvedByUser.name }
      : {}),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    ...(row.approvalReference
      ? { approvalReference: row.approvalReference }
      : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.journalEntryId ? { journalEntryId: row.journalEntryId } : {}),
    ...(row.createdBy ? { createdBy: row.createdBy } : {}),
    createdAt: row.createdAt.toISOString(),
    version: row.updatedAt.toISOString(),
  };
}

/**
 * A case summary.
 *
 * The overdue figures are passed in rather than read from the row, because
 * there is nowhere on the row to read them from — they are derived by
 * `OverdueService`. Threading them through here is what keeps the case list and
 * the overdue book showing the same numbers.
 */
export function toCaseSummary(
  row: CaseRow,
  overdue: { totalOverduePaise: string; daysPastDue: number; bucket: string },
): RecoveryCaseSummary {
  return {
    recoveryCaseId: row.recoveryCaseId,
    ...(row.caseNumber ? { caseNumber: row.caseNumber } : {}),
    loanId: row.loanId,
    loanNumber: row.loan?.loanNumber ?? '',
    customerId: row.loan?.customerId ?? '',
    customerName: row.loan?.customer?.fullName ?? '',
    branchId: row.branchId,
    ...(row.branch?.name ? { branchName: row.branch.name } : {}),
    status: row.status as RecoveryCaseSummary['status'],
    priority: row.priority as RecoveryCaseSummary['priority'],
    npaStatus: row.npaStatus as RecoveryCaseSummary['npaStatus'],
    openedDate: toIsoDate(row.openedDate),
    ...(row.closedDate ? { closedDate: toIsoDate(row.closedDate) } : {}),
    ...(row.assignedAgentId ? { assignedAgentId: row.assignedAgentId } : {}),
    ...(row.assignedAgent?.name
      ? { assignedAgentName: row.assignedAgent.name }
      : {}),
    ...(row.assignmentDate
      ? { assignmentDate: toIsoDate(row.assignmentDate) }
      : {}),
    totalOverduePaise: overdue.totalOverduePaise,
    daysPastDue: overdue.daysPastDue,
    bucket: overdue.bucket as RecoveryCaseSummary['bucket'],
    createdAt: row.createdAt.toISOString(),
    version: row.updatedAt.toISOString(),
  };
}

/**
 * A `@db.Date` column as `YYYY-MM-DD`.
 *
 * Reads the UTC parts. Prisma returns a DATE as midnight UTC, so
 * `toLocaleDateString` or `getFullYear` on a machine west of Greenwich would
 * report the previous day — the failure `@lms/emi`'s `dates.ts` exists to
 * prevent, and the one place a mapper can reintroduce it.
 */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The include every case read shares, so one shape feeds every mapper. */
export const RECOVERY_CASE_INCLUDE = {
  loan: {
    select: {
      loanNumber: true,
      customerId: true,
      status: true,
      customer: { select: { fullName: true } },
    },
  },
  branch: { select: { name: true, code: true } },
  assignedAgent: { select: { name: true } },
  closedByUser: { select: { name: true } },
  assignments: {
    orderBy: { assignedAt: 'asc' as const },
    include: {
      fromUser: { select: { name: true } },
      toUser: { select: { name: true } },
      assignedByUser: { select: { name: true } },
    },
  },
  actions: {
    orderBy: { createdAt: 'asc' as const },
    include: { performedByUser: { select: { name: true } } },
  },
  legalNotices: {
    orderBy: { noticeDate: 'asc' as const },
    include: { issuedByUser: { select: { name: true } } },
  },
  settlements: {
    orderBy: { createdAt: 'asc' as const },
    include: { approvedByUser: { select: { name: true } } },
  },
} as const;

type PenaltyRow = {
  penaltyId: string;
  loanId: string;
  emiId: string | null;
  assessedDate: Date;
  amountPaise: bigint;
  paidAmountPaise: bigint;
  outstandingAmountPaise: bigint;
  status: string;
  calculationType: string;
  calculationSnapshot: unknown;
  createdAt: Date;
};

type AssignmentRow = {
  assignmentId: string;
  fromUserId: string | null;
  toUserId: string;
  assignedBy: string;
  assignedAt: Date;
  reason: string | null;
  fromUser?: { name: string } | null;
  toUser?: { name: string } | null;
  assignedByUser?: { name: string } | null;
};

type ActionRow = {
  recoveryActionId: string;
  recoveryCaseId: string;
  action: string;
  actionDate: Date | null;
  outcome: string | null;
  performedBy: string;
  notes: string | null;
  nextFollowUpDate: Date | null;
  promiseToPayDate: Date | null;
  promiseToPayAmountPaise: bigint | null;
  finalizedAt: Date | null;
  offlineActivityUuid: string | null;
  deviceId: string | null;
  gpsCaptureStatus: string | null;
  gpsCheckInId: string | null;
  customerAckReference: string | null;
  createdAt: Date;
  updatedAt: Date;
  performedByUser?: { name: string } | null;
};

type LegalNoticeRow = {
  legalNoticeId: string;
  recoveryCaseId: string;
  noticeDate: Date;
  noticePeriodDays: number;
  expiryDate: Date;
  status: string;
  noticeReference: string | null;
  documentRef: string | null;
  issuedBy: string | null;
  createdAt: Date;
  issuedByUser?: { name: string } | null;
};

type SettlementRow = {
  settlementId: string;
  recoveryCaseId: string;
  loanId: string;
  settlementAmountPaise: bigint;
  outstandingBeforePaise: bigint | null;
  waivedAmountPaise: bigint | null;
  status: string;
  agreedDate: Date | null;
  completedDate: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  approvalReference: string | null;
  reason: string | null;
  journalEntryId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  approvedByUser?: { name: string } | null;
};

type CaseRow = {
  recoveryCaseId: string;
  caseNumber: string | null;
  loanId: string;
  branchId: string;
  status: string;
  priority: string;
  npaStatus: string;
  openedDate: Date;
  closedDate: Date | null;
  assignedAgentId: string | null;
  assignmentDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  loan?: {
    loanNumber: string;
    customerId: string;
    customer?: { fullName: string } | null;
  } | null;
  branch?: { name: string } | null;
  assignedAgent?: { name: string } | null;
};
