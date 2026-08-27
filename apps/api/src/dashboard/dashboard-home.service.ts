import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type {
  DashboardLayout,
  DashboardScope,
  DashboardWidget,
  DashboardWidgetMeta,
} from '@lms/types';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { resolveBranchScope } from '../reports/report-scope';
import { visibleQuickActions } from './quick-actions';
import {
  buildWidgetMeta,
  businessDate,
  dayRange,
  periodRange,
  resolveDashboardPeriod,
  type ResolvedPeriod,
} from './widget-meta';
import {
  findWidget,
  holdsAll,
  visibleWidgets,
  type WidgetSpec,
} from './widget-registry';
import { CashSummaryService } from './widgets/cash-summary.service';
import { CollectionSummaryService } from './widgets/collection-summary.service';
import type { WidgetScope } from './widgets/loan-summary.service';
import { LoanSummaryService } from './widgets/loan-summary.service';
import { OperationalAlertsService } from './widgets/operational-alerts.service';
import { OverdueSummaryService } from './widgets/overdue-summary.service';
import { RecentActivityService } from './widgets/recent-activity.service';

export interface WidgetQuery {
  periodType?: string;
  fromDate?: string;
  toDate?: string;
  branchId?: string;
}

/**
 * The home screen (Scenarios 1-3, 33-38, 45-47).
 *
 * # One widget at a time, on purpose
 *
 * `widget()` serves exactly one widget. That is what makes Rule 33 real: a
 * failing cash query returns a failed cash panel and leaves the loan summary
 * untouched, and Scenario 37's Retry reloads one panel rather than the page.
 * A single endpoint returning all seven could satisfy neither.
 *
 * # A failure carries no value
 *
 * `DashboardWidget<T>` attaches `data` to the `AVAILABLE` and `STALE` arms and
 * to no others, so a `FAILED` widget has no field a renderer could read a zero
 * from. Scenario 36 is enforced by the shape rather than by remembering to
 * check a status, which is the whole reason the union is written that way.
 *
 * `NO_DATA` is kept distinct from both. Scenario 35 makes an empty result a
 * valid state, and collapsing it into either neighbour would make a new branch
 * look broken or a broken query look like a new branch.
 *
 * # Authorization happens twice, and neither is redundant
 *
 * `dashboard.view` is checked by the guard, on the controller. The widget's own
 * permissions are checked here, because the guard cannot know which widget was
 * asked for. The layout's widget list is a *convenience* — it says what to
 * offer — and is never trusted: guessing a widget code the layout omitted
 * reaches this check and is refused (Scenario 9).
 */
@Injectable()
export class DashboardHomeService {
  private readonly logger = new Logger(DashboardHomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly loans: LoanSummaryService,
    private readonly collections: CollectionSummaryService,
    private readonly overdue: OverdueSummaryService,
    private readonly cash: CashSummaryService,
    private readonly alerts: OperationalAlertsService,
    private readonly activity: RecentActivityService,
  ) {}

  /**
   * What this caller may see, and where they may look.
   *
   * Resolved in one request so the page knows which widgets to fetch without
   * first attempting the ones it may not have — seven refusals on every load
   * would bury the real denials in the audit trail.
   */
  async layout(
    actor: AuthContext,
    requestedBranchId: string | undefined,
    meta: RequestMeta,
  ): Promise<DashboardLayout> {
    const scope = await this.resolveScope(actor, requestedBranchId, meta);

    const branches = await this.prisma.branch.findMany({
      where: {
        orgId: actor.orgId,
        // A branch-confined caller gets exactly their own. An org-level caller
        // gets every branch, including inactive ones: Scenario 39 keeps
        // historical data viewable, and a branch closed last month still has a
        // portfolio someone must be able to look at.
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
      },
      select: { branchId: true, name: true },
      orderBy: { name: 'asc' },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.DASHBOARD_VIEWED,
      entityType: 'DASHBOARD',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        branchId: scope.branchId,
        actorBranchId: actor.branchId,
        businessDate: scope.businessDate,
      },
    });

