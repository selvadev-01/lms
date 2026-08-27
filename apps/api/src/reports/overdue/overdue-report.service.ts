import { Injectable } from '@nestjs/common';
import { todayInKolkata } from '@lms/emi';
import type { OverdueReport, OverdueReportRow } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OVERDUE_ELIGIBLE_LOAN_STATUSES,
  OVERDUE_LOAN_INCLUDE,
  OverdueService,
} from '../../recovery/overdue/overdue.service';
import type { ReportQueryDto } from '../dto/reports.dto';
import { resolveDateBasis } from '../report-date-basis';
import {
  assertDateRange,
  buildMeta,
  canSeePii,
  civilToDate,
  civilToExclusiveEnd,
  maskName,
  resolveBranchScope,
} from '../report-scope';

export const REPORTS_OVERDUE_VIEW_PERMISSION = 'reports.overdue.view';

/**
 * The Overdue & Recovery report (Scenarios 20-23).
 *
 * # It derives nothing of its own
 *
 * Every figure on every row comes from `OverdueService.deriveSummary`, the same
 * method the Module 13 screen calls. That is Rules 13 and 14 made structural:
 * a report that classified a loan's NPA status or computed its own days-past-due
 * would be a second source of truth, and the failure mode of a second source of
 * truth is that it disagrees with the screen the collections officer is looking
 * at while they are on the phone to the borrower.
 *
 * Scenario 21 says it directly — the report displays the canonical NPA status
 * and does not independently classify a loan using report-only logic. The way
 * to guarantee that is to have no classification logic here at all.
 *
 * # Why the SQL narrowing is loose
 *
 * `Emi.status` is derived at read time, not swept by a job: a row can still say
 * PENDING while its due date has passed. So the query narrows on the two facts
 * that *are* stored — a due date in the past and an outstanding balance — and
 * the derivation decides. A tighter predicate would silently drop overdue
 * borrowers; a looser one only costs a row that derives to zero and is filtered
 * out afterwards. This mirrors `OverdueService.list` exactly.
 *
 * # Promise-to-pay does not reduce anything
 *
 * Scenario 23: a promise is a recorded intention, and the outstanding balance
 * is unchanged by it. The promise columns are read from the recovery case and
 * displayed beside the overdue figures, never subtracted from them.
 */
