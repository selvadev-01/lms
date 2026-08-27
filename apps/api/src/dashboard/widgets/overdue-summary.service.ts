import { Injectable } from '@nestjs/common';
import type { OverdueRecoveryWidget } from '@lms/types';

import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { KpiService } from '../../reports/kpi/kpi.service';
import type { WidgetScope } from './loan-summary.service';

/**
 * Either of these lets a user work legal and settlement cases, so either is
 * enough to be shown how many there are.
 */
const LEGAL_PERMISSIONS = [
  'recovery.notices.issue',
  'recovery.settlements.propose',
];

/** Penalty states where money is still owed. */
const PENALTY_OUTSTANDING_STATUSES = ['ASSESSED', 'PARTIALLY_PAID'] as const;

/** Cases sitting with a branch manager for a decision. */
const BRANCH_REVIEW_STATUSES = ['BRANCH_REVIEW'] as const;

/** Cases that have reached the legal or settlement track. */
const LEGAL_STATUSES = [
  'LEGAL_NOTICE',
  'SETTLEMENT_PENDING',
  'LEGAL_ACTION',
] as const;

/**
 * Overdue and recovery position (Scenarios 18-20).
 *
 * # Nothing here decides that a loan is overdue
 *
 * Rule 18 is explicit: overdue information is derived from the Overdue &
 * Recovery module and the Dashboard does not independently apply penalties or
 * mark loans overdue. The counts come from `KpiService`, which derives them
 * through `OverdueService.deriveSummary` — the same function the overdue list
 * itself uses, so the drill-down in Scenario 12 cannot disagree with the number
 * that was clicked.
 *
 * # Penalties are read, never applied or waived
 *
 * Rule 19 and Scenario 19. `penaltyOutstandingPaise` sums the outstanding
 * column of penalties already assessed by the recovery workflow. There is no
 * arithmetic here that could assess one, and no write path that could waive it.
 *
 * # A withheld figure is null, not zero
 *
 * `legalCases` is `null` for a caller without a legal permission. Returning `0`
 * would tell an unauthorized reader that there are no legal cases, which is a
 * claim about data they may not see — the inference Scenario 27 forbids.
 */
@Injectable()
export class OverdueSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
  ) {}

  async run(
    actor: AuthContext,
    scope: WidgetScope,
  ): Promise<OverdueRecoveryWidget> {
    const maySeeLegal = LEGAL_PERMISSIONS.some((code) =>
      actor.permissions.includes(code),
    );

    const [[, delinquency], recovery, penalties, branchReview, legal] =
      await Promise.all([
        this.kpi.positionKpis(scope),
        this.kpi.recoveryKpis(scope),
        this.prisma.penalty.aggregate({
          where: {
            orgId: scope.orgId,
            // `Penalty` carries no branchId of its own; it reaches branch
            // through its loan. Naming the column directly would compile and
            // fail at query time as an opaque 503.
            ...(scope.branchId ? { loan: { branchId: scope.branchId } } : {}),
            status: { in: [...PENALTY_OUTSTANDING_STATUSES] },
          },
          _sum: { outstandingAmountPaise: true },
        }),
        this.prisma.recoveryCase.count({
          where: { ...scope, status: { in: [...BRANCH_REVIEW_STATUSES] } },
        }),
        maySeeLegal
          ? this.prisma.recoveryCase.count({
              where: { ...scope, status: { in: [...LEGAL_STATUSES] } },
            })
          : Promise.resolve(null),
      ]);

    return {
      overdueAccounts: delinquency.overdueAccounts,
      overdueAmountPaise: delinquency.overdueAmountPaise,
      penaltyOutstandingPaise: (
        penalties._sum.outstandingAmountPaise ?? BigInt(0)
      ).toString(),
      escalatedToField: recovery.escalatedCases,
      pendingBranchReview: branchReview,
      legalCases: legal,
    };
  }
}
