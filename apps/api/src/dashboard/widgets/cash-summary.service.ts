import { Injectable } from '@nestjs/common';
import type { CashSummaryWidget } from '@lms/types';

import { PrismaService } from '../../prisma/prisma.service';
import type { PeriodRange } from '../widget-meta';
import type { WidgetScope } from './loan-summary.service';

/**
 * Handovers where custody has left the agent but has not completed.
 *
 * The same two states `KpiService.collectionKpis` treats as pending: `RECEIVED`
 * and `RECONCILED` are done, `CANCELLED` and `REVERSED` never happened.
 */
const IN_FLIGHT_HANDOVER_STATUSES = ['CREATED', 'SUBMITTED'] as const;

/** Reconciliations that reached a settled verdict. */
const SETTLED_RECONCILIATION_STATUSES = ['MATCHED', 'RESOLVED'] as const;

/**
 * The branch cash position for the business date (Scenarios 21-24).
 *
 * # Why this reads handovers and reconciliations, and not a cash book
 *
 * The schema carries a `cash_book_entries` table with a tidy
 * `RECEIPT`/`PAYMENT`/`TRANSFER_IN`/`TRANSFER_OUT` enum, and it is the obvious
 * place to compute Cash In and Cash Out from. It is also **vestigial**: it
 * comes from the initial schema migration and nothing in the system has ever
 * written a row to it. A widget sourced from it would return zeroes forever,
 * indistinguishable from a branch that genuinely moved no cash — precisely the
 * false zero Rule 35 forbids, and undetectable in a test that seeds no cash.
 *
 * Actual branch cash lives in Module 12: an agent collects, hands over, and the
 * branch counts and reconciles. So Cash In is what agents handed over and Cash
 * Out is what the branch has taken in and settled, both for the business date.
 *
 * # The business date, not the selected period
 *
 * Cash is counted and handed over per day. Summing a week of handovers would
 * add custody positions that never coexisted — money handed over on Monday and
 * banked on Tuesday is not twice as much money. The widget is `AS_OF_NOW` and
 * says so in its caption.
 *
 * # It maintains no balance of its own
 *
 * Rule 23 and Scenario 23. Every figure is an aggregate over authoritative
 * rows, computed at read time. There is no stored dashboard balance to drift,
 * and no write path here that could adjust one. A correction happens in the
 * reconciliation workflow and appears here on the next load.
 *
 * // TODO(open-question): Questions 14-15 — which cash metrics Branch Admins
 * // see versus accountants, and whether Cash Difference is always shown or
 * // only on an exception, are unresolved. One `cash.reconciliation.view` gate
 * // is applied and the difference is always shown: hiding it when it is zero
 * // would make its absence ambiguous between "reconciled" and "not counted".
 */
@Injectable()
export class CashSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async run(scope: WidgetScope, day: PeriodRange): Promise<CashSummaryWidget> {
    const [inFlight, settled, reconciliations, dayClosing] = await Promise.all([
      this.prisma.cashHandover.aggregate({
        where: {
          ...scope,
          status: { in: [...IN_FLIGHT_HANDOVER_STATUSES] },
          businessDate: day,
        },
        _sum: { handedOverCashPaise: true },
      }),
      this.prisma.cashHandover.aggregate({
        where: {
          ...scope,
          status: { in: ['RECEIVED', 'RECONCILED'] },
          businessDate: day,
        },
        _sum: { receivedCashPaise: true },
      }),
      this.prisma.cashReconciliation.aggregate({
        where: {
          ...scope,
          status: { in: [...SETTLED_RECONCILIATION_STATUSES] },
          businessDate: day,
        },
        _sum: {
          expectedCashPaise: true,
          actualCashPaise: true,
          differencePaise: true,
        },
        _count: { _all: true },
      }),
      // Whether the branch has closed the day at all. A single branch has one
      // row; an org-wide caller has many, so the status is reported only when
      // the scope names exactly one branch and there is therefore one answer.
      scope.branchId
        ? this.prisma.dayClosing.findFirst({
            where: { ...scope, closingDate: day },
            select: { status: true },
          })
        : Promise.resolve(null),
    ]);

    const cashIn = inFlight._sum.handedOverCashPaise ?? BigInt(0);
    const cashOut = settled._sum.receivedCashPaise ?? BigInt(0);
    const counted = reconciliations._count._all > 0;

    return {
      cashInPaise: cashIn.toString(),
      cashOutPaise: cashOut.toString(),
      // What the branch should be holding: handed over and not yet settled.
      expectedClosingPaise: (
        reconciliations._sum.expectedCashPaise ?? BigInt(0)
      ).toString(),
      // Null until someone has physically counted. Zero would claim an empty
      // cash box; null says nobody has looked.
      actualCashPaise: counted
        ? (reconciliations._sum.actualCashPaise ?? BigInt(0)).toString()
        : null,
      differencePaise: counted
        ? (reconciliations._sum.differencePaise ?? BigInt(0)).toString()
        : null,
      reconciliationStatus: counted ? 'RECONCILED' : null,
      dayClosingStatus: dayClosing?.status ?? null,
    };
  }
}
