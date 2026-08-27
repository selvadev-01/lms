import { Module } from '@nestjs/common';

import { RecoveryModule } from '../recovery/recovery.module';
import { ReportsModule } from '../reports/reports.module';
import { DashboardHomeController } from './dashboard-home.controller';
import { DashboardHomeService } from './dashboard-home.service';
import { CashSummaryService } from './widgets/cash-summary.service';
import { CollectionSummaryService } from './widgets/collection-summary.service';
import { LoanSummaryService } from './widgets/loan-summary.service';
import { OperationalAlertsService } from './widgets/operational-alerts.service';
import { OverdueSummaryService } from './widgets/overdue-summary.service';
import { RecentActivityService } from './widgets/recent-activity.service';

/**
 * Module 18 — Dashboard & Home.
 *
 * # It owns no data
 *
 * Rule 1: the dashboard is a read and navigation layer and must not become a
 * second source of truth. There is no migration, no table and no Prisma model
 * belonging to this module — the specification lists six tables and none were
 * built. Every figure is computed from the owning module's rows at read time,
 * every alert is a live count, and Recent Activity is the audit trail.
 *
 * The alternative would have been a metric-snapshot table filled by a job. That
 * needs a writer, and a writer can fail to run — leaving a dashboard that is
 * confidently wrong rather than visibly stale. Module 13 declines a stored
 * overdue table for the same reason.
 *
 * # What it imports
 *
 * `ReportsModule` for `KpiService` — the arithmetic behind outstanding, overdue
 * and collection figures, shared so that a number here cannot disagree with the
 * report a user drills into. `RecoveryModule` for `OverdueService`, which
 * `KpiService` depends on in turn.
 *
 * `PrismaModule` and `AuditModule` are `@Global` and are deliberately absent
 * from this list. `AuditQueryService` comes from the latter, which is why
 * Recent Activity needs no import of its own.
 *
 * # It exports nothing
 *
 * Nothing should read through the dashboard. Every figure belongs to another
 * module, and a caller wanting one should ask that module.
 *
 * # One controller, so route order is settled by declaration
 *
 * Module 16 shipped a bug where `GET /notifications/preferences` was swallowed
 * by `GET /notifications/:notificationId` because the two lived in different
 * controllers and the module's array decided which won. With a single
 * controller here, declaration order inside the file settles it — but if a
 * second controller is ever added under `dashboard`, its position in the array
 * below becomes load-bearing and needs the same comment Module 16 now carries.
 */
@Module({
  imports: [ReportsModule, RecoveryModule],
  controllers: [DashboardHomeController],
  providers: [
    DashboardHomeService,
    LoanSummaryService,
    CollectionSummaryService,
    OverdueSummaryService,
    CashSummaryService,
    OperationalAlertsService,
    RecentActivityService,
  ],
})
export class DashboardModule {}
