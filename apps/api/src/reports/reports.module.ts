import { Module } from '@nestjs/common';

import { AccountingModule } from '../accounting/accounting.module';
import { RecoveryModule } from '../recovery/recovery.module';
import { ApplicationReportService } from './applications/application-report.service';
import { CollectionReportService } from './collections/collection-report.service';
import { DashboardService } from './dashboard/dashboard.service';
import { DisbursalReportService } from './disbursals/disbursal-report.service';
import { FieldCollectionReportService } from './field/field-collection-report.service';
import { FinancialReportService } from './financial/financial-report.service';
import { KpiService } from './kpi/kpi.service';
import { OverdueReportService } from './overdue/overdue-report.service';
import { PortfolioReportService } from './portfolio/portfolio-report.service';
import { ReportsController } from './reports.controller';
import { SavedReportController } from './saved/saved-report.controller';
import { SavedReportService } from './saved/saved-report.service';

/**
 * Module 15 — Reports & Analytics.
 *
 * # Top-level, not nested under the modules it reads
 *
 * A report spans seven other modules; there is no one owner it could sit
 * beneath. What it does own is the reporting *vocabulary* — the categories, the
 * date bases, the scope rule and the export shape — and that lives here.
 *
 * # What it imports, and what it deliberately does not
 *
 * `RecoveryModule` for `OverdueService`, and `AccountingModule` for
 * `GeneralLedgerService`. Both are the reuse decisions that make the module
 * correct rather than merely convenient: the overdue derivation and the ledger
 * aggregation each have exactly one implementation, so a report cannot disagree
 * with the screen it summarises (Rules 13, 14, 15).
 *
 * `PrismaModule` and `AuditModule` are `@Global` and are deliberately absent
 * from this list.
 *
 * # It exports one thing, and only one
 *
 * Nothing else in the system should read *through a report*. Every figure here
 * belongs to another module, and a caller wanting one should ask that module —
 * a report is a presentation of the truth, not a source of it. No report
 * service is exported, and none should be.
 *
 * `KpiService` is the single exception, and the distinction that makes it safe
 * is that a *computation* is not a *report*. It resolves no scope, checks no
 * permission, writes no audit row and builds no envelope; it is arithmetic over
 * rows the caller has already proven it may read. Module 18's home screen needs
 * the same outstanding, overdue and collection figures this module's dashboard
 * shows, and the alternative — a second implementation — is exactly the drift
 * Rule 1 forbids: two screens computing "total outstanding" separately, with
 * nothing to catch the day they stop agreeing.
 *
 * Exporting `DashboardService` instead would not have worked. Its `run` is
 * all-or-nothing by construction — one audit row, one envelope, all four KPI
 * groups — and Module 18 needs one group at a time so a single widget can fail
 * on its own.
 */
@Module({
  imports: [RecoveryModule, AccountingModule],
  controllers: [ReportsController, SavedReportController],
  providers: [
    KpiService,
    DashboardService,
    PortfolioReportService,
    ApplicationReportService,
    DisbursalReportService,
    CollectionReportService,
    FieldCollectionReportService,
    OverdueReportService,
    FinancialReportService,
    SavedReportService,
  ],
  exports: [KpiService],
})
export class ReportsModule {}
