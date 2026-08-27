import { Injectable } from '@nestjs/common';
import { todayInKolkata } from '@lms/emi';
import type { PortfolioReport, PortfolioReportRow } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
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

export const REPORTS_PORTFOLIO_VIEW_PERMISSION = 'reports.portfolio.view';

/**
 * The Loan Portfolio report (Scenarios 7, 8, 53).
 *
 * # Outstanding is derived, not stored
 *
 * There is no `outstandingPrincipal` column on `Loan`. The figure comes from
 * the active schedule's installments, exactly as Module 10 and Module 13
 * compute it — and the delinquency columns come from
 * `OverdueService.deriveSummary`, so a loan's days-past-due and NPA status on
 * this report and on the recovery screen are the same derivation, not two that
 * happen to agree today (Rules 13, 14).
 *
 * # Inactive references stay reportable
 *
 * Scenario 8: a loan referencing a branch, product or user that is now inactive
 * remains on the report, and the inactive entity is not presented as active
 * current configuration. This is why the query filters on the *loan's* status
 * and never on `branch.status` or `loanProduct.status` — filtering by a
 * referenced entity's current state would silently drop historical loans, which
 * is the failure Scenario 45 describes from the other direction. The row
 * carries the product and branch names as they are, and the screen renders an
 * inactive marker beside them.
 *
 * # Status is the loan's own
 *
 * Scenario 7 asks for authoritative loan status, so it is read from the column
 * rather than inferred from balances. A loan whose EMIs are all settled but
 * whose status still says ACTIVE is a Module 11 closure question, not something
 * a report should quietly correct (Rule 14).
 */
