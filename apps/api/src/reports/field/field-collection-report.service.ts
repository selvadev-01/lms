import { Injectable } from '@nestjs/common';
import type {
  FieldCollectionReport,
  FieldCollectionReportRow,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReportQueryDto } from '../dto/reports.dto';
import { resolveDateBasis } from '../report-date-basis';
import {
  assertDateRange,
  buildMeta,
  canSeePii,
  civilToDate,
  civilToExclusiveEnd,
  resolveBranchScope,
} from '../report-scope';

export const REPORTS_FIELD_VIEW_PERMISSION = 'reports.field.view';

/**
 * The Field Collection & Reconciliation report (Scenarios 17-19).
 *
 * # A row is an agent-day, not a record
 *
 * The story's field list — collection count, cash collected, cash handed over,
 * cash pending, shortage, excess — spans three tables, and none of them has a
 * row per agent per day. So this report groups: collections give the count and
 * the cash taken, handovers give what was passed to the branch, and
 * reconciliations give the counted difference.
 *
 * # Pending cash is a subtraction, not a status
 *
 * Scenario 18 asks that cash collected but not yet reconciled is shown
 * according to the authoritative reconciliation state, and not treated as
 * reconciled. `cashPending` is therefore collected minus handed-over for that
 * agent-day, which is a fact about custody rather than a flag anyone sets. A
 * status column would have to be maintained; this cannot drift.
 *
 * # Shortage and excess are the reconciliation's own verdict
 *
 * `CashReconciliation.differencePaise` is signed — negative is a shortage,
 * positive an excess — and this report splits it into two unsigned columns
 * because that is how the story names them. It does not recompute the
 * difference from the amounts: Module 12 decided it, and Scenario 19 says no
 * report action modifies the reconciliation record, which includes not
 * second-guessing its arithmetic (Rule 14).
 */
