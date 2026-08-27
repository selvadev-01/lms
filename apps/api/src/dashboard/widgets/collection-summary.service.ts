import { Injectable } from '@nestjs/common';
import type { CollectionSummaryWidget } from '@lms/types';

import { PrismaService } from '../../prisma/prisma.service';
import { KpiService } from '../../reports/kpi/kpi.service';
import type { PeriodRange } from '../widget-meta';
import type { WidgetScope } from './loan-summary.service';

/**
 * Collections over the selected period (Scenarios 14-17).
 *
 * # Only posted money counts
 *
 * Rule 21 and Scenario 15: a pending, failed or rejected attempt is not a
 * collection. `KpiService.collectionKpis` already filters to `POSTED`, and the
 * field figure below repeats that filter rather than inheriting it loosely —
 * `CREATED` and `SYNCED` are collections an agent has recorded but the branch
 * has not posted, and `REVERSED` is money that came back.
 *
 * # The two figures have different date bases, deliberately
 *
 * `duePaise` is filtered by when money was *owed*; `collectedPaise` by when it
 * *arrived*. They are not the same question, and Rule 11 forbids presenting
 * them as though a single filter produced both. `pendingPaise` is the gap
 * between them and is therefore a statement about the period, not about any
 * particular unpaid EMI.
 *
 * // TODO(open-question): Question 10 — the exact definition of Pending
 * // Collection Amount is unresolved. Due-minus-collected within the period is
 * // the reading that reconciles to the two figures shown beside it; a
 * // definition based on outstanding EMI balances would not, because an EMI due
 * // before the period can still be outstanding during it.
 *
 * # The field portion is a subset, not an addition
 *
 * `fieldCollectedPaise` is the part of `collectedPaise` taken in the field.
 * Adding the two would double-count every field collection. It is shown so a
 * branch can see how much of its intake depended on agents being out.
 */
@Injectable()
export class CollectionSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
  ) {}

  async run(
    scope: WidgetScope,
    range: PeriodRange,
  ): Promise<CollectionSummaryWidget> {
    const [kpis, field] = await Promise.all([
      this.kpi.collectionKpis(scope, range),
      this.prisma.collection.aggregate({
        where: {
          ...scope,
          isFieldCollection: true,
          // Repeated rather than assumed: a field collection that was never
          // posted is cash in an agent's hands, not revenue.
          status: 'POSTED',
          collectionDate: range,
        },
        _sum: { amountPaise: true },
      }),
    ]);

    const due = BigInt(kpis.collectionDuePaise);
    const collected = BigInt(kpis.collectionReceivedPaise);

    return {
      duePaise: kpis.collectionDuePaise,
      collectedPaise: kpis.collectionReceivedPaise,
      // Floored at zero: over-collection within a period is normal — arrears
      // from an earlier month arriving in this one — and a negative "pending"
      // would read as the branch being owed money by its borrowers.
      pendingPaise: (due > collected ? due - collected : BigInt(0)).toString(),
      collectionRateBps: kpis.collectionRateBps,
      fieldCollectedPaise: (field._sum.amountPaise ?? BigInt(0)).toString(),
    };
  }
}