    return {
      scope,
      availableBranches: branches,
      widgets: visibleWidgets(actor).map((spec) => ({
        widgetCode: spec.code,
        title: spec.title,
        scopeType: spec.scopeType,
        periodApplied: spec.scopeType === 'RANGE_BOUNDED',
        periodNote: spec.periodNote,
        source: spec.source,
        drillDownHref: spec.drillDownHref,
      })),
      quickActions: visibleQuickActions(actor).map((action) => ({
        code: action.code,
        label: action.label,
        href: action.href,
      })),
    };
  }

  /**
   * One widget's data.
   *
   * Refusals — a missing permission, an unreachable branch — propagate as
   * `ForbiddenException` so the caller gets a 403 and the audit trail gets a
   * denial. Everything else becomes a `FAILED` envelope: a database that is
   * briefly unavailable is not an authorization event, and turning it into one
   * would make the denial log useless.
   */
  async widget(
    actor: AuthContext,
    widgetCode: string,
    query: WidgetQuery,
    meta: RequestMeta,
  ): Promise<DashboardWidget<unknown>> {
    const spec = findWidget(widgetCode);
    if (!spec) {
      // Thrown, not returned as a failed widget: an unknown code is a bad
      // request, and dressing it as a widget failure would suggest a real
      // widget is broken.
      throw new ForbiddenException('Unknown dashboard widget');
    }

    if (!holdsAll(actor, spec.permissions)) {
      await this.recordDenial(
        actor,
        meta,
        AuditAction.DASHBOARD_WIDGET_DENIED,
        {
          widgetCode: spec.code,
          requiredPermissions: [...spec.permissions],
          missingPermissions: spec.permissions.filter(
            (code) => !actor.permissions.includes(code),
          ),
        },
      );
      throw new ForbiddenException(
        'You are not authorized to view that widget',
      );
    }

    const dashboardScope = await this.resolveScope(actor, query.branchId, meta);
    const period = resolveDashboardPeriod(query, dashboardScope.businessDate);
    const widgetMeta = buildWidgetMeta(spec, dashboardScope, period);
    const scope: WidgetScope = {
      orgId: actor.orgId,
      ...(dashboardScope.branchId ? { branchId: dashboardScope.branchId } : {}),
    };

    try {
      const result = await this.load(actor, spec, scope, period, widgetMeta);

      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.DASHBOARD_WIDGET_VIEWED,
        entityType: 'DASHBOARD',
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          widgetCode: spec.code,
          branchId: dashboardScope.branchId,
          periodType: period.periodType,
          status: result.status,
        },
      });

      return result;
    } catch (error) {
      // A refusal decided deeper down keeps its meaning. Only genuine faults
      // become a failed widget.
      if (error instanceof ForbiddenException) throw error;

      this.logger.error(
        `Dashboard widget ${spec.code} failed: ${String(error)}`,
      );

      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.DASHBOARD_WIDGET_FAILED,
        entityType: 'DASHBOARD',
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          widgetCode: spec.code,
          branchId: dashboardScope.branchId,
        },
      });

      return {
        status: 'FAILED',
        meta: { ...widgetMeta, freshness: 'UNAVAILABLE' },
        errorCode: 'WIDGET_SOURCE_UNAVAILABLE',
        message: 'This widget could not be loaded.',
        // The caller may retry: the permission checks already passed, so a
        // second attempt is not going to be refused for a different reason.
        retryable: true,
      };
    }
  }

  /** Dispatch to the owning service and decide the envelope's status. */
  private async load(
    actor: AuthContext,
    spec: WidgetSpec,
    scope: WidgetScope,
    period: ResolvedPeriod,
    meta: DashboardWidgetMeta,
  ): Promise<DashboardWidget<unknown>> {
    switch (spec.code) {
      case 'LOAN_SUMMARY': {
        const data = await this.loans.run(scope);
        // No applications and no loans at all: a genuinely empty scope, not a
        // portfolio that happens to sum to zero.
        const empty =
          data.totalApplications === 0 &&
          data.activeLoans === 0 &&
          data.closedLoans === 0;
        return this.envelope(meta, data, empty, 'No loans in this scope yet.');
      }

      case 'COLLECTION_SUMMARY': {
        const data = await this.collections.run(scope, periodRange(period));
        // Nothing was owed and nothing arrived. A rate of zero against a real
        // amount due is a performance figure, and must not read as "no data".
        const empty = data.duePaise === '0' && data.collectedPaise === '0';
        return this.envelope(
          meta,
          data,
          empty,
          'Nothing was due or collected in this period.',
        );
      }

      case 'OVERDUE_RECOVERY': {
        const data = await this.overdue.run(actor, scope);
        // Deliberately never empty: a portfolio with no overdue accounts is
        // the best possible state, and reporting it as "no data" would hide
        // the good news behind an empty panel.
        return this.envelope(meta, data, false, '');
      }

      case 'CASH_SUMMARY': {
        const data = await this.cash.run(
          scope,
          dayRange(meta.scope.businessDate),
        );
        // No cash moved and none was counted. Distinct from a counted zero,
        // which `actualCashPaise: '0'` would report.
        const empty =
          data.cashInPaise === '0' &&
          data.cashOutPaise === '0' &&
          data.actualCashPaise === null;
        return this.envelope(
          meta,
          data,
          empty,
          'No cash movement recorded for this business date.',
        );
      }

      case 'OPERATIONAL_ALERTS': {
        const { alerts, droppedTypes } = await this.alerts.run(
          actor,
          scope,
          dayRange(meta.scope.businessDate),
        );

        if (droppedTypes.length > 0) {
          // Some sources answered and some did not. Neither AVAILABLE nor
          // FAILED is honest: the list is real but incomplete, and a reader
          // must be told which part is missing.
          return {
            status: 'STALE',
            meta: { ...meta, freshness: 'STALE' },
            data: { alerts },
            staleReason: `Could not check: ${droppedTypes.join(', ')}.`,
          };
        }

        return this.envelope(
          meta,
          { alerts },
          alerts.length === 0,
          'Nothing needs attention right now.',
        );
      }

      case 'QUICK_ACTIONS': {
        const actions = visibleQuickActions(actor).map((action) => ({
          code: action.code,
          label: action.label,
          href: action.href,
        }));
        return this.envelope(
          meta,
          { actions },
          actions.length === 0,
          'No quick actions are available to you.',
        );
      }

      case 'RECENT_ACTIVITY': {
        const data = await this.activity.run(actor, period);
        return this.envelope(
          meta,
          data,
          data.items.length === 0,
          'No recorded activity in this period.',
        );
      }

      default: {
        // Unreachable while the registry and this switch agree — `spec.code`
        // narrows to `never` here, so adding a widget code without a case
        // below is a compile error rather than a silent empty panel. The cast
        // exists only to name the offender if one ever slips through at
        // runtime; it is thrown so the caller reports a failed widget rather
        // than a successful one holding nothing.
        const unhandled: never = spec.code;
        throw new Error(`No loader defined for widget ${String(unhandled)}`);
      }
    }
  }

  /** `NO_DATA` when the scope is genuinely empty, `AVAILABLE` otherwise. */
  private envelope<T>(
    meta: DashboardWidgetMeta,
    data: T,
    empty: boolean,
    message: string,
  ): DashboardWidget<T> {
    return empty
      ? { status: 'NO_DATA', meta, message }
      : { status: 'AVAILABLE', meta, data };
  }

  /**
   * The organization and branch this request is answered for.
   *
   * `resolveBranchScope` narrows and never widens: a branch-confined caller
   * naming another branch is refused rather than quietly given their own, so a
   * resolved value is always one the caller was entitled to (Scenario 7).
   */
  private async resolveScope(
    actor: AuthContext,
    requestedBranchId: string | undefined,
    meta: RequestMeta,
  ): Promise<DashboardScope> {
    let branchId: string | null;
    try {
      branchId = resolveBranchScope(actor, requestedBranchId);
    } catch (error) {
      await this.recordDenial(actor, meta, AuditAction.DASHBOARD_SCOPE_DENIED, {
        requestedBranchId,
        actorBranchId: actor.branchId,
      });
      throw error;
    }

    const branch = branchId
      ? await this.prisma.branch.findFirst({
          where: { orgId: actor.orgId, branchId },
          select: { name: true },
        })
      : null;

    return {
      branchId,
      ...(branch ? { branchName: branch.name } : {}),
      branchLocked: actor.branchId !== null,
      businessDate: businessDate(),
    };
  }

  /**
   * Record a refusal.
   *
   * Wrapped so that a failing audit write cannot turn a denial into an allow —
   * the caller throws regardless, exactly as `PermissionsGuard` does.
   */
  private async recordDenial(
    actor: AuthContext,
    meta: RequestMeta,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.record({
        orgId: actor.orgId,
        action,
        entityType: 'DASHBOARD',
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata,
      });
    } catch (error) {
      this.logger.error(`Could not audit ${action}: ${String(error)}`);
    }
  }
}