@Injectable()
export class OverdueReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly overdue: OverdueService,
    private readonly audit: AuditService,
  ) {}

  async run(
    actor: AuthContext,
    query: ReportQueryDto,
    meta: RequestMeta,
  ): Promise<OverdueReport> {
    const branchId = resolveBranchScope(actor, query.branchId);
    const dateBasis = resolveDateBasis('OVERDUE_RECOVERY', query.dateBasis);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const piiAllowed = canSeePii(actor);

    // The range is optional on this report: "everything currently overdue" is
    // the question it is usually asked, and forcing a range would make the
    // default answer arbitrary. When one is given it bounds the oldest unpaid
    // due date, which is the basis this category declares.
    if (query.fromDate && query.toDate) {
      assertDateRange(query.fromDate, query.toDate);
    }

    const today = todayInKolkata();

    const loans = await this.prisma.loan.findMany({
      where: {
        orgId: actor.orgId,
        ...(branchId ? { branchId } : {}),
        status: { in: OVERDUE_ELIGIBLE_LOAN_STATUSES },
        ...(query.search
          ? {
              OR: [
                { loanNumber: { contains: query.search, mode: 'insensitive' } },
                {
                  customer: {
                    fullName: { contains: query.search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
        emis: {
          some: {
            dueDate: {
              lt: civilToDate(this.formatCivil(today)),
              ...(query.fromDate ? { gte: civilToDate(query.fromDate) } : {}),
              ...(query.toDate
                ? { lt: civilToExclusiveEnd(query.toDate) }
                : {}),
            },
            outstandingAmountPaise: { gt: 0 },
            status: { notIn: ['PAID', 'WAIVED', 'CANCELLED'] },
          },
        },
      },
      include: OVERDUE_REPORT_LOAN_INCLUDE,
      orderBy: { loanNumber: 'asc' },
    });

    const rows = loans
      .map((loan) => this.toRow(loan, today, piiAllowed))
      // A loan can pass the SQL narrowing and still derive to nothing overdue.
      // Dropping those here keeps the report honest, the same way the Module 13
      // list does.
      .filter((row) => row.daysPastDue > 0);

    const totals = rows.reduce(
      (acc, row) => ({
        overduePrincipalPaise:
          acc.overduePrincipalPaise + BigInt(row.overduePrincipalPaise),
        overdueInterestPaise:
          acc.overdueInterestPaise + BigInt(row.overdueInterestPaise),
        overduePenaltyPaise:
          acc.overduePenaltyPaise + BigInt(row.overduePenaltyPaise),
        overdueFeesPaise: acc.overdueFeesPaise + BigInt(row.overdueFeesPaise),
        totalOverduePaise:
          acc.totalOverduePaise + BigInt(row.totalOverduePaise),
      }),
      {
        overduePrincipalPaise: BigInt(0),
        overdueInterestPaise: BigInt(0),
        overduePenaltyPaise: BigInt(0),
        overdueFeesPaise: BigInt(0),
        totalOverduePaise: BigInt(0),
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
        category: 'OVERDUE_RECOVERY',
        dateBasis,
        branchId,
        actorBranchId: actor.branchId,
        rowCount: rows.length,
        piiMasked: !piiAllowed,
      },
    });

    return {
      meta: buildMeta({
        category: 'OVERDUE_RECOVERY',
        dateBasis,
        fromDate: query.fromDate ?? '',
        toDate: query.toDate ?? '',
        branchId,
        piiMasked: !piiAllowed,
      }),
      // Sliced after the derivation, because the derivation is what decides
      // whether a row belongs at all — paginating first would leave short pages.
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
      totals: {
        overduePrincipalPaise: totals.overduePrincipalPaise.toString(),
        overdueInterestPaise: totals.overdueInterestPaise.toString(),
        overduePenaltyPaise: totals.overduePenaltyPaise.toString(),
        overdueFeesPaise: totals.overdueFeesPaise.toString(),
        totalOverduePaise: totals.totalOverduePaise.toString(),
        accounts: rows.length,
      },
    };
  }

  /**
   * One report row.
   *
   * The overdue half is `deriveSummary` verbatim; the recovery half is read
   * from the open case. `npaStatus` prefers the case's *committed*
   * classification over the derived eligibility, because Rule 29 makes NPA an
   * authorized decision rather than an arithmetic result — showing the
   * eligibility as though it were the classification would report a decision
   * nobody made.
   */
  private toRow(
    loan: OverdueReportLoan,
    today: Parameters<OverdueService['deriveSummary']>[1],
    piiAllowed: boolean,
  ): OverdueReportRow {
    const summary = this.overdue.deriveSummary(loan, today);
    const openCase = loan.recoveryCases.find((row) => row.status !== 'CLOSED');
    const promise = openCase?.actions[0];

    return {
      loanId: summary.loanId,
      loanNumber: summary.loanNumber,
      customerName: maskName(summary.customerName, piiAllowed),
      branchId: summary.branchId,
      branchName: summary.branchName ?? '',
      ...(summary.oldestDueDate
        ? { oldestUnpaidDueDate: summary.oldestDueDate }
        : {}),
      daysPastDue: summary.daysPastDue,
      overduePrincipalPaise: summary.overduePrincipalPaise,
      overdueInterestPaise: summary.overdueInterestPaise,
      overduePenaltyPaise: summary.overduePenaltyPaise,
      overdueFeesPaise: summary.overdueFeesPaise,
      totalOverduePaise: summary.totalOverduePaise,
      delinquencyBucket: summary.bucket,
      // The committed classification when a case exists, the derived
      // eligibility only as a fallback for a loan with no case yet.
      npaStatus: openCase?.npaStatus ?? summary.npaEligibility,
      // Not masked: a recovery officer is a colleague, not a customer. The PII
      // permission guards borrower data, and hiding which of your own staff
      // owns a case would make the report unusable for the desk that runs it.
      ...(openCase?.assignedAgent
        ? { recoveryOfficerName: openCase.assignedAgent.name }
        : {}),
      ...(openCase ? { recoveryStatus: openCase.status } : {}),
      ...(promise?.promiseToPayDate
        ? {
            promiseToPayDate: promise.promiseToPayDate
              .toISOString()
              .slice(0, 10),
          }
        : {}),
      ...(promise?.promiseToPayAmountPaise
        ? {
            promiseToPayAmountPaise: promise.promiseToPayAmountPaise.toString(),
          }
        : {}),
    };
  }

  /** A `CivilDate` as `YYYY-MM-DD`, without going through `Date`. */
  private formatCivil(date: {
    year: number;
    month: number;
    day: number;
  }): string {
    const month = String(date.month).padStart(2, '0');
    const day = String(date.day).padStart(2, '0');
    return `${String(date.year).padStart(4, '0')}-${month}-${day}`;
  }
}

/**
 * What the report loads on top of what the overdue derivation needs.
 *
 * `OVERDUE_LOAN_INCLUDE` already selects the customer, branch, active schedule
 * and penalties that `deriveSummary` reads. This widens `recoveryCases` — the
 * one relation both halves want — so the report can show the officer, the
 * committed NPA classification and the most recent promise beside the derived
 * overdue figures.
 *
 * Written out rather than spread-with-override because a spread whose key is
 * then replaced loses Prisma's inference: the generated result type falls back
 * to the bare model and every added field reads as missing.
 */
const OVERDUE_REPORT_LOAN_INCLUDE = {
  ...OVERDUE_LOAN_INCLUDE,
  recoveryCases: {
    select: {
      recoveryCaseId: true,
      status: true,
      npaStatus: true,
      assignedAgentId: true,
      assignedAgent: { select: { name: true } },
      actions: {
        where: { promiseToPayDate: { not: null } },
        orderBy: { actionDate: 'desc' as const },
        take: 1,
        select: {
          promiseToPayDate: true,
          promiseToPayAmountPaise: true,
        },
      },
    },
  },
} as const;

/**
 * A loan as this report loads it.
 *
 * Hand-written rather than derived from the Prisma payload type, matching the
 * convention every mapper in this codebase follows: a spec can build one of
 * these without a database, which is what makes the scope and derivation tests
 * possible as unit tests.
 */
type OverdueLoanForDerivation = Parameters<OverdueService['deriveSummary']>[0];

type OverdueReportLoan = Omit<OverdueLoanForDerivation, 'recoveryCases'> & {
  // Each case keeps the exact `status` union the derivation expects — widening
  // it to `string` would make this type unassignable to `OverdueLoan`, and the
  // whole point is that the same row satisfies both.
  recoveryCases: (OverdueLoanForDerivation['recoveryCases'][number] & {
    npaStatus: string;
    assignedAgentId: string | null;
    assignedAgent: { name: string } | null;
    actions: {
      promiseToPayDate: Date | null;
      promiseToPayAmountPaise: bigint | null;
    }[];
  })[];
};
