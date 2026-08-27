import { Injectable } from '@nestjs/common';
import type { CollectionReport, CollectionReportRow } from '@lms/types';

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
  maskName,
  orgBranchWhere,
  resolveBranchScope,
} from '../report-scope';

export const REPORTS_COLLECTIONS_VIEW_PERMISSION = 'reports.collections.view';

/**
 * The Repayment & Collection report (Scenarios 13-16).
 *
 * # The allocation is read, never recomputed
 *
 * `penaltyPaidPaise`, `interestPaidPaise`, `principalPaidPaise` and
 * `feesPaidPaise` are columns Module 11 wrote when it allocated the payment.
 * This report displays them. Rule 21 fixes the order — penalty, then interest,
 * then principal, then fees — and Rule 22 requires the report to show the
 * authoritative allocation, so re-splitting `amountPaise` here would produce a
 * second answer that could disagree with the ledger for the same receipt.
 *
 * Scenario 14 asks that the components reconcile to the collected amount. They
 * do, because they are what the allocation produced; `totals` sums the same
 * columns rather than deriving them, so the footer cannot disagree with the
 * rows above it.
 *
 * # Reversals are shown gross, and excluded from the money total
 *
 * Scenario 15 requires the configured reversal treatment, traceability to the
 * original, and no deletion of history. The treatment chosen is *gross with a
 * reference*: both the original and its reversal appear as rows, each naming
 * the other, and `collectedAmountPaise` in `totals` counts neither a reversed
 * collection nor its reversing entry.
 *
 * Netting them to zero inside one row would be tidier and worse — the evidence
 * that money arrived and was sent back would vanish from the report, which is
 * exactly what Scenario 15's "does not delete historical evidence" forbids.
 *
 * // TODO(open-question): Question 10 — whether reversals should be gross,
 * // netted or separate rows by default is unresolved. Gross-with-reference is
 * // the reading that loses no information; netting can be derived from it,
 * // while the reverse is not true.
 */
