import { Injectable, Logger } from '@nestjs/common';
import type { ReconciliationFinding, ReconciliationReport } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReconciliationQueryDto } from './dto/ledger.dto';

/**
 * Source-to-journal reconciliation (Module 14 Scenarios 58-60).
 *
 * # This service flags. It never repairs.
 *
 * There is no write path in this file — no `create`, no `update`, no
 * `$transaction`. That is the whole design, not an omission. Scenario 59 says
 * the system must not "silently fabricate a balancing entry" and Scenario 60
 * says it must not "automatically delete historical records"; the way to
 * guarantee both is for the code that detects the problem to be incapable of
 * acting on it. A finding is an instruction to a person, not to the system.
 *
 * # What it checks
 *
 * | Finding             | Question it answers                                   |
 * |---------------------|-------------------------------------------------------|
 * | MISSING_JOURNAL     | A source transaction says it moved money — where is it?|
 * | DUPLICATE_JOURNAL   | One source event, two authoritative journals?          |
 * | UNBALANCED_JOURNAL  | A posted entry whose debits do not equal its credits.  |
 *
 * The third should always be empty. If it is not, the deferred balance trigger
 * has been bypassed — which is precisely the thing you would want to be told
 * about, and precisely the thing no application-level check would catch on its
 * own.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(
    actor: AuthContext,
    dto: ReconciliationQueryDto,
    meta: RequestMeta,
  ): Promise<ReconciliationReport> {
    const from = new Date(`${dto.fromDate}T00:00:00Z`);
    const to = new Date(`${dto.toDate}T00:00:00Z`);

    const branchScope = actor.branchId ? { branchId: actor.branchId } : {};

    const [missing, duplicates, unbalanced, journalsChecked, sourceCount] =
      await Promise.all([
        this.findMissingJournals(actor, dto, from, to, branchScope),
        this.findDuplicateJournals(actor, from, to, branchScope),
        this.findUnbalancedJournals(actor, from, to, branchScope),
        this.prisma.journalEntry.count({
          where: {
            orgId: actor.orgId,
            status: { in: ['POSTED', 'REVERSED'] },
            entryDate: { gte: from, lte: to },
            ...branchScope,
          },
        }),
        this.countSourceEvents(actor, from, to, branchScope),
      ]);

    const findingCount = missing.length + duplicates.length + unbalanced.length;

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.RECONCILIATION_RUN,
      entityType: 'ORGANIZATION',
      entityId: actor.orgId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        missingCount: missing.length,
        duplicateCount: duplicates.length,
        unbalancedCount: unbalanced.length,
      },
    });

    if (findingCount > 0) {
      this.logger.warn(
        `Reconciliation for org ${actor.orgId} found ${findingCount} inconsistency(ies) between ${dto.fromDate} and ${dto.toDate}`,
      );
    }

    return {
      checkedAt: new Date().toISOString(),
      fromDate: dto.fromDate,
      toDate: dto.toDate,
      missingJournals: missing,
      duplicateJournals: duplicates,
      unbalancedJournals: unbalanced,
      summary: {
        sourceEventsChecked: sourceCount,
        journalsChecked,
        findingCount,
      },
    };
  }

  /**
   * Scenario 59: a source transaction that is financially final but has no
   * journal.
   *
   * Both source modules write `journalEntryId` back inside the same transaction
   * that posts the entry, so a null one on a completed row means the write-back
   * was lost — which cannot happen through the normal path and is therefore
   * worth a person's attention.
   */
  private async findMissingJournals(
    actor: AuthContext,
    dto: ReconciliationQueryDto,
    from: Date,
    to: Date,
    branchScope: { branchId?: string },
  ): Promise<ReconciliationFinding[]> {
    const findings: ReconciliationFinding[] = [];

    const wantDisbursements =
      !dto.sourceType || dto.sourceType === 'DISBURSEMENT';
    const wantCollections = !dto.sourceType || dto.sourceType === 'COLLECTION';

    if (wantDisbursements) {
      const rows = await this.prisma.disbursement.findMany({
        where: {
          orgId: actor.orgId,
          status: 'COMPLETED',
          journalEntryId: null,
          createdAt: { gte: from, lte: this.endOfDay(to) },
          ...branchScope,
        },
        select: {
          disbursementId: true,
          transactionReference: true,
          createdAt: true,
        },
        take: 200,
      });

      for (const row of rows) {
        findings.push({
          kind: 'MISSING_JOURNAL',
          sourceModule: 'DISBURSEMENT',
          sourceId: row.disbursementId,
          ...(row.transactionReference
            ? { sourceReference: row.transactionReference }
            : {}),
          journalEntryIds: [],
          occurredOn: row.createdAt.toISOString().slice(0, 10),
          detail:
            'This disbursement is marked completed but has no ledger entry. Money is recorded as moved with nothing in the ledger to account for it.',
        });
      }
    }

    if (wantCollections) {
      const rows = await this.prisma.collection.findMany({
        where: {
          orgId: actor.orgId,
          status: { in: ['POSTED', 'REVERSED'] },
          journalEntryId: null,
          collectionDate: { gte: from, lte: to },
          ...branchScope,
        },
        select: {
          collectionId: true,
          receiptNumber: true,
          collectionDate: true,
        },
        take: 200,
      });

      for (const row of rows) {
        findings.push({
          kind: 'MISSING_JOURNAL',
          sourceModule: 'COLLECTION',
          sourceId: row.collectionId,
          ...(row.receiptNumber ? { sourceReference: row.receiptNumber } : {}),
          journalEntryIds: [],
          occurredOn: row.collectionDate.toISOString().slice(0, 10),
          detail:
            'This collection is posted but has no ledger entry. A receipt was issued with nothing in the ledger to account for it.',
        });
      }
    }

    return findings;
  }

  /**
   * Scenario 60: one source event with more than one authoritative journal.
   *
   * Deliberately *detected* rather than prevented by a unique index. A
   * constraint would make this migration fail on any historic duplicate, and
   * the source explicitly asks for the inconsistency to be flagged for
   * controlled investigation rather than refused — the second journal, once
   * written, is a fact the ledger has to account for.
   */
  private async findDuplicateJournals(
    actor: AuthContext,
    from: Date,
    to: Date,
    branchScope: { branchId?: string },
  ): Promise<ReconciliationFinding[]> {
    const grouped = await this.prisma.journalEntry.groupBy({
      by: ['sourceType', 'sourceId'],
      where: {
        orgId: actor.orgId,
        status: 'POSTED',
        sourceId: { not: null },
        entryDate: { gte: from, lte: to },
        ...branchScope,
      },
      _count: { _all: true },
      having: { sourceId: { _count: { gt: 1 } } },
    });

    if (grouped.length === 0) return [];

    const findings: ReconciliationFinding[] = [];

    for (const group of grouped) {
      if (!group.sourceId) continue;

      const entries = await this.prisma.journalEntry.findMany({
        where: {
          orgId: actor.orgId,
          status: 'POSTED',
          sourceType: group.sourceType,
          sourceId: group.sourceId,
        },
        select: {
          journalEntryId: true,
          entryNumber: true,
          entryDate: true,
        },
        orderBy: { entryNumber: 'asc' },
      });

      findings.push({
        kind: 'DUPLICATE_JOURNAL',
        sourceModule: group.sourceType ?? 'UNKNOWN',
        sourceId: group.sourceId,
        sourceReference: entries.map((e) => e.entryNumber).join(', '),
        journalEntryIds: entries.map((e) => e.journalEntryId),
        occurredOn:
          entries[0]?.entryDate.toISOString().slice(0, 10) ??
          from.toISOString().slice(0, 10),
        detail: `${entries.length} posted journals reference the same source transaction. One of them is a duplicate posting and the ledger is overstated by its amount.`,
      });
    }

    return findings;
  }

  /**
   * A posted entry whose debits do not equal its credits.
   *
   * Should always return nothing: `assert_journal_balanced` runs as a deferred
   * constraint trigger at COMMIT, so an unbalanced entry cannot be written
   * through any path — including psql. A non-empty result means the trigger was
   * dropped or disabled, which no application-level check would otherwise
   * reveal.
   */
  private async findUnbalancedJournals(
    actor: AuthContext,
    from: Date,
    to: Date,
    branchScope: { branchId?: string },
  ): Promise<ReconciliationFinding[]> {
    const grouped = await this.prisma.journalLine.groupBy({
      by: ['journalEntryId'],
      where: {
        orgId: actor.orgId,
        journalEntry: {
          orgId: actor.orgId,
          status: { in: ['POSTED', 'REVERSED'] },
          entryDate: { gte: from, lte: to },
          ...branchScope,
        },
      },
      _sum: { debitPaise: true, creditPaise: true },
    });

    const offenders = grouped.filter(
      (row) => (row._sum.debitPaise ?? 0n) !== (row._sum.creditPaise ?? 0n),
    );

    if (offenders.length === 0) return [];

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        orgId: actor.orgId,
        journalEntryId: { in: offenders.map((row) => row.journalEntryId) },
      },
      select: {
        journalEntryId: true,
        entryNumber: true,
        entryDate: true,
        sourceType: true,
        sourceId: true,
      },
    });

    const byId = new Map(entries.map((entry) => [entry.journalEntryId, entry]));

    return offenders.map((row) => {
      const entry = byId.get(row.journalEntryId);
      const debit = row._sum.debitPaise ?? 0n;
      const credit = row._sum.creditPaise ?? 0n;

      return {
        kind: 'UNBALANCED_JOURNAL' as const,
        sourceModule: entry?.sourceType ?? 'MANUAL',
        sourceId: entry?.sourceId ?? row.journalEntryId,
        ...(entry ? { sourceReference: entry.entryNumber } : {}),
        journalEntryIds: [row.journalEntryId],
        occurredOn:
          entry?.entryDate.toISOString().slice(0, 10) ??
          from.toISOString().slice(0, 10),
        detail: `Posted journal debits ${debit.toString()} paise against credits ${credit.toString()} paise. The balance trigger should have made this impossible; check that it is still installed.`,
      };
    });
  }

  private async countSourceEvents(
    actor: AuthContext,
    from: Date,
    to: Date,
    branchScope: { branchId?: string },
  ): Promise<number> {
    const [disbursements, collections] = await Promise.all([
      this.prisma.disbursement.count({
        where: {
          orgId: actor.orgId,
          status: 'COMPLETED',
          createdAt: { gte: from, lte: this.endOfDay(to) },
          ...branchScope,
        },
      }),
      this.prisma.collection.count({
        where: {
          orgId: actor.orgId,
          status: { in: ['POSTED', 'REVERSED'] },
          collectionDate: { gte: from, lte: to },
          ...branchScope,
        },
      }),
    ]);

    return disbursements + collections;
  }

  /**
   * `toDate` inclusive for timestamp columns.
   *
   * `collectionDate` is a DATE and compares cleanly, but `Disbursement` has no
   * date column — only `createdAt`, a timestamp. Comparing it against midnight
   * would silently exclude everything that happened on the last day of the
   * window, which is the day an operator is most likely to be reconciling.
   */
  private endOfDay(date: Date): Date {
    return new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
}
