import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  CashReconciliationDetail,
  CashReconciliationListResult,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CASH_RECONCILIATION_PERFORM_PERMISSION,
  CASH_RECONCILIATION_RESOLVE_PERMISSION,
  CASH_RECONCILIATION_VIEW_PERMISSION,
  CashReconciliationService,
} from './cash-reconciliation.service';
import {
  CreateReconciliationDto,
  ListReconciliationsDto,
  ResolveDiscrepancyDto,
} from './dto/cash-reconciliation.dto';

/**
 * Module 12 — cash reconciliation.
 *
 * # Three permissions, not one
 *
 * Viewing, counting and resolving are three authorities. The split that matters
 * is `perform` versus `resolve`: counting a drawer and finding it short is
 * branch work, while deciding who bears the shortage is the approval
 * authority's. One code covering both would let a branch both discover and
 * forgive its own discrepancies, which is the unreviewed control this module
 * exists to prevent — and would make Scenario 30 unprovable.
 *
 * # No delete route
 *
 * `cash_reconciliations_append_only` refuses every delete. The counted figures
 * are retained for audit (Scenario 36).
 */
@Controller('field/cash-reconciliations')
export class CashReconciliationController {
  constructor(private readonly reconciliations: CashReconciliationService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  @Get()
  @RequirePermissions(CASH_RECONCILIATION_VIEW_PERMISSION)
  list(
    @CurrentUser() user: AuthContext,
    @Query() dto: ListReconciliationsDto,
    @Req() req: Request,
  ): Promise<CashReconciliationListResult> {
    return this.reconciliations.list(user, dto, this.meta(req));
  }

  /** Count the cash against a received handover. */
  @Post()
  @HttpCode(200)
  @RequirePermissions(CASH_RECONCILIATION_PERFORM_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateReconciliationDto,
    @Req() req: Request,
  ): Promise<CashReconciliationDetail> {
    return this.reconciliations.create(user, dto, this.meta(req));
  }

  @Get(':reconciliationId')
  @RequirePermissions(CASH_RECONCILIATION_VIEW_PERMISSION)
  detail(
    @CurrentUser() user: AuthContext,
    @Param('reconciliationId', new ParseUUIDPipe({ version: '4' }))
    reconciliationId: string,
    @Req() req: Request,
  ): Promise<CashReconciliationDetail> {
    return this.reconciliations.getDetail(
      user,
      reconciliationId,
      this.meta(req),
    );
  }

  /**
   * Resolve a pending shortage or excess.
   *
   * Withheld from Branch Admin. Writes no journal — an accounting adjustment,
   * where one is needed, goes through Module 14's manual journal and its entry
   * number is recorded here as the approval reference (Scenario 29).
   */
  @Post(':reconciliationId/resolve')
  @HttpCode(200)
  @RequirePermissions(CASH_RECONCILIATION_RESOLVE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resolve(
    @CurrentUser() user: AuthContext,
    @Param('reconciliationId', new ParseUUIDPipe({ version: '4' }))
    reconciliationId: string,
    @Body() dto: ResolveDiscrepancyDto,
    @Req() req: Request,
  ): Promise<CashReconciliationDetail> {
    return this.reconciliations.resolve(
      user,
      reconciliationId,
      dto,
      this.meta(req),
    );
  }
}