@Injectable()
export class CollectionReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(
    actor: AuthContext,
    query: ReportQueryDto,
    meta: RequestMeta,
  ): Promise<CollectionReport> {
    const branchId = resolveBranchScope(actor, query.branchId);
    const dateBasis = resolveDateBasis('COLLECTIONS', query.dateBasis);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const piiAllowed = canSeePii(actor);

    if (query.fromDate && query.toDate) {
      assertDateRange(query.fromDate, query.toDate);
    }

    const where = {
      ...orgBranchWhere(actor, query.branchId),
      ...(query.fromDate || query.toDate
        ? {
            collectionDate: {
              ...(query.fromDate ? { gte: civilToDate(query.fromDate) } : {}),
              ...(query.toDate
                ? { lt: civilToExclusiveEnd(query.toDate) }
                : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              {
                receiptNumber: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                loan: {
                  loanNumber: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
              {
                customer: {
                  fullName: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total, sums] = await Promise.all([
      this.prisma.collection.findMany({
        where,
        include: COLLECTION_REPORT_INCLUDE,
        orderBy: [{ collectionDate: 'desc' }, { receiptNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.collection.count({ where }),
      // Aggregated over the whole filtered set, not the page. Rule 35: the
      // summary must represent the same authorized dataset the filters
      // describe, and a page-local total understates every multi-page report.
      //
      // POSTED only. A reversed collection and its reversing entry both still
      // appear as rows — the reader can see what happened — but neither counts
      // toward money actually collected.
      this.prisma.collection.aggregate({
        where: { ...where, status: 'POSTED' },
        _sum: {
          amountPaise: true,
          penaltyPaidPaise: true,
          interestPaidPaise: true,
          principalPaidPaise: true,
          feesPaidPaise: true,
        },
      }),
    ]);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.REPORT_GENERATED,
      entityType: 'REPORT',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        category: 'COLLECTIONS',
        dateBasis,
        branchId,
        actorBranchId: actor.branchId,
        rowCount: total,
        piiMasked: !piiAllowed,
      },
    });

    return {
      meta: buildMeta({
        category: 'COLLECTIONS',
        dateBasis,
        fromDate: query.fromDate ?? '',
        toDate: query.toDate ?? '',
        branchId,
        piiMasked: !piiAllowed,
      }),
      rows: rows.map((row) => this.toRow(row, piiAllowed)),
      total,
      page,
      pageSize,
      totals: {
        collectedAmountPaise: (sums._sum.amountPaise ?? BigInt(0)).toString(),
        penaltyAllocationPaise: (
          sums._sum.penaltyPaidPaise ?? BigInt(0)
        ).toString(),
        interestAllocationPaise: (
          sums._sum.interestPaidPaise ?? BigInt(0)
        ).toString(),
        principalAllocationPaise: (
          sums._sum.principalPaidPaise ?? BigInt(0)
        ).toString(),
        feeAllocationPaise: (sums._sum.feesPaidPaise ?? BigInt(0)).toString(),
        collections: total,
      },
    };
  }

  /**
   * One collection row.
   *
   * `reversalReference` points in whichever direction applies: a reversing
   * entry names the receipt it undid, and a reversed original names the entry
   * that undid it. Either way the reader can follow the pair, which is the
   * traceability Scenario 15 requires.
   */
  private toRow(
    row: CollectionReportRecord,
    piiAllowed: boolean,
  ): CollectionReportRow {
    const reversalReference =
      row.reversalOf?.receiptNumber ?? row.reversedByCollection?.receiptNumber;

    return {
      collectionId: row.collectionId,
      ...(row.receiptNumber ? { receiptNumber: row.receiptNumber } : {}),
      loanId: row.loanId,
      loanNumber: row.loan.loanNumber,
      customerName: maskName(row.customer.fullName, piiAllowed),
      branchId: row.branchId,
      branchName: row.branch?.name ?? '',
      collectionDate: row.collectionDate.toISOString().slice(0, 10),
      paymentMode: row.paymentMode,
      collectedAmountPaise: row.amountPaise.toString(),
      penaltyAllocationPaise: row.penaltyPaidPaise.toString(),
      interestAllocationPaise: row.interestPaidPaise.toString(),
      principalAllocationPaise: row.principalPaidPaise.toString(),
      feeAllocationPaise: row.feesPaidPaise.toString(),
      status: row.status,
      ...(reversalReference ? { reversalReference } : {}),
      // The agent is a colleague, not a customer, so the PII permission does
      // not mask them — see the same note on the overdue report.
      ...(row.isFieldCollection && row.collectorUser
        ? { fieldAgentName: row.collectorUser.name }
        : {}),
    };
  }
}

const COLLECTION_REPORT_INCLUDE = {
  loan: { select: { loanNumber: true } },
  customer: { select: { fullName: true } },
  branch: { select: { name: true } },
  collectorUser: { select: { name: true } },
  reversalOf: { select: { receiptNumber: true } },
  // `reversedByCollection`, not `reversedBy`: the latter is a UUID column
  // holding the user who performed the reversal, while the relation to the
  // reversing collection carries a different name. Naming the scalar in an
  // `include` is rejected by Prisma at query time, which surfaces through the
  // exception filter as an opaque 503 rather than as anything that names the
  // real mistake.
  reversedByCollection: { select: { receiptNumber: true } },
} as const;

/** A collection as this report loads it. Hand-written so specs need no database. */
interface CollectionReportRecord {
  collectionId: string;
  receiptNumber: string | null;
  loanId: string;
  branchId: string;
  collectionDate: Date;
  paymentMode: string;
  amountPaise: bigint;
  penaltyPaidPaise: bigint;
  interestPaidPaise: bigint;
  principalPaidPaise: bigint;
  feesPaidPaise: bigint;
  status: string;
  isFieldCollection: boolean;
  loan: { loanNumber: string };
  customer: { fullName: string };
  branch: { name: string } | null;
  collectorUser: { name: string } | null;
  reversalOf: { receiptNumber: string | null } | null;
  reversedByCollection: { receiptNumber: string | null } | null;
}
