import { Injectable } from '@nestjs/common';
import { todayInKolkata } from '@lms/emi';
import type {
  CollectionKpis,
  DelinquencyKpis,
  PortfolioKpis,
  RecoveryKpis,
} from '@lms/types';

import { PrismaService } from '../../prisma/prisma.service';
import {
  OVERDUE_ELIGIBLE_LOAN_STATUSES,
  OVERDUE_LOAN_INCLUDE,
  OverdueService,
} from '../../recovery/overdue/overdue.service';

/**
 * The KPI arithmetic behind every summary screen.
 *
 * # Why this is a provider and not a private method
 *
 * These three computations were `DashboardService`'s own until Module 18 needed
 * the same figures for the operational home screen. Two dashboards computing
 * "total outstanding" from two pieces of code is the drift Rule 1 exists to
 * prevent: a number on the home screen that disagrees with the report a user
 * drills into is worse than no number at all, and nothing would have caught it.
 *
 * So the arithmetic moved here and both callers read it. This provider is the
 * single narrow thing `ReportsModule` exports, and the distinction that makes
 * that safe is that a *computation* is not a *report*: there is no scope
 * resolution here, no permission check, no audit row and no response envelope.
 * Callers bring their own — which is what lets Module 18 fetch one group at a
 * time for independent widget failure, where `DashboardService.run` is
 * necessarily all-or-nothing.
 *
 * # Every KPI is defined by an existing helper, not by new arithmetic
 *
 * The specification leaves the exact formula for most of these open. Rather
 * than invent one, each figure is computed the way the owning module already
 * computes it: outstanding from the active schedule, delinquency from
 * `summarizeOverdue`, buckets from `delinquencyBucket`, NPA eligibility from
 * `classifyNpa`.
 *
 * # Nothing here is cached
 *
 * `positionKpis` pages the whole eligible loan book, because days-past-due and
 * bucket are derived at read time and cannot appear in a SQL `WHERE`. That cost
 * is real and is the first thing to measure if a dashboard becomes slow. It is
 * deliberately not pre-solved: a cache needs a freshness contract, and both
 * callers already carry a field to report staleness from when there is one.
 */