@Injectable()
export class PortfolioReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly overdue: OverdueService,
    private readonly audit: AuditService,
  ) {}

  async run(
    actor: AuthContext,
    query: ReportQueryDto,
    meta: RequestMeta,
  ): Promise<PortfolioReport> {
    const branchId = resolveBranchScope(actor, query.branchId);
    const dateBasis = resolveDateBasis('PORTFOLIO', query.dateBasis);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const piiAllowed = canSeePii(actor);

    if (query.fromDate && query.toDate) {
      assertDateRange(query.fromDate, query.toDate);
    }

    const where = {
      orgId: actor.orgId,
      ...(branchId ? { branchId } : {}),
      // The range bounds the disbursement date, which is this category's
      // declared basis. A loan not yet disbursed has none and is excluded by
      // the filter rather than by a status check.
      ...(query.fromDate || query.toDate
        ? {
            disbursementDate: {
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
                loanNumber: {
                  contains: query.search,
                  mode: 'insensitive' as const,
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

    const [loans, total] = await Promise.all([
      this.prisma.loan.findMany({
        where,
        include: PORTFOLIO_REPORT_INCLUDE,
        orderBy: { loanNumber: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.loan.count({ where }),
    ]);

    const today = todayInKolkata();
    const rows = loans.map((loan) => this.toRow(loan, today, piiAllowed));

    // Totals span the whole filtered set, not the page (Rule 35). Outstanding
    // is derived per loan, so the total is a second pass over the same
    // predicate rather than a SQL aggregate — there is no column to SUM.
    const totals = await this.computeTotals(where, today);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.REPORT_GENERATED,
      entityType: 'REPORT',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        category: 'PORTFOLIO',
        dateBasis,
        branchId,
        actorBranchId: actor.branchId,
        rowCount: total,
        piiMasked: !piiAllowed,
      },
    });

    return {
      meta: buildMeta({
        category: 'PORTFOLIO',
        dateBasis,
        fromDate: query.fromDate ?? '',
        toDate: query.toDate ?? '',
        branchId,
        piiMasked: !piiAllowed,
      }),
      rows,
      total,
      page,
      pageSize,
      totals,
    };
  }

  /**
   * One portfolio row.
   *
   * The overdue half delegates to `deriveSummary`; the outstanding half is
   * summed from the active schedule. Both read the same installments, so a row
   * whose total outstanding is zero cannot show a positive overdue figure.
   */
  private toRow(
    loan: PortfolioLoan,
    today: Parameters<OverdueService['deriveSummary']>[1],
    piiAllowed: boolean,
  ): PortfolioReportRow {
    const summary = this.overdue.deriveSummary(loan, today);
    const outstanding = this.outstandingFor(loan);

    return {
      loanId: loan.loanId,
      loanNumber: loan.loanNumber,
      customerId: loan.customerId,
      customerName: maskName(loan.customer.fullName, piiAllowed),
      branchId: loan.branchId,
      branchName: loan.branch?.name ?? '',
      loanProductName: loan.loanProduct?.name ?? '',
      status: loan.status,
      ...(loan.disbursementDate
        ? { disbursementDate: loan.disbursementDate.toISOString().slice(0, 10) }
        : {}),
      principalDisbursedPaise: loan.principalAmountPaise.toString(),
      outstandingPrincipalPaise: outstanding.principal.toString(),
      outstandingInterestPaise: outstanding.interest.toString(),
      // Penalty and fees outstanding come from the overdue derivation, which
      // already reads the penalty rows — summing them again here would be a
      // second interpretation of the same data.
      outstandingPenaltyPaise: summary.overduePenaltyPaise,
      outstandingFeesPaise: summary.overdueFeesPaise,
      totalOutstandingPaise: (
        outstanding.principal +
        outstanding.interest +
        BigInt(summary.overduePenaltyPaise) +
        BigInt(summary.overdueFeesPaise)
      ).toString(),
      ...(summary.oldestDueDate
        ? { oldestUnpaidDueDate: summary.oldestDueDate }
        : {}),
      daysPastDue: summary.daysPastDue,
      npaStatus: summary.npaEligibility,
    };
  }

  /**
   * Principal and interest still owing on the active schedule.
   *
   * Within an installment a payment settles interest before principal, which is
   * the same appropriation `OverdueService.toObligations` applies. Keeping the
   * two in step matters: if this split disagreed with the overdue split, a
   * loan's outstanding principal and its overdue principal could tell different
   * stories about the same installment.
   */
  private outstandingFor(loan: PortfolioLoan): {
    principal: bigint;
    interest: bigint;
  } {
    const schedule = loan.repaymentSchedules.find(
      (row) => row.status === 'ACTIVE',
    );

    let principal = BigInt(0);
    let interest = BigInt(0);

    for (const emi of schedule?.emis ?? []) {
      const paid = emi.paidAmountPaise;
      const interestOutstanding =
        emi.interestDuePaise > paid ? emi.interestDuePaise - paid : BigInt(0);
      const principalPaid =
        paid > emi.interestDuePaise ? paid - emi.interestDuePaise : BigInt(0);
      const principalOutstanding =
        emi.principalDuePaise > principalPaid
          ? emi.principalDuePaise - principalPaid
          : BigInt(0);

      interest += interestOutstanding;
      principal += principalOutstanding;
    }

    return { principal, interest };
  }

  /**
   * Portfolio totals over the whole filtered set.
   *
   * Loaded in pages rather than all at once: a large organization's portfolio
   * is tens of thousands of loans and each carries its full schedule, so one
   * `findMany` would hold every installment in memory at the same time. The
   * page size here is an internal batching detail and has nothing to do with
   * the caller's `pageSize`.
   */
  private async computeTotals(
    where: object,
    today: Parameters<OverdueService['deriveSummary']>[1],
  ): Promise<Record<string, string | number>> {
    const BATCH = 500;
    let skip = 0;
    let principal = BigInt(0);
    let interest = BigInt(0);
    let disbursed = BigInt(0);
    let count = 0;

    for (;;) {
      const batch = await this.prisma.loan.findMany({
        where,
        include: PORTFOLIO_REPORT_INCLUDE,
        orderBy: { loanNumber: 'asc' },
        skip,
        take: BATCH,
      });
      if (batch.length === 0) break;

      for (const loan of batch) {
        const outstanding = this.outstandingFor(loan);
        principal += outstanding.principal;
        interest += outstanding.interest;
        disbursed += loan.principalAmountPaise;
        count += 1;
      }

      if (batch.length < BATCH) break;
      skip += BATCH;
    }

    // `today` is accepted so the signature matches the derivation the rows use,
    // even though the totals need only the balances. Keeping it makes a future
    // aged total a change of body rather than of shape.
    void today;

    return {
      outstandingPrincipalPaise: principal.toString(),
      outstandingInterestPaise: interest.toString(),
      totalOutstandingPaise: (principal + interest).toString(),
      principalDisbursedPaise: disbursed.toString(),
      loans: count,
    };
  }
}

const PORTFOLIO_REPORT_INCLUDE = {
  ...OVERDUE_LOAN_INCLUDE,
  loanProduct: { select: { name: true, status: true } },
} as const;

type PortfolioLoan = Parameters<OverdueService['deriveSummary']>[0] & {
  customerId: string;
  principalAmountPaise: bigint;
  disbursementDate: Date | null;
  loanProduct: { name: string; status: string } | null;
};
