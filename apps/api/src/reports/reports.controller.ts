import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type {
  ApplicationReport,
  CollectionReport,
  DisbursalReport,
  FieldCollectionReport,
  FinancialReport,
  OverdueReport,
  PortfolioReport,
  ReportDashboard,
  ReportMeta,
} from '@lms/types';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  ApplicationReportService,
  REPORTS_APPLICATIONS_VIEW_PERMISSION,
} from './applications/application-report.service';
import {
  CollectionReportService,
  REPORTS_COLLECTIONS_VIEW_PERMISSION,
} from './collections/collection-report.service';
import {
  DashboardService,
  REPORTS_DASHBOARD_VIEW_PERMISSION,
} from './dashboard/dashboard.service';
import {
  DisbursalReportService,
  REPORTS_DISBURSALS_VIEW_PERMISSION,
} from './disbursals/disbursal-report.service';
// A value import, not `import type`. These are validation classes: Nest reads
// their decorator metadata at runtime to build the ValidationPipe's schema, and
// a type-only import is erased at compile time — leaving the pipe with no
// metadata, `forbidNonWhitelisted` stripping every query parameter, and every
// report request refused with "property pageSize should not exist".
import {
  DashboardQueryDto,
  FinancialReportQueryDto,
  ReportExportQueryDto,
  ReportQueryDto,
} from './dto/reports.dto';
import {
  FieldCollectionReportService,
  REPORTS_FIELD_VIEW_PERMISSION,
} from './field/field-collection-report.service';
import {
  FinancialReportService,
  REPORTS_FINANCIAL_VIEW_PERMISSION,
} from './financial/financial-report.service';
import {
  OverdueReportService,
  REPORTS_OVERDUE_VIEW_PERMISSION,
} from './overdue/overdue-report.service';
import {
  PortfolioReportService,
  REPORTS_PORTFOLIO_VIEW_PERMISSION,
} from './portfolio/portfolio-report.service';
import {
  APPLICATION_COLUMNS,
  COLLECTION_COLUMNS,
  DISBURSAL_COLUMNS,
  FIELD_COLLECTION_COLUMNS,
  FINANCIAL_COLUMNS,
  OVERDUE_COLUMNS,
  PORTFOLIO_COLUMNS,
} from './report-columns';
import {
  reportExportFilename,
  reportToCsv,
  reportToPdf,
  type ReportColumn,
} from './report-export';
import { assertExportSize, REPORTS_EXPORT_PERMISSION } from './report-scope';