@Injectable()
export class KpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly overdue: OverdueService,
  ) {}

  /**
   * Portfolio and delinquency, from one pass over the loan book.
   *
   * Computed together because they read the same rows: separating them would
   * double the work and, worse, allow the two to be computed at slightly
   * different moments and disagree about a payment that landed in between.
   */
  async positionKpis(scope: {
    orgId: string;
    branchId?: string;
  }): Promise<[PortfolioKpis, DelinquencyKpis]> {
    const today = todayInKolkata();
    const BATCH = 500;

    let outstandingPrincipal = BigInt(0);
    let outstandingTotal = BigInt(0);
    let disbursedAmount = BigInt(0);
    let activeLoans = 0;
    let loansDisbursed = 0;

    let overdueAccounts = 0;
    let overdueAmount = BigInt(0);
    let npaCount = 0;
    let npaOutstanding = BigInt(0);
    let oldestDueDate: string | undefined;
    const buckets = new Map<string, { accounts: number; amount: bigint }>();

    for (let skip = 0; ; skip += BATCH) {
      const batch = await this.prisma.loan.findMany({
        where: { ...scope, status: { in: OVERDUE_ELIGIBLE_LOAN_STATUSES } },
        include: OVERDUE_LOAN_INCLUDE,
        orderBy: { loanNumber: 'asc' },
        skip,
        take: BATCH,
      });
      if (batch.length === 0) break;

      for (const loan of batch) {
        activeLoans += 1;
        if (loan.disbursementDate) {
          loansDisbursed += 1;
          disbursedAmount += loan.principalAmountPaise;
        }

        const schedule = loan.repaymentSchedules.find(
          (row) => row.status === 'ACTIVE',
        );
        for (const emi of schedule?.emis ?? []) {
          const paid = emi.paidAmountPaise;
          const principalPaid =
            paid > emi.interestDuePaise
              ? paid - emi.interestDuePaise
              : BigInt(0);
          const principalOutstanding =
            emi.principalDuePaise > principalPaid
              ? emi.principalDuePaise - principalPaid
              : BigInt(0);

          outstandingPrincipal += principalOutstanding;
          outstandingTotal += emi.outstandingAmountPaise;
        }

        const summary = this.overdue.deriveSummary(loan, today);
        if (summary.daysPastDue > 0) {
          overdueAccounts += 1;
          overdueAmount += BigInt(summary.totalOverduePaise);

          const bucket = buckets.get(summary.bucket) ?? {
            accounts: 0,
            amount: BigInt(0),
          };
          bucket.accounts += 1;
          bucket.amount += BigInt(summary.totalOverduePaise);
          buckets.set(summary.bucket, bucket);

          if (
            summary.oldestDueDate &&
            (!oldestDueDate || summary.oldestDueDate < oldestDueDate)
          ) {
            oldestDueDate = summary.oldestDueDate;
          }

          // Eligibility, not classification — the committed status lives on the
          // recovery case, and a loan with no case has not been classified by
          // anyone. Counting eligibility here is what the KPI is named for:
          // how much of the book *would* classify.
          if (summary.npaEligibility !== 'STANDARD') {
            npaCount += 1;
            npaOutstanding += BigInt(summary.totalOverduePaise);
          }
        }
      }

      if (batch.length < BATCH) break;
    }

    return [
      {
        totalActiveLoans: activeLoans,
        totalOutstandingPrincipalPaise: outstandingPrincipal.toString(),
        totalPortfolioOutstandingPaise: outstandingTotal.toString(),
        loansDisbursed,
        disbursedAmountPaise: disbursedAmount.toString(),
      },
      {
        overdueAccounts,
        overdueAmountPaise: overdueAmount.toString(),
        ...(oldestDueDate ? { oldestDueDate } : {}),
        npaCount,
        npaOutstandingPaise: npaOutstanding.toString(),
        buckets: [...buckets.entries()].map(([bucket, value]) => ({
          bucket,
          accounts: value.accounts,
          amountPaise: value.amount.toString(),
        })),
      },
    ];
  }

  /**
   * Collections over the selected range.
   *
   * `collectionRateBps` is basis points rather than a float, for the reason
   * every ratio in this system is: a percentage stored as a double is a
   * rounding error waiting to be reported as a discrepancy. Received divided by
   * due, times 10,000, in integer arithmetic.
   */
  async collectionKpis(
    scope: { orgId: string; branchId?: string },
    range?: { gte?: Date; lt?: Date },
  ): Promise<CollectionKpis> {
    const [received, due, handovers, reconciled] = await Promise.all([
      this.prisma.collection.aggregate({
        where: {
          ...scope,
          status: 'POSTED',
          ...(range ? { collectionDate: range } : {}),
        },
        _sum: { amountPaise: true },
      }),
      // What was owed in the window, by due date. A different basis from the
      // received figure by necessity — one is when money was owed, the other
      // when it arrived — which is why the two are named separately rather
      // than presented as one "collection performance" number.
      this.prisma.emi.aggregate({
        where: {
          orgId: scope.orgId,
          ...(scope.branchId ? { loan: { branchId: scope.branchId } } : {}),
          ...(range ? { dueDate: range } : {}),
        },
        _sum: { totalDuePaise: true },
      }),
      // Cash an agent has handed over that the branch has not yet taken in.
      // CREATED and SUBMITTED are the two states where custody has left the
      // agent's hands but not yet completed — RECEIVED and RECONCILED are
      // done, CANCELLED and REVERSED never happened.
      this.prisma.cashHandover.aggregate({
        where: {
          ...scope,
          status: { in: ['CREATED', 'SUBMITTED'] },
          ...(range ? { businessDate: range } : {}),
        },
        _sum: { handedOverCashPaise: true },
      }),
      // Counted cash whose reconciliation reached a settled verdict. MATCHED is
      // "counted and agreed"; RESOLVED is "counted, differed, and someone
      // decided who bears it". Both are reconciled; PENDING and
      // DISCREPANCY_PENDING are not.
      this.prisma.cashReconciliation.aggregate({
        where: {
          ...scope,
          status: { in: ['MATCHED', 'RESOLVED'] },
          ...(range ? { businessDate: range } : {}),
        },
        _sum: { actualCashPaise: true },
      }),
    ]);

    const receivedPaise = received._sum.amountPaise ?? BigInt(0);
    const duePaise = due._sum.totalDuePaise ?? BigInt(0);

    return {
      collectionDuePaise: duePaise.toString(),
      collectionReceivedPaise: receivedPaise.toString(),
      collectionRateBps:
        duePaise > BigInt(0)
          ? ((receivedPaise * BigInt(10_000)) / duePaise).toString()
          : '0',
      cashPendingReconciliationPaise: (
        handovers._sum.handedOverCashPaise ?? BigInt(0)
      ).toString(),
      reconciledAmountPaise: (
        reconciled._sum.actualCashPaise ?? BigInt(0)
      ).toString(),
    };
  }

  /**
   * Recovery activity.
   *
   * Promise-to-pay is summed from the *open* cases' most recent promises and is
   * never subtracted from anything — Scenario 23 is explicit that a promise
   * does not reduce an outstanding balance.
   */
  async recoveryKpis(scope: {
    orgId: string;
    branchId?: string;
  }): Promise<RecoveryKpis> {
    const [open, assigned, escalated, recovered, promises] = await Promise.all([
      this.prisma.recoveryCase.count({
        where: { ...scope, status: { not: 'CLOSED' } },
      }),
      this.prisma.recoveryCase.count({
        where: {
          ...scope,
          status: { not: 'CLOSED' },
          assignedAgentId: { not: null },
        },
      }),
      this.prisma.recoveryCase.count({
        where: { ...scope, escalatedAt: { not: null } },
      }),
      this.prisma.recoveryCase.aggregate({
        where: scope,
        _sum: { recoveredAmountPaise: true },
      }),
      this.prisma.recoveryAction.aggregate({
        where: {
          orgId: scope.orgId,
          promiseToPayDate: { not: null },
          recoveryCase: {
            ...(scope.branchId ? { branchId: scope.branchId } : {}),
            status: { not: 'CLOSED' as const },
          },
        },
        _sum: { promiseToPayAmountPaise: true },
      }),
    ]);

    return {
      openCases: open,
      assignedCases: assigned,
      promiseToPayAmountPaise: (
        promises._sum.promiseToPayAmountPaise ?? BigInt(0)
      ).toString(),
      recoveredAmountPaise: (
        recovered._sum.recoveredAmountPaise ?? BigInt(0)
      ).toString(),
      escalatedCases: escalated,
    };
  }
}
