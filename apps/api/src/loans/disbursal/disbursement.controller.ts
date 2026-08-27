import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  DisbursalQueueItem,
  DisbursalReadiness,
  DisbursementDetail,
  DisbursementSummary,
  LedgerEntryDetail,
  RepaymentScheduleDetail,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  DISBURSEMENTS_CANCEL_PERMISSION,
  DISBURSEMENTS_CONFIRM_PERMISSION,
  DISBURSEMENTS_SCHEDULE_PERMISSION,
  DISBURSEMENTS_TRANSFER_PERMISSION,
  DISBURSEMENTS_VIEW_PERMISSION,
  DisbursementService,
} from './disbursement.service';
import {
  CancelDisbursementDto,
  ConfirmDisbursementDto,
  FailDisbursementDto,
  ListDisbursementsDto,
  RecordTransferDto,
  ScheduleDisbursementDto,
  UpdateDisbursementScheduleDto,
} from './dto/disbursement.dto';

/**
 * Module 09 — Disbursal.
 *
 * Route order is load-bearing, as it is in `LoanApplicationController`: the
 * literal `eligible` is declared before every `:disbursementId` route, because
 * Nest matches in declaration order and a parameter route placed first would
 * capture it and then fail `ParseUUIDPipe` with a confusing 400.
 *
 * # Permissions grant actions, not reach
 *
 * Confinement to the caller's organization and branch is the service's job —
 * `findInScope` on every path, 404 rather than 403. So a Branch Admin holding
 * `disbursements.view` still sees only their own branch's queue, and there is
 * deliberately no request parameter through which that could be widened.
 *
 * # Why confirm is its own permission
 *
 * `schedule` and `record_transfer` are reversible clerical acts. `confirm`
 * posts the ledger entry, activates the loan and generates the repayment
 * schedule, and cannot be undone except by a reversal. Rule 28 requires that
 * approval permission not imply disbursement permission; splitting the codes
 * this way is what lets the seed grant the first two to a Branch Admin and
 * withhold the third, which is what Scenarios 29 and 30 assert.
 *
 * # Throttling
 *
 * Confirm is the tightest limit in the module. It is not rate limiting for load
 * — idempotency already makes a retry safe — but a brake on a client stuck in a
 * retry loop against a money-moving endpoint.
 */