@Injectable()
export class FieldCollectionReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(
    actor: AuthContext,
    query: ReportQueryDto,
    meta: RequestMeta,
  ): Promise<FieldCollectionReport> {
    const branchId = resolveBranchScope(actor, query.branchId);
    const dateBasis = resolveDateBasis('FIELD_COLLECTIONS', query.dateBasis);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const piiAllowed = canSeePii(actor);

    if (query.fromDate && query.toDate) {
      assertDateRange(query.fromDate, query.toDate);
    }

    const range = {
      ...(query.fromDate ? { gte: civilToDate(query.fromDate) } : {}),
      ...(query.toDate ? { lt: civilToExclusiveEnd(query.toDate) } : {}),
    };
    const dated = query.fromDate || query.toDate;
    const scope = { orgId: actor.orgId, ...(branchId ? { branchId } : {}) };

    // Three reads rather than one join: the grain differs (a collection is per
    // payment, a handover per agent-day, a reconciliation per agent-day), and a
    // join across all three would multiply rows and inflate every sum.
    const [collections, handovers, reconciliations] = await Promise.all([
      this.prisma.collection.groupBy({
        by: ['collectorUserId', 'branchId', 'collectionDate'],
        where: {
          ...scope,
          isFieldCollection: true,
          // Reversed collections are not cash in an agent's hands.
          status: 'POSTED',
          ...(dated ? { collectionDate: range } : {}),
        },
        _sum: { amountPaise: true },
        _count: { _all: true },
      }),
      this.prisma.cashHandover.groupBy({
        by: ['fieldAgentId', 'branchId', 'businessDate'],
        where: { ...scope, ...(dated ? { businessDate: range } : {}) },
        _sum: { handedOverCashPaise: true },
      }),
      this.prisma.cashReconciliation.findMany({
        where: { ...scope, ...(dated ? { businessDate: range } : {}) },
        select: {
          fieldAgentId: true,
          branchId: true,
          businessDate: true,
          differencePaise: true,
          status: true,
        },
      }),
    ]);

    const rows = await this.combine(
      actor,
      collections,
      handovers,
      reconciliations,
    );

    const totals = rows.reduce(
      (acc, row) => ({
        cashCollectedPaise:
          acc.cashCollectedPaise + BigInt(row.cashCollectedPaise),
        cashHandedOverPaise:
          acc.cashHandedOverPaise + BigInt(row.cashHandedOverPaise),
        cashPendingPaise: acc.cashPendingPaise + BigInt(row.cashPendingPaise),
        shortagePaise: acc.shortagePaise + BigInt(row.shortagePaise),
        excessPaise: acc.excessPaise + BigInt(row.excessPaise),
        collections: acc.collections + row.collectionCount,
      }),
      {
        cashCollectedPaise: BigInt(0),
        cashHandedOverPaise: BigInt(0),
        cashPendingPaise: BigInt(0),
        shortagePaise: BigInt(0),
        excessPaise: BigInt(0),
        collections: 0,
      },
    );

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.REPORT_GENERATED,
      entityType: 'REPORT',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        category: 'FIELD_COLLECTIONS',
        dateBasis,
        branchId,
        actorBranchId: actor.branchId,
        rowCount: rows.length,
        piiMasked: !piiAllowed,
      },
    });

    return {
      meta: buildMeta({
        category: 'FIELD_COLLECTIONS',
        dateBasis,
        fromDate: query.fromDate ?? '',
        toDate: query.toDate ?? '',
        branchId,
        piiMasked: !piiAllowed,
      }),
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
      totals: {
        cashCollectedPaise: totals.cashCollectedPaise.toString(),
        cashHandedOverPaise: totals.cashHandedOverPaise.toString(),
        cashPendingPaise: totals.cashPendingPaise.toString(),
        shortagePaise: totals.shortagePaise.toString(),
        excessPaise: totals.excessPaise.toString(),
        collections: totals.collections,
        agentDays: rows.length,
      },
    };
  }

  /**
   * Fold the three groupings into one row per agent-day.
   *
   * A handover or reconciliation with no matching collections still produces a
   * row: an agent who handed over cash the report cannot account for is exactly
   * the discrepancy this report exists to surface, and dropping the row would
   * hide it.
   */
  private async combine(
    actor: AuthContext,
    collections: CollectionGroup[],
    handovers: HandoverGroup[],
    reconciliations: ReconciliationRow[],
  ): Promise<FieldCollectionReportRow[]> {
    const byKey = new Map<string, MutableRow>();

    const keyOf = (agentId: string, branchId: string, date: Date): string =>
      `${agentId}|${branchId}|${date.toISOString().slice(0, 10)}`;

    const ensure = (
      agentId: string,
      branchId: string,
      date: Date,
    ): MutableRow => {
      const key = keyOf(agentId, branchId, date);
      const existing = byKey.get(key);
      if (existing) return existing;

      const created: MutableRow = {
        fieldAgentId: agentId,
        branchId,
        businessDate: date.toISOString().slice(0, 10),
        collectionCount: 0,
        collected: BigInt(0),
        handedOver: BigInt(0),
        shortage: BigInt(0),
        excess: BigInt(0),
        reconciliationStatus: 'NOT_RECONCILED',
      };
      byKey.set(key, created);
      return created;
    };

    for (const group of collections) {
      const row = ensure(
        group.collectorUserId,
        group.branchId,
        group.collectionDate,
      );
      row.collectionCount += group._count._all;
      row.collected += group._sum.amountPaise ?? BigInt(0);
    }

    for (const group of handovers) {
      const row = ensure(
        group.fieldAgentId,
        group.branchId,
        group.businessDate,
      );
      row.handedOver += group._sum.handedOverCashPaise ?? BigInt(0);
    }

    for (const reconciliation of reconciliations) {
      const row = ensure(
        reconciliation.fieldAgentId,
        reconciliation.branchId,
        reconciliation.businessDate,
      );
      // Signed: negative is a shortage, positive an excess. Split rather than
      // recomputed — see the note at the top of this class.
      if (reconciliation.differencePaise < BigInt(0)) {
        row.shortage += -reconciliation.differencePaise;
      } else {
        row.excess += reconciliation.differencePaise;
      }
      row.reconciliationStatus = reconciliation.status;
    }

    const rows = [...byKey.values()];

    // Names are resolved in one query rather than per row.
    const agentIds = [...new Set(rows.map((row) => row.fieldAgentId))];
    const branchIds = [...new Set(rows.map((row) => row.branchId))];

    const [agents, branches] = await Promise.all([
      this.prisma.user.findMany({
        where: { orgId: actor.orgId, userId: { in: agentIds } },
        select: { userId: true, name: true },
      }),
      this.prisma.branch.findMany({
        where: { orgId: actor.orgId, branchId: { in: branchIds } },
        select: { branchId: true, name: true },
      }),
    ]);

    const agentName = new Map(agents.map((row) => [row.userId, row.name]));
    const branchName = new Map(branches.map((row) => [row.branchId, row.name]));

    return rows
      .sort((a, b) =>
        b.businessDate === a.businessDate
          ? (agentName.get(a.fieldAgentId) ?? '').localeCompare(
              agentName.get(b.fieldAgentId) ?? '',
            )
          : b.businessDate.localeCompare(a.businessDate),
      )
      .map((row) => ({
        fieldAgentId: row.fieldAgentId,
        // A field agent is a colleague, not a customer, so the PII permission
        // does not mask them — the same reasoning as the overdue report.
        fieldAgentName: agentName.get(row.fieldAgentId) ?? '',
        branchId: row.branchId,
        branchName: branchName.get(row.branchId) ?? '',
        businessDate: row.businessDate,
        collectionCount: row.collectionCount,
        cashCollectedPaise: row.collected.toString(),
        cashHandedOverPaise: row.handedOver.toString(),
        // Never negative: handing over more than was collected is a shortage on
        // the branch's side, and it is reported as an excess by the
        // reconciliation rather than as negative pending cash here.
        cashPendingPaise: (row.collected > row.handedOver
          ? row.collected - row.handedOver
          : BigInt(0)
        ).toString(),
        shortagePaise: row.shortage.toString(),
        excessPaise: row.excess.toString(),
        reconciliationStatus: row.reconciliationStatus,
      }));
  }
}

interface MutableRow {
  fieldAgentId: string;
  branchId: string;
  businessDate: string;
  collectionCount: number;
  collected: bigint;
  handedOver: bigint;
  shortage: bigint;
  excess: bigint;
  reconciliationStatus: string;
}

interface CollectionGroup {
  collectorUserId: string;
  branchId: string;
  collectionDate: Date;
  _sum: { amountPaise: bigint | null };
  _count: { _all: number };
}

interface HandoverGroup {
  fieldAgentId: string;
  branchId: string;
  businessDate: Date;
  _sum: { handedOverCashPaise: bigint | null };
}

interface ReconciliationRow {
  fieldAgentId: string;
  branchId: string;
  businessDate: Date;
  differencePaise: bigint;
  status: string;
}