/**
 * Every report surface (Module 15).
 *
 * # Every handler is a `@Get`
 *
 * There is no POST, PATCH or DELETE in this controller, and that is the module's
 * central property rather than an accident of what has been built so far.
 * Rules 5, 6 and 17 make a report a read-only view of authoritative data, and
 * Scenario 46 makes editing a reported value a refusal. The surest way to
 * honour that is to expose no way to try — the same reasoning Module 13's
 * overdue controller documents.
 *
 * The one exception lives in `SavedReportController`, which owns the module's
 * only writes: saved *definitions*, which are filter sets rather than results.
 *
 * # Export re-checks, and audits before the bytes leave
 *
 * An export handler requires `reports.export` *in addition to* the category's
 * view permission, because a file leaves the system and a screen does not
 * (Scenario 51). The audit is written before the first byte is sent, so a
 * refusal is still possible at that point — an audit that ran after the
 * response had started would be recording something it could no longer stop.
 *
 * # Literal routes before parameterised ones
 *
 * Nest matches in declaration order. Every route here is literal, so there is
 * nothing to shadow, but the export routes are declared beside their reports
 * to keep the pairing obvious.
 */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly portfolio: PortfolioReportService,
    private readonly applications: ApplicationReportService,
    private readonly disbursals: DisbursalReportService,
    private readonly collections: CollectionReportService,
    private readonly field: FieldCollectionReportService,
    private readonly overdue: OverdueReportService,
    private readonly financial: FinancialReportService,
    private readonly audit: AuditService,
  ) {}

  @Get('dashboard')
  @RequirePermissions(REPORTS_DASHBOARD_VIEW_PERMISSION)
  dashboardReport(
    @CurrentUser() user: AuthContext,
    @Query() query: DashboardQueryDto,
    @Req() req: Request,
  ): Promise<ReportDashboard> {
    return this.dashboard.run(user, query, this.meta(req));
  }

  @Get('portfolio')
  @RequirePermissions(REPORTS_PORTFOLIO_VIEW_PERMISSION)
  portfolioReport(
    @CurrentUser() user: AuthContext,
    @Query() query: ReportQueryDto,
    @Req() req: Request,
  ): Promise<PortfolioReport> {
    return this.portfolio.run(user, query, this.meta(req));
  }

  @Get('portfolio/export')
  @RequirePermissions(
    REPORTS_PORTFOLIO_VIEW_PERMISSION,
    REPORTS_EXPORT_PERMISSION,
  )
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async portfolioExport(
    @CurrentUser() user: AuthContext,
    @Query() query: ReportExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.portfolio.run(
      user,
      this.exportPaging(query),
      this.meta(req),
    );
    await this.send(
      res,
      user,
      req,
      'Loan Portfolio Report',
      report,
      PORTFOLIO_COLUMNS,
      query.format ?? 'csv',
    );
  }

  @Get('applications')
  @RequirePermissions(REPORTS_APPLICATIONS_VIEW_PERMISSION)
  applicationReport(
    @CurrentUser() user: AuthContext,
    @Query() query: ReportQueryDto,
    @Req() req: Request,
  ): Promise<ApplicationReport> {
    return this.applications.run(user, query, this.meta(req));
  }

  @Get('applications/export')
  @RequirePermissions(
    REPORTS_APPLICATIONS_VIEW_PERMISSION,
    REPORTS_EXPORT_PERMISSION,
  )
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async applicationExport(
    @CurrentUser() user: AuthContext,
    @Query() query: ReportExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.applications.run(
      user,
      this.exportPaging(query),
      this.meta(req),
    );
    await this.send(
      res,
      user,
      req,
      'Application Report',
      report,
      APPLICATION_COLUMNS,
      query.format ?? 'csv',
    );
  }

  @Get('disbursals')
  @RequirePermissions(REPORTS_DISBURSALS_VIEW_PERMISSION)
  disbursalReport(
    @CurrentUser() user: AuthContext,
    @Query() query: ReportQueryDto,
    @Req() req: Request,
  ): Promise<DisbursalReport> {
    return this.disbursals.run(user, query, this.meta(req));
  }

  @Get('disbursals/export')
  @RequirePermissions(
    REPORTS_DISBURSALS_VIEW_PERMISSION,
    REPORTS_EXPORT_PERMISSION,
  )
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async disbursalExport(
    @CurrentUser() user: AuthContext,
    @Query() query: ReportExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.disbursals.run(
      user,
      this.exportPaging(query),
      this.meta(req),
    );
    await this.send(
      res,
      user,
      req,
      'Disbursal Report',
      report,
      DISBURSAL_COLUMNS,
      query.format ?? 'csv',
    );
  }

  @Get('collections')
  @RequirePermissions(REPORTS_COLLECTIONS_VIEW_PERMISSION)
  collectionReport(
    @CurrentUser() user: AuthContext,
    @Query() query: ReportQueryDto,
    @Req() req: Request,
  ): Promise<CollectionReport> {
    return this.collections.run(user, query, this.meta(req));
  }

  @Get('collections/export')
  @RequirePermissions(
    REPORTS_COLLECTIONS_VIEW_PERMISSION,
    REPORTS_EXPORT_PERMISSION,
  )
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async collectionExport(
    @CurrentUser() user: AuthContext,
    @Query() query: ReportExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.collections.run(
      user,
      this.exportPaging(query),
      this.meta(req),
    );
    await this.send(
      res,
      user,
      req,
      'Collection Report',
      report,
      COLLECTION_COLUMNS,
      query.format ?? 'csv',
    );
  }

  @Get('field-collections')
  @RequirePermissions(REPORTS_FIELD_VIEW_PERMISSION)
  fieldCollectionReport(
    @CurrentUser() user: AuthContext,
    @Query() query: ReportQueryDto,
    @Req() req: Request,
  ): Promise<FieldCollectionReport> {
    return this.field.run(user, query, this.meta(req));
  }

  @Get('field-collections/export')
  @RequirePermissions(REPORTS_FIELD_VIEW_PERMISSION, REPORTS_EXPORT_PERMISSION)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async fieldCollectionExport(
    @CurrentUser() user: AuthContext,
    @Query() query: ReportExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.field.run(
      user,
      this.exportPaging(query),
      this.meta(req),
    );
    await this.send(
      res,
      user,
      req,
      'Field Collection & Reconciliation Report',
      report,
      FIELD_COLLECTION_COLUMNS,
      query.format ?? 'csv',
    );
  }

  @Get('overdue-recovery')
  @RequirePermissions(REPORTS_OVERDUE_VIEW_PERMISSION)
  overdueReport(
    @CurrentUser() user: AuthContext,
    @Query() query: ReportQueryDto,
    @Req() req: Request,
  ): Promise<OverdueReport> {
    return this.overdue.run(user, query, this.meta(req));
  }

  @Get('overdue-recovery/export')
  @RequirePermissions(
    REPORTS_OVERDUE_VIEW_PERMISSION,
    REPORTS_EXPORT_PERMISSION,
  )
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async overdueExport(
    @CurrentUser() user: AuthContext,
    @Query() query: ReportExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.overdue.run(
      user,
      this.exportPaging(query),
      this.meta(req),
    );
    await this.send(
      res,
      user,
      req,
      'Overdue & Recovery Report',
      report,
      OVERDUE_COLUMNS,
      query.format ?? 'csv',
    );
  }

  @Get('financial')
  @RequirePermissions(REPORTS_FINANCIAL_VIEW_PERMISSION)
  financialReport(
    @CurrentUser() user: AuthContext,
    @Query() query: FinancialReportQueryDto,
    @Req() req: Request,
  ): Promise<FinancialReport> {
    return this.financial.run(user, query, this.meta(req));
  }

  @Get('financial/export')
  @RequirePermissions(
    REPORTS_FINANCIAL_VIEW_PERMISSION,
    REPORTS_EXPORT_PERMISSION,
  )
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async financialExport(
    @CurrentUser() user: AuthContext,
    @Query() query: FinancialReportQueryDto & { format?: 'csv' | 'pdf' },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.financial.run(
      user,
      this.exportPaging(query),
      this.meta(req),
    );
    await this.send(
      res,
      user,
      req,
      'Financial Report',
      report,
      FINANCIAL_COLUMNS,
      query.format ?? 'csv',
    );
  }

  /**
   * An export asks for the whole result set, not one page.
   *
   * `MAX_EXPORT_ROWS + 1` rather than the ceiling itself: asking for one more
   * than is allowed is how `assertExportSize` can tell "exactly at the limit"
   * from "over it" without a second count query.
   */
  private exportPaging<T extends { page?: number; pageSize?: number }>(
    query: T,
  ): T {
    return { ...query, page: 1, pageSize: 10_001 };
  }

  /**
   * Render and send, auditing first.
   *
   * The size check runs before rendering: refusing a 40,000-row export after
   * spending the memory to lay it out would be the same refusal, later and
   * more expensively.
   */
  private async send<TRow>(
    res: Response,
    actor: AuthContext,
    req: Request,
    title: string,
    report: {
      meta: ReportMeta;
      rows: TRow[];
      totals: Record<string, string | number>;
    },
    columns: ReportColumn<TRow>[],
    format: 'csv' | 'pdf',
  ): Promise<void> {
    const meta = this.meta(req);

    try {
      assertExportSize(report.rows.length);
    } catch (error) {
      // Recorded without a transaction so it survives the refusal, the same way
      // every denial record in this codebase does (Scenario 67).
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.REPORT_EXPORT_DENIED,
        entityType: 'REPORT',
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          category: report.meta.category,
          reason: 'ROW_LIMIT',
          rowCount: report.rows.length,
        },
      });
      throw error;
    }

    const payload: {
      title: string;
      meta: ReportMeta;
      rows: TRow[];
      totals: Record<string, string | number>;
      columns: ReportColumn<TRow>[];
    } = {
      title,
      meta: report.meta,
      rows: report.rows,
      totals: report.totals,
      columns,
    };

    // Audited before a byte is written. Scenarios 34 and 65: the export action
    // and any sensitive download are recorded, and recording after the response
    // had begun would be recording something already gone.
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.REPORT_EXPORTED,
      entityType: 'REPORT',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        category: report.meta.category,
        format,
        rowCount: report.rows.length,
        branchId: report.meta.branchId,
        piiMasked: report.meta.piiMasked,
      },
    });

    const filename = reportExportFilename(report.meta, format);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.end(await reportToPdf(payload));
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.end(reportToCsv(payload));
  }

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }
}
