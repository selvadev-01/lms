import type {
  JournalDetail,
  JournalLineView,
  JournalSummary,
} from '@lms/types';

/**
 * Prisma rows to the journal API shapes.
 *
 * Row types are hand-written structural interfaces rather than generated Prisma
 * payload types, following `collection.mapper.ts`: the mapper stays readable,
 * and a spec can build one by hand without a database.
 *
 * # Totals are computed here, once
 *
 * `totalDebitPaise`, `totalCreditPaise` and `balanced` are returned rather than
 * left for the client to sum. Summing in the browser would produce a number
 * that looks like the same assertion but is really the client marking its own
 * homework — and `LedgerPanel.tsx` already documents that rule for the entry
 * viewer it will share with this one.
 */

export const JOURNAL_INCLUDE = {
  lines: {
    orderBy: { lineNumber: 'asc' },
    include: {
      account: {
        select: { accountId: true, accountCode: true, accountName: true },
      },
    },
  },
  branch: { select: { name: true } },
  originalEntry: { select: { journalEntryId: true, entryNumber: true } },
  reversalEntries: { select: { journalEntryId: true, entryNumber: true } },
} as const;

export interface JournalLineRow {
  journalLineId: string;
  lineNumber: number;
  accountId: string;
  debitPaise: bigint;
  creditPaise: bigint;
  description: string | null;
  sourceComponent: string | null;
  account: { accountId: string; accountCode: string; accountName: string };
}

export interface JournalRow {
  journalEntryId: string;
  entryNumber: string;
  entryDate: Date;
  entryType: string;
  status: string;
  description: string | null;
  sourceType: string | null;
  sourceId: string | null;
  branchId: string | null;
  postedAt: Date | null;
  postedBy: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  originalJournalEntryId: string | null;
  reversalReason: string | null;
  adjustmentReason: string | null;
  approvalReference: string | null;
  lines: JournalLineRow[];
  branch?: { name: string } | null;
  originalEntry?: { journalEntryId: string; entryNumber: string } | null;
  reversalEntries?: { journalEntryId: string; entryNumber: string }[];
}

function totalsOf(lines: JournalLineRow[]): {
  debit: bigint;
  credit: bigint;
} {
  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    debit += line.debitPaise;
    credit += line.creditPaise;
  }
  return { debit, credit };
}

export function toJournalLineView(row: JournalLineRow): JournalLineView {
  return {
    journalLineId: row.journalLineId,
    lineNumber: row.lineNumber,
    accountId: row.accountId,
    accountCode: row.account.accountCode,
    accountName: row.account.accountName,
    // A bigint serialized by JSON.stringify throws; one coerced to Number loses
    // precision above 2^53.
    debitPaise: row.debitPaise.toString(),
    creditPaise: row.creditPaise.toString(),
    ...(row.description ? { description: row.description } : {}),
    ...(row.sourceComponent ? { sourceComponent: row.sourceComponent } : {}),
  };
}

export function toJournalSummary(row: JournalRow): JournalSummary {
  const { debit, credit } = totalsOf(row.lines);

  return {
    journalEntryId: row.journalEntryId,
    entryNumber: row.entryNumber,
    // A DATE column: sliced rather than serialized whole, so a timezone shift
    // cannot move the day.
    entryDate: row.entryDate.toISOString().slice(0, 10),
    entryType: row.entryType,
    status: row.status as JournalSummary['status'],
    ...(row.description ? { description: row.description } : {}),
    ...(row.sourceType ? { sourceType: row.sourceType } : {}),
    ...(row.sourceId ? { sourceId: row.sourceId } : {}),
    ...(row.branchId ? { branchId: row.branchId } : {}),
    ...(row.branch ? { branchName: row.branch.name } : {}),
    totalDebitPaise: debit.toString(),
    totalCreditPaise: credit.toString(),
    balanced: debit === credit,
    // Absent while the entry is a DRAFT. Omitted rather than rendered empty, so
    // a caller cannot mistake "not yet posted" for "posted at an unknown time".
    ...(row.postedAt ? { postedAt: row.postedAt.toISOString() } : {}),
    version: row.updatedAt.toISOString(),
  };
}

/**
 * Actor names, resolved separately.
 *
 * `createdBy` and `postedBy` are bare uuid columns with no Prisma relation —
 * adding one would be a migration for a display nicety, and the service already
 * has to read users for other reasons. The service passes what it looked up;
 * an absent name simply omits the field rather than inventing one.
 */
export interface ActorNames {
  createdByName?: string;
  postedByName?: string;
}

export function toJournalDetail(
  row: JournalRow,
  names: ActorNames = {},
): JournalDetail {
  const isDraft = row.status === 'DRAFT';
  const isPosted = row.status === 'POSTED';
  const reversal = row.reversalEntries?.[0];

  return {
    ...toJournalSummary(row),
    lines: row.lines.map(toJournalLineView),
    createdBy: row.createdBy,
    ...(names.createdByName ? { createdByName: names.createdByName } : {}),
    ...(row.postedBy ? { postedBy: row.postedBy } : {}),
    ...(names.postedByName ? { postedByName: names.postedByName } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.originalJournalEntryId
      ? { originalJournalEntryId: row.originalJournalEntryId }
      : {}),
    ...(row.originalEntry
      ? { originalEntryNumber: row.originalEntry.entryNumber }
      : {}),
    ...(reversal
      ? {
          reversalJournalEntryId: reversal.journalEntryId,
          reversalEntryNumber: reversal.entryNumber,
        }
      : {}),
    ...(row.reversalReason ? { reversalReason: row.reversalReason } : {}),
    ...(row.adjustmentReason ? { adjustmentReason: row.adjustmentReason } : {}),
    ...(row.approvalReference
      ? { approvalReference: row.approvalReference }
      : {}),
    /**
     * Server verdicts on the lifecycle, so the UI never re-derives it.
     *
     * `canReverse` is false once a reversal exists, which is the readable half
     * of Scenario 41 — the partial unique index on
     * `(org_id, original_journal_entry_id)` is the guarantee under concurrency.
     * Whether the caller *may* reverse is a separate question the permission
     * guard answers; this says only whether the entry is in a state that admits
     * one.
     */
    canEdit: isDraft,
    canDelete: isDraft,
    canPost: isDraft,
    canReverse: isPosted && !reversal,
  };
}
