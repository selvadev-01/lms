import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type {
  RepaymentScheduleListResult,
  RepaymentScheduleView,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  ExportScheduleDto,
  ListRepaymentSchedulesDto,
  RegenerateScheduleDto,
} from './dto/repayment-schedule.dto';
import { exportFilename, toCsv, toPdf } from './repayment-schedule-export';
import {
  SCHEDULES_EXPORT_PERMISSION,
  SCHEDULES_REGENERATE_PERMISSION,
  SCHEDULES_RETRY_PERMISSION,
  SCHEDULES_VIEW_PERMISSION,
  RepaymentScheduleService,
} from './repayment-schedule.service';

/**
 * Module 10 — the repayment schedule.
 *
 * # Route order
 *
 * `repayment-schedules` is a literal segment and is declared **before** any
 * `:loanId` route. Nest matches in declaration order, so the reverse would make
 * the list unreachable — every request for it would bind `loanId` to the string
 * `"repayment-schedules"` and 400 on the UUID pipe. The same trap
 * `emi-preview` documents in `LoanApplicationController`.
 *
 * # Why view is its own permission
 *
 * Reading a schedule is gated on `loans.schedules.view` rather than on
 * `loans.disbursements.view`, because the audiences diverge: collection and
 * recovery staff read a schedule for the life of the loan and have no business
 * reading the funding account and transfer reference that produced it.
 *
 * # Why regenerate is its own permission
 *
 * Reading and exporting are branch work. Regenerating rewrites every remaining
 * due date and amount the borrower is contractually bound to, so it stays with
 * the approval authority — the same split, one module later, that keeps
 * `disbursements.confirm` away from a Branch Admin. Scenarios 18 and 32 need an
 * account holding `view` and denied `regenerate` to prove it.
 *
 * Scope is never a request parameter. Confinement to the caller's organization
 * and branch is the service's job, through `LoanService.findInScope`, which
 * returns 404 rather than 403 so an id cannot be probed (Scenarios 33, 34, 35).
 */
@Controller('loans')
export class RepaymentScheduleController {
  constructor(private readonly schedules: RepaymentScheduleService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /** Scenarios 2, 33, 34. Declared before `:loanId` — see class comment. */
  @Get('repayment-schedules')
  @RequirePermissions(SCHEDULES_VIEW_PERMISSION)
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListRepaymentSchedulesDto,
    @Req() req: Request,
  ): Promise<RepaymentScheduleListResult> {
    return this.schedules.list(user, query, this.meta(req));
  }

  /** Scenarios 1, 3. */
  @Get(':loanId/repayment-schedule')
  @RequirePermissions(SCHEDULES_VIEW_PERMISSION)
  getForLoan(
    @CurrentUser() user: AuthContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Req() req: Request,
  ): Promise<RepaymentScheduleView> {
    return this.schedules.getForLoan(user, loanId, this.meta(req));
  }

  /**
   * Download the schedule as CSV or PDF.
   *
   * `@Header` sets no-store: a repayment schedule changes as payments land, and
   * a cached copy in a shared browser is both stale and a disclosure.
   */
  @Get(':loanId/repayment-schedule/export')
  @RequirePermissions(SCHEDULES_EXPORT_PERMISSION)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async export(
    @CurrentUser() user: AuthContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Query() query: ExportScheduleDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const format = query.format ?? 'csv';
    const view = await this.schedules.forExport(
      user,
      loanId,
      format,
      this.meta(req),
    );

    const filename = exportFilename(view, format);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (format === 'pdf') {
      const pdf = await toPdf(view);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(pdf.byteLength));
      res.end(pdf);
      return;
    }

    const csv = toCsv(view);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.end(csv);
  }

  /**
   * Supersede the live schedule with a new version (Scenario 16).
   *
   * Throttled tightly. Not for load — a regeneration is cheap — but as a brake
   * on a client stuck in a retry loop against an endpoint that rewrites the
   * borrower's obligations each time it succeeds.
   */
  @Post(':loanId/repayment-schedule/regenerate')
  @RequirePermissions(SCHEDULES_REGENERATE_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  regenerate(
    @CurrentUser() user: AuthContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Body() dto: RegenerateScheduleDto,
    @Req() req: Request,
  ): Promise<RepaymentScheduleView> {
    return this.schedules.regenerate(user, loanId, dto, this.meta(req));
  }

  /** Recovery from a failed generation (Scenarios 29, 31). Idempotent. */
  @Post(':loanId/repayment-schedule/retry')
  @RequirePermissions(SCHEDULES_RETRY_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  retry(
    @CurrentUser() user: AuthContext,
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Req() req: Request,
  ): Promise<RepaymentScheduleView> {
    return this.schedules.retry(user, loanId, this.meta(req));
  }
}
