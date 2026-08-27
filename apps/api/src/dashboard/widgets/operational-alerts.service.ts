import { Injectable, Logger } from '@nestjs/common';
import type { DashboardAlert } from '@lms/types';

import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { PeriodRange } from '../widget-meta';
import type { AlertSpec } from '../widget-registry';
import { visibleAlerts } from '../widget-registry';
import type { WidgetScope } from './loan-summary.service';

/**
 * The alerts that resolved, and whether any were lost.
 *
 * `droppedTypes` is what turns a partial failure into a `STALE` widget rather
 * than an `AVAILABLE` one with a quietly shorter list.
 */
export interface AlertsResult {
  alerts: DashboardAlert[];
  droppedTypes: string[];
}

/**
 * Operational alerts (Scenarios 25-28).
 *
 * # Six sources, gathered independently
 *
 * Each alert counts rows in a different module. They are gathered with
 * `Promise.allSettled` rather than `Promise.all` because one unavailable source
 * must not take the panel down — Rule 33 applied one level deeper than the
 * widget boundary.
 *
 * But a dropped alert is *not* silently omitted. Omission is how an
 * unauthorized alert is handled, and if a failed one were treated the same way
 * the two would be indistinguishable: a reader would see six rows where seven
 * were expected and have no way to tell whether the seventh was forbidden or
 * merely broken. So a failure is reported through `droppedTypes`, the widget
 * degrades to `STALE`, and the caption names what is missing (Rules 34-35).
 *
 * # Unauthorized alerts are omitted, never zeroed
 *
 * Scenario 27. A count of `0` for a source the caller may not read is a
 * statement about that source's contents. There is also no total across alerts,
 * so a restricted count cannot be inferred by subtraction.
 *
 * # Alerts have no state
 *
 * There is no acknowledgement, no dismissal, and no `dashboard_alerts` table.
 * An alert is a live count of rows the owning module considers actionable, so
 * Scenario 28 resolves by itself: complete the work in the owning workflow and
 * the count drops on the next load.
 *
 * // TODO(open-question): Questions 20-22 — whether users may dismiss or
 * // acknowledge alerts, whether that affects the underlying workflow, and
 * // which failed jobs belong here are unresolved. Acknowledgement needs a
 * // table to persist in; a dismissal that did not survive a reload would be
 * // worse than none, so none is offered.
 */
@Injectable()
export class OperationalAlertsService {
  private readonly logger = new Logger(OperationalAlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(
    actor: AuthContext,
    scope: WidgetScope,
    today: PeriodRange,
  ): Promise<AlertsResult> {
    const specs = visibleAlerts(actor);

    const settled = await Promise.allSettled(
      specs.map((spec) => this.count(spec, scope, today)),
    );

    const alerts: DashboardAlert[] = [];
    const droppedTypes: string[] = [];

    settled.forEach((outcome, index) => {
      const spec = specs[index];

      if (outcome.status === 'rejected') {
        // Logged, not swallowed: the widget reports it as stale, and the
        // reason belongs somewhere an operator can find it.
        this.logger.error(
          `Dashboard alert ${spec.alertType} failed: ${String(outcome.reason)}`,
        );
        droppedTypes.push(spec.alertType);
        return;
      }

      // A zero-count alert is dropped from the list rather than shown as "0
      // EMIs overdue". An alert is a call to act; there is nothing to act on.
      if (outcome.value.count === 0) return;

      alerts.push(outcome.value);
    });

    return { alerts, droppedTypes };
  }

  private async count(
    spec: AlertSpec,
    scope: WidgetScope,
    today: PeriodRange,
  ): Promise<DashboardAlert> {
    const base = {
      alertType: spec.alertType,
      severity: spec.severity,
      label: spec.label,
      href: spec.href,
    };

    switch (spec.alertType) {
      case 'EMIS_DUE_TODAY': {
        // `Emi` reaches branch through its loan, not a column of its own.
        const result = await this.prisma.emi.aggregate({
          where: {
            orgId: scope.orgId,
            ...(scope.branchId ? { loan: { branchId: scope.branchId } } : {}),
            dueDate: today,
            status: { notIn: ['PAID', 'WAIVED', 'CANCELLED'] },
          },
          _count: { _all: true },
          _sum: { outstandingAmountPaise: true },
        });

        return {
          ...base,
          count: result._count._all,
          amountPaise: (
            result._sum.outstandingAmountPaise ?? BigInt(0)
          ).toString(),
        };
      }

      case 'EMIS_OVERDUE': {
        // Stored facts only. Whether a loan is *derived* overdue is
        // `OverdueService`'s to say; this is the count of installments past
        // their due date with money still on them, which is what an operator
        // is being pointed at.
        const result = await this.prisma.emi.aggregate({
          where: {
            orgId: scope.orgId,
            ...(scope.branchId ? { loan: { branchId: scope.branchId } } : {}),
            dueDate: { lt: today.gte },
            outstandingAmountPaise: { gt: 0 },
            status: { notIn: ['PAID', 'WAIVED', 'CANCELLED'] },
          },
          _count: { _all: true },
          _sum: { outstandingAmountPaise: true },
        });

        return {
          ...base,
          count: result._count._all,
          amountPaise: (
            result._sum.outstandingAmountPaise ?? BigInt(0)
          ).toString(),
        };
      }

      case 'PENDING_APPROVALS':
        return {
          ...base,
          count: await this.prisma.loanApplication.count({
            where: { ...scope, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
          }),
        };

      case 'COLLECTION_EXCEPTIONS':
        return {
          ...base,
          count: await this.prisma.collection.count({
            // `FAILED` could not be posted; `SYNCED` arrived from a device and
            // is waiting for someone to post it. Both need a person.
            where: { ...scope, status: { in: ['FAILED', 'SYNCED'] } },
          }),
        };

      case 'CASH_RECON_EXCEPTIONS':
        return {
          ...base,
          count: await this.prisma.cashReconciliation.count({
            where: { ...scope, status: 'DISCREPANCY_PENDING' },
          }),
        };

      case 'FIELD_ESCALATIONS':
        return {
          ...base,
          count: await this.prisma.recoveryCase.count({
            where: {
              ...scope,
              escalatedAt: { not: null },
              status: { not: 'CLOSED' },
            },
          }),
        };

      case 'FAILED_JOBS':
        return {
          ...base,
          count: await this.prisma.maintenanceJobRun.count({
            where: {
              orgId: scope.orgId,
              // Branch-scoped deliberately differently: `branchId` is nullable
              // here because an org-wide job belongs to no branch. A branch
              // caller sees their own branch's runs *and* the org-wide ones
              // that affect them; filtering on `branchId` alone would hide
              // every org-wide failure from exactly the people who staff a
              // branch, and this alert exists to get someone to look.
              ...(scope.branchId
                ? { OR: [{ branchId: scope.branchId }, { branchId: null }] }
                : {}),
              status: { in: ['FAILED', 'RECOVERY_REQUIRED'] },
            },
          }),
        };

      default:
        // Unreachable while the registry and this switch agree. Thrown rather
        // than returned as zero, so the widget reports it as stale instead of
        // claiming there is nothing to act on.
        throw new Error(`No query defined for alert ${spec.alertType}`);
    }
  }
}
