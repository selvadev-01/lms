import { Injectable } from '@nestjs/common';
import type { LoanSummaryWidget } from '@lms/types';

import { PrismaService } from '../../prisma/prisma.service';
import { KpiService } from '../../reports/kpi/kpi.service';

/** The scope every widget query is bounded by. Never widened, only narrowed. */
export interface WidgetScope {
  orgId: string;
  branchId?: string;
}

/**
 * Applications awaiting a decision.
 *
 * `SUBMITTED` and `UNDER_REVIEW` are the two states where the application is
 * with the organization and someone must act. `DRAFT` is still with whoever is
 * filling it in, and `MORE_INFO_REQUIRED` is waiting on the customer — neither
 * is a queue an approver can work through, so counting them as "pending
 * approval" would overstate the backlog.
 */
const PENDING_APPROVAL_STATUSES = ['SUBMITTED', 'UNDER_REVIEW'] as const;

/**
 * Applications that have been approved and have not yet become a loan.
 *
 * The chain from an approval to money leaving is several steps long
 * (`APPROVED` → `SANCTIONED` → `CUSTOMER_ACCEPTED` → `AGREEMENT_SIGNED` →
 * `DISBURSEMENT_PENDING`), and every one of them is an approved application
 * that has not disbursed. Counting only `APPROVED` would show a number that
 * dropped the moment a sanction letter was issued, which reads as an approval
 * having been lost.
 */
const APPROVED_STATUSES = [
  'APPROVED',
  'SANCTIONED',
  'CUSTOMER_ACCEPTED',
  'AGREEMENT_SIGNED',
  'DISBURSEMENT_PENDING',
] as const;

/**
 * The loan and application position (Scenarios 11-13).
 *
 * # Two tables, because they are two different things
 *
 * An application is a request; a loan is money committed. They have separate
 * lifecycles and separate tables, and the summary counts each from its own —
 * Module 07's `ApplicationStatus` for the first three figures and Module 09's
 * `LoanStatus` for the rest. A single "total" spanning both would be counting
 * requests and commitments together.
 *
 * # The active, outstanding and overdue figures are not computed here
 *
 * They come from `KpiService`, which is the same arithmetic Module 15's report
 * uses. Scenario 12 has the user drill from the overdue count into the overdue
 * list; if this service derived its own count, the two could disagree and the
 * drill-down would appear to have lost rows.
 *
 * # Closed loans are counted, never changed
 *
 * Scenario 13: the Dashboard reads the authoritative closed state and does not
 * independently change a loan's status. There is no write path in this file.
 */
@Injectable()
export class LoanSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
  ) {}

  async run(scope: WidgetScope): Promise<LoanSummaryWidget> {
    const [[portfolio, delinquency], applications, closedLoans] =
      await Promise.all([
        this.kpi.positionKpis(scope),
        // One grouped query rather than three counts: the three figures must
        // describe the same moment, and three round trips could not guarantee
        // that an application did not move between them.
        this.prisma.loanApplication.groupBy({
          by: ['status'],
          where: scope,
          _count: { _all: true },
        }),
        this.prisma.loan.count({ where: { ...scope, status: 'CLOSED' } }),
      ]);

    const countFor = (statuses: readonly string[]): number =>
      applications
        .filter((row) => statuses.includes(row.status))
        .reduce((total, row) => total + row._count._all, 0);

    return {
      totalApplications: applications.reduce(
        (total, row) => total + row._count._all,
        0,
      ),
      pendingApproval: countFor(PENDING_APPROVAL_STATUSES),
      approved: countFor(APPROVED_STATUSES),
      activeLoans: portfolio.totalActiveLoans,
      closedLoans,
      overdueLoans: delinquency.overdueAccounts,
      totalOutstandingPaise: portfolio.totalPortfolioOutstandingPaise,
    };
  }
}