@Controller('loans/disbursements')
export class DisbursementController {
  constructor(private readonly disbursements: DisbursementService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /** Scenarios 1, 3, 4. Declared before `:disbursementId` — see class comment. */
  @Get('eligible')
  @RequirePermissions(DISBURSEMENTS_VIEW_PERMISSION)
  async listEligible(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
  ): Promise<{ loans: DisbursalQueueItem[] }> {
    const loans = await this.disbursements.listEligible(user, this.meta(req));
    return { loans };
  }

  /**
   * The funding accounts a disbursement may be scheduled against.
   *
   * A literal segment, so it is declared before `:disbursementId` for the
   * reason the class comment gives.
   */
  @Get('accounts')
  @RequirePermissions(DISBURSEMENTS_VIEW_PERMISSION)
  async accounts(
    @CurrentUser() user: AuthContext,
  ): Promise<{ accounts: { value: string; label: string; hint?: string }[] }> {
    const accounts = await this.disbursements.listFundingAccounts(user);
    return { accounts };
  }

  @Get()
  @RequirePermissions(DISBURSEMENTS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListDisbursementsDto,
  ): Promise<{ disbursements: DisbursementSummary[]; total: number }> {
    const { items, total } = await this.disbursements.list(user, query);
    return { disbursements: items, total };
  }

  /** Scenario 5. Creates the loan row and the schedule; moves no money. */
  @Post()
  @RequirePermissions(DISBURSEMENTS_SCHEDULE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  schedule(
    @CurrentUser() user: AuthContext,
    @Body() dto: ScheduleDisbursementDto,
    @Req() req: Request,
  ): Promise<DisbursementDetail> {
    return this.disbursements.schedule(user, dto, this.meta(req));
  }

  /** Scenario 2. */
  @Get(':disbursementId')
  @RequirePermissions(DISBURSEMENTS_VIEW_PERMISSION)
  getDetail(
    @CurrentUser() user: AuthContext,
    @Param('disbursementId', ParseUUIDPipe) disbursementId: string,
    @Req() req: Request,
  ): Promise<DisbursementDetail> {
    return this.disbursements.getDetail(user, disbursementId, this.meta(req));
  }

  /**
   * Scenarios 8, 9, 10, 41. Advisory only — `confirm` re-runs every one of
   * these inside its own transaction.
   */
  @Get(':disbursementId/readiness')
  @RequirePermissions(DISBURSEMENTS_VIEW_PERMISSION)
  readiness(
    @CurrentUser() user: AuthContext,
    @Param('disbursementId', ParseUUIDPipe) disbursementId: string,
    @Req() req: Request,
  ): Promise<DisbursalReadiness> {
    return this.disbursements.disbursalReadiness(
      user,
      disbursementId,
      this.meta(req),
    );
  }

  /** Scenarios 19, 21, 49. The posted double-entry behind a disbursement. */
  @Get(':disbursementId/ledger')
  @RequirePermissions(DISBURSEMENTS_VIEW_PERMISSION)
  getLedger(
    @CurrentUser() user: AuthContext,
    @Param('disbursementId', ParseUUIDPipe) disbursementId: string,
    @Req() req: Request,
  ): Promise<LedgerEntryDetail> {
    return this.disbursements.getLedger(user, disbursementId, this.meta(req));
  }

  /** Scenario 24. Version 1, generated with the disbursal. */
  @Get(':disbursementId/schedule')
  @RequirePermissions(DISBURSEMENTS_VIEW_PERMISSION)
  getSchedule(
    @CurrentUser() user: AuthContext,
    @Param('disbursementId', ParseUUIDPipe) disbursementId: string,
    @Req() req: Request,
  ): Promise<RepaymentScheduleDetail> {
    return this.disbursements.getSchedule(user, disbursementId, this.meta(req));
  }

  /** Scenarios 11, 12, 13. Refused once a transfer has been recorded. */
  @Patch(':disbursementId')
  @RequirePermissions(DISBURSEMENTS_SCHEDULE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  updateSchedule(
    @CurrentUser() user: AuthContext,
    @Param('disbursementId', ParseUUIDPipe) disbursementId: string,
    @Body() dto: UpdateDisbursementScheduleDto,
    @Req() req: Request,
  ): Promise<DisbursementDetail> {
    return this.disbursements.updateSchedule(
      user,
      disbursementId,
      dto,
      this.meta(req),
    );
  }

  /** Scenarios 14, 15, 16, 17, 18. Records an external event; posts no ledger. */
  @Post(':disbursementId/transfer')
  @RequirePermissions(DISBURSEMENTS_TRANSFER_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  recordTransfer(
    @CurrentUser() user: AuthContext,
    @Param('disbursementId', ParseUUIDPipe) disbursementId: string,
    @Body() dto: RecordTransferDto,
    @Req() req: Request,
  ): Promise<DisbursementDetail> {
    return this.disbursements.recordTransfer(
      user,
      disbursementId,
      dto,
      this.meta(req),
    );
  }

  /**
   * Scenarios 19-24, 27, 28, 44, 46. The irreversible one.
   *
   * A replayed idempotency key returns 200 with the original result, not an
   * error — a retried request that already succeeded has succeeded.
   */
  @Post(':disbursementId/confirm')
  @RequirePermissions(DISBURSEMENTS_CONFIRM_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  confirm(
    @CurrentUser() user: AuthContext,
    @Param('disbursementId', ParseUUIDPipe) disbursementId: string,
    @Body() dto: ConfirmDisbursementDto,
    @Req() req: Request,
  ): Promise<DisbursementDetail> {
    return this.disbursements.confirm(
      user,
      disbursementId,
      dto,
      this.meta(req),
    );
  }

  /** Scenario 26. The loan is not disbursed and the attempt stays retryable. */
  @Post(':disbursementId/fail')
  @RequirePermissions(DISBURSEMENTS_TRANSFER_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  markFailed(
    @CurrentUser() user: AuthContext,
    @Param('disbursementId', ParseUUIDPipe) disbursementId: string,
    @Body() dto: FailDisbursementDto,
    @Req() req: Request,
  ): Promise<DisbursementDetail> {
    return this.disbursements.markFailed(
      user,
      disbursementId,
      dto,
      this.meta(req),
    );
  }

  /**
   * Scenarios 37, 38. Cancels a scheduled disbursement; never deletes one.
   *
   * A POST rather than a DELETE because nothing is removed — Rules 30 and 31
   * forbid deleting a financial record, and a DELETE verb would advertise a
   * capability this endpoint deliberately does not have.
   */
  @Post(':disbursementId/cancel')
  @RequirePermissions(DISBURSEMENTS_CANCEL_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  cancel(
    @CurrentUser() user: AuthContext,
    @Param('disbursementId', ParseUUIDPipe) disbursementId: string,
    @Body() dto: CancelDisbursementDto,
    @Req() req: Request,
  ): Promise<{ cancelled: true }> {
    return this.disbursements.cancel(user, disbursementId, dto, this.meta(req));
  }
}
