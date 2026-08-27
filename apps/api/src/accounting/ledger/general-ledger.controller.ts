import { Controller, Get, Query, Req } from '@nestjs/common';
import type {
  GeneralLedgerPage,
  ReconciliationReport,
  TrialBalance,
} from '@lms/types';
import type { Request } from 'express';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  LEDGER_RECONCILE_PERMISSION,
  LEDGER_VIEW_PERMISSION,
  GeneralLedgerService,
} from './general-ledger.service';
import { ReconciliationService } from './reconciliation.service';
import {
  GeneralLedgerQueryDto,
  ReconciliationQueryDto,
  TrialBalanceQueryDto,
} from './dto/ledger.dto';

/**
 * The general ledger, the trial balance and reconciliation.
 *
 * # Route order
 *
 * `trial-balance` and `reconciliation` are literals and there is no `:param`
 * route on this controller at all, so no ordering hazard exists here. It is
 * worth stating rather than leaving implicit: adding one later would need it
 * declared last.
 *
 * # Three reads, no writes
 *
 * Every handler is a `@Get`. Reconciliation in particular has no write path
 * anywhere beneath it — Scenarios 59 and 60 require that it flag an
 * inconsistency rather than silently repair one, and the way to guarantee that
 * is for the code to be incapable of it.
 */
@Controller('accounting/ledger')
export class GeneralLedgerController {
  constructor(
    private readonly ledger: GeneralLedgerService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Get()
  @RequirePermissions(LEDGER_VIEW_PERMISSION)
  async generalLedger(
    @CurrentUser() user: AuthContext,
    @Query() query: GeneralLedgerQueryDto,
    @Req() req: Request,
  ): Promise<{ ledger: GeneralLedgerPage }> {
    return { ledger: await this.ledger.ledger(user, query, this.meta(req)) };
  }

  @Get('trial-balance')
  @RequirePermissions(LEDGER_VIEW_PERMISSION)
  async trialBalance(
    @CurrentUser() user: AuthContext,
    @Query() query: TrialBalanceQueryDto,
    @Req() req: Request,
  ): Promise<{ trialBalance: TrialBalance }> {
    return {
      trialBalance: await this.ledger.trialBalance(user, query, this.meta(req)),
    };
  }

  /**
   * A separate permission from `ledger.view`.
   *
   * Reconciliation spans every branch and every source module — scoping its
   * findings to one branch would report every other branch's postings as
   * missing — so it is a control function rather than a daily read, and is
   * withheld from the Branch Admin for that reason.
   */
  @Get('reconciliation')
  @RequirePermissions(LEDGER_RECONCILE_PERMISSION)
  async reconcile(
    @CurrentUser() user: AuthContext,
    @Query() query: ReconciliationQueryDto,
    @Req() req: Request,
  ): Promise<{ report: ReconciliationReport }> {
    return {
      report: await this.reconciliation.run(user, query, this.meta(req)),
    };
  }

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }
}
