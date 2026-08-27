import { Injectable } from '@nestjs/common';
import type { ReportDashboard } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { DashboardQueryDto } from '../dto/reports.dto';
import { KpiService } from '../kpi/kpi.service';
import { resolveDateBasis } from '../report-date-basis';
import {
  assertDateRange,
  buildMeta,
  canSeePii,
  civilToDate,
  civilToExclusiveEnd,
  resolveBranchScope,
} from '../report-scope';

export const REPORTS_DASHBOARD_VIEW_PERMISSION = 'reports.dashboard.view';

/**
 * The reporting dashboard (Scenarios 1-4).
 *
 * # Every KPI is defined by an existing helper, not by new arithmetic
 *
 * The specification leaves the exact formula for most of these open
 * (Questions 4 and 5). Rather than invent one, each figure is computed the way
 * the owning module already computes it: outstanding from the active schedule,
 * delinquency from `summarizeOverdue`, buckets from `delinquencyBucket`, NPA
 * eligibility from `classifyNpa`. A dashboard number that disagreed with the
 * screen a user drills into would fail Scenario 3, which requires the detail to
 * reconcile to the KPI definition.
 *
 * That arithmetic now lives in `KpiService` rather than here, because Module
 * 18's home screen needs the same figures. This service is what remains once
 * the computation is taken out: scope resolution, the date basis, one audit row
 * and the response envelope. The numbers themselves are no longer this file's
 * to define, which is precisely what stops the two dashboards from drifting.
 *
 * # Two different date bases, kept apart
 *
 * The portfolio and delinquency groups are *as-of-now positions*: what is
 * outstanding, what is overdue, today. The collection group is *range-bounded*:
 * what was due and received between two dates. Rule 11 forbids mixing bases
 * silently, so they are separate objects in the response and `meta.dateBasis`
 * names the one the range applied to. Flattening all twenty figures into one
 * object would make it impossible for a reader to tell which is which.
 *
 * # Freshness is real
 *
 * Nothing is cached. `meta.dataFreshAt` is the moment the queries ran, which
 * satisfies Rule 36 and Scenario 4 honestly rather than by omitting the
 * indicator. If a cache is added later, that field is already the place its
 * staleness gets reported.
 *
 * // TODO(open-question): Questions 4, 5 and 47 — the canonical KPI list, the
 * // formula for each, and the acceptable staleness for a cached dashboard are
 * // unresolved. The formulas used here are the owning modules' own; the cache
 * // does not exist.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly kpi: KpiService,
    private readonly audit: AuditService,
  ) {}

  async run(
    actor: AuthContext,
    query: DashboardQueryDto,
    meta: RequestMeta,
  ): Promise<ReportDashboard> {
    const branchId = resolveBranchScope(actor, query.branchId);
    const dateBasis = resolveDateBasis('DASHBOARD', query.dateBasis);

    if (query.fromDate && query.toDate) {
      assertDateRange(query.fromDate, query.toDate);
    }

    const scope = { orgId: actor.orgId, ...(branchId ? { branchId } : {}) };
    const range = {
      ...(query.fromDate ? { gte: civilToDate(query.fromDate) } : {}),
      ...(query.toDate ? { lt: civilToExclusiveEnd(query.toDate) } : {}),
    };
    const dated = Boolean(query.fromDate || query.toDate);

    const [portfolio, delinquency] = await this.kpi.positionKpis(scope);
    const [collections, recovery] = await Promise.all([
      this.kpi.collectionKpis(scope, dated ? range : undefined),
      this.kpi.recoveryKpis(scope),
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
        category: 'DASHBOARD',
        dateBasis,
        branchId,
        actorBranchId: actor.branchId,
      },
    });

    return {
      meta: buildMeta({
        category: 'DASHBOARD',
        dateBasis,
        fromDate: query.fromDate ?? '',
        toDate: query.toDate ?? '',
        branchId,
        // The dashboard shows no customer-level rows, so there is nothing to
        // mask. Drilling into a KPI reaches a report that masks properly.
        piiMasked: !canSeePii(actor),
      }),
      portfolio,
      collections,
      delinquency,
      recovery,
    };
  }
}
