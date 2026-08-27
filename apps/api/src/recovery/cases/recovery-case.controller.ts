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
  LegalNoticeRecord,
  PenaltySummary,
  RecoveryActionRecord,
  RecoveryCaseDetail,
  RecoveryCaseListResult,
  SettlementRecord,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  PENALTIES_ASSESS_PERMISSION,
  PENALTIES_WAIVE_PERMISSION,
  PenaltyService,
} from '../penalty/penalty.service';
import {
  AssessPenaltyDto,
  AssignRecoveryCaseDto,
  CloseRecoveryCaseDto,
  DecideSettlementDto,
  EscalateRecoveryCaseDto,
  IssueLegalNoticeDto,
  ListRecoveryCasesDto,
  OpenRecoveryCaseDto,
  PenaltyActionDto,
  ProposeSettlementDto,
  RecordRecoveryActionDto,
  UpdateRecoveryActionDto,
  WriteOffLoanDto,
} from '../dto/recovery.dto';
import {
  RECOVERY_NOTICES_ISSUE_PERMISSION,
  RECOVERY_SETTLEMENTS_APPROVE_PERMISSION,
  RECOVERY_SETTLEMENTS_PROPOSE_PERMISSION,
  RECOVERY_WRITEOFF_POST_PERMISSION,
  SettlementService,
} from '../settlements/settlement.service';
import {
  RECOVERY_ACTIONS_RECORD_PERMISSION,
  RecoveryActionService,
} from './recovery-action.service';
import {
  RECOVERY_CASES_ASSIGN_PERMISSION,
  RECOVERY_CASES_CLOSE_PERMISSION,
  RECOVERY_CASES_CREATE_PERMISSION,
  RECOVERY_CASES_ESCALATE_PERMISSION,
  RECOVERY_CASES_VIEW_PERMISSION,
  RecoveryCaseService,
} from './recovery-case.service';

/**
 * Module 13 — recovery cases.
 *
 * # Why `POST /` carries `@HttpCode(200)`
 *
 * Opening a case is idempotent: a retry with the same key returns the original
 * rather than creating a second, so the response is not always "created". The
 * same convention Modules 09, 11 and 14 use for every key-bearing POST.
 *
 * # One endpoint per authority
 *
 * Assign, escalate and close are separate routes with separate permissions
 * rather than one `PATCH` that decides from a body field. A single endpoint
 * would have to resolve which permission it needed at runtime, and the guard
 * runs before the body is read — so the check would end up inside the service,
 * where it is far easier to forget.
 */
@Controller('recovery/cases')
export class RecoveryCaseController {
  constructor(
    private readonly cases: RecoveryCaseService,
    private readonly actions: RecoveryActionService,
    private readonly penalties: PenaltyService,
    private readonly settlements: SettlementService,
  ) {}

  @Get()
  @RequirePermissions(RECOVERY_CASES_VIEW_PERMISSION)
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListRecoveryCasesDto,
    @Req() req: Request,
  ): Promise<RecoveryCaseListResult> {
    return this.cases.list(user, query, this.meta(req));
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions(RECOVERY_CASES_CREATE_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  open(
    @CurrentUser() user: AuthContext,
    @Body() dto: OpenRecoveryCaseDto,
    @Req() req: Request,
  ): Promise<RecoveryCaseDetail> {
    return this.cases.open(user, dto, this.meta(req));
  }

  /**
   * Assessing penal interest.
   *
   * Mounted here rather than under a `penalties` controller because a penalty
   * is always assessed against a loan in the recovery context, and a second
   * controller would need its own scope resolution — a second place for the
   * branch confinement to be got wrong.
   *
   * A literal segment, so it is declared before `:recoveryCaseId` below.
   */
  @Post('penalties/assess')
  @HttpCode(200)
  @RequirePermissions(PENALTIES_ASSESS_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  assessPenalty(
    @CurrentUser() user: AuthContext,
    @Body() dto: AssessPenaltyDto,
    @Req() req: Request,
  ): Promise<PenaltySummary[]> {
    return this.penalties.assess(user, dto, this.meta(req));
  }

  @Post('penalties/:penaltyId/action')
  @RequirePermissions(PENALTIES_WAIVE_PERMISSION)
  actOnPenalty(
    @CurrentUser() user: AuthContext,
    @Param('penaltyId', new ParseUUIDPipe({ version: '4' })) penaltyId: string,
    @Body() dto: PenaltyActionDto,
    @Req() req: Request,
  ): Promise<PenaltySummary> {
    return this.penalties.act(user, penaltyId, dto, this.meta(req));
  }

  @Get(':recoveryCaseId')
  @RequirePermissions(RECOVERY_CASES_VIEW_PERMISSION)
  detail(
    @CurrentUser() user: AuthContext,
    @Param('recoveryCaseId', new ParseUUIDPipe({ version: '4' }))
    recoveryCaseId: string,
    @Req() req: Request,
  ): Promise<RecoveryCaseDetail> {
    return this.cases.detail(user, recoveryCaseId, this.meta(req));
  }

  @Post(':recoveryCaseId/assign')
  @RequirePermissions(RECOVERY_CASES_ASSIGN_PERMISSION)
  assign(
    @CurrentUser() user: AuthContext,
    @Param('recoveryCaseId', new ParseUUIDPipe({ version: '4' }))
    recoveryCaseId: string,
    @Body() dto: AssignRecoveryCaseDto,
    @Req() req: Request,
  ): Promise<RecoveryCaseDetail> {
    return this.cases.assign(user, recoveryCaseId, dto, this.meta(req));
  }

  @Post(':recoveryCaseId/escalate')
  @RequirePermissions(RECOVERY_CASES_ESCALATE_PERMISSION)
  escalate(
    @CurrentUser() user: AuthContext,
    @Param('recoveryCaseId', new ParseUUIDPipe({ version: '4' }))
    recoveryCaseId: string,
    @Body() dto: EscalateRecoveryCaseDto,
    @Req() req: Request,
  ): Promise<RecoveryCaseDetail> {
    return this.cases.escalate(user, recoveryCaseId, dto, this.meta(req));
  }

  @Post(':recoveryCaseId/close')
  @RequirePermissions(RECOVERY_CASES_CLOSE_PERMISSION)
  close(
    @CurrentUser() user: AuthContext,
    @Param('recoveryCaseId', new ParseUUIDPipe({ version: '4' }))
    recoveryCaseId: string,
    @Body() dto: CloseRecoveryCaseDto,
    @Req() req: Request,
  ): Promise<RecoveryCaseDetail> {
    return this.cases.close(user, recoveryCaseId, dto, this.meta(req));
  }

  @Post(':recoveryCaseId/settlements')
  @HttpCode(200)
  @RequirePermissions(RECOVERY_SETTLEMENTS_PROPOSE_PERMISSION)
  proposeSettlement(
    @CurrentUser() user: AuthContext,
    @Param('recoveryCaseId', new ParseUUIDPipe({ version: '4' }))
    recoveryCaseId: string,
    @Body() dto: ProposeSettlementDto,
    @Req() req: Request,
  ): Promise<SettlementRecord> {
    return this.settlements.propose(user, recoveryCaseId, dto, this.meta(req));
  }

  @Post(':recoveryCaseId/notices')
  @RequirePermissions(RECOVERY_NOTICES_ISSUE_PERMISSION)
  issueNotice(
    @CurrentUser() user: AuthContext,
    @Param('recoveryCaseId', new ParseUUIDPipe({ version: '4' }))
    recoveryCaseId: string,
    @Body() dto: IssueLegalNoticeDto,
    @Req() req: Request,
  ): Promise<LegalNoticeRecord> {
    return this.settlements.issueNotice(
      user,
      recoveryCaseId,
      dto,
      this.meta(req),
    );
  }

  /**
   * Writing the loan off.
   *
   * The most irreversible route in the module, behind a permission the seed
   * grants to no role — reaching it is always a deliberate configuration
   * choice.
   */
  @Post(':recoveryCaseId/write-off')
  @RequirePermissions(RECOVERY_WRITEOFF_POST_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  writeOff(
    @CurrentUser() user: AuthContext,
    @Param('recoveryCaseId', new ParseUUIDPipe({ version: '4' }))
    recoveryCaseId: string,
    @Body() dto: WriteOffLoanDto,
    @Req() req: Request,
  ): Promise<SettlementRecord | null> {
    return this.settlements.writeOff(user, recoveryCaseId, dto, this.meta(req));
  }

  /**
   * Recording activity.
   *
   * `@HttpCode(200)` because a device replaying an offline activity gets the
   * original row back rather than a second one (Scenario 28).
   */
  @Post(':recoveryCaseId/actions')
  @HttpCode(200)
  @RequirePermissions(RECOVERY_ACTIONS_RECORD_PERMISSION)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  recordAction(
    @CurrentUser() user: AuthContext,
    @Param('recoveryCaseId', new ParseUUIDPipe({ version: '4' }))
    recoveryCaseId: string,
    @Body() dto: RecordRecoveryActionDto,
    @Req() req: Request,
  ): Promise<RecoveryActionRecord> {
    return this.actions.record(user, recoveryCaseId, dto, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }
}

/**
 * Recovery actions addressed by their own id.
 *
 * A separate controller so the source's `/recovery-actions/:id` route exists
 * without nesting it under a case the client may not know. Scope still resolves
 * through the case, so the confinement is identical either way.
 */
@Controller('recovery/actions')
export class RecoveryActionController {
  constructor(private readonly actions: RecoveryActionService) {}

  @Get(':recoveryActionId')
  @RequirePermissions(RECOVERY_CASES_VIEW_PERMISSION)
  detail(
    @CurrentUser() user: AuthContext,
    @Param('recoveryActionId', new ParseUUIDPipe({ version: '4' }))
    recoveryActionId: string,
    @Req() req: Request,
  ): Promise<RecoveryActionRecord> {
    return this.actions.detail(user, recoveryActionId, this.meta(req));
  }

  @Patch(':recoveryActionId')
  @RequirePermissions(RECOVERY_ACTIONS_RECORD_PERMISSION)
  update(
    @CurrentUser() user: AuthContext,
    @Param('recoveryActionId', new ParseUUIDPipe({ version: '4' }))
    recoveryActionId: string,
    @Body() dto: UpdateRecoveryActionDto,
    @Req() req: Request,
  ): Promise<RecoveryActionRecord> {
    return this.actions.update(user, recoveryActionId, dto, this.meta(req));
  }

  @Post(':recoveryActionId/finalize')
  @RequirePermissions(RECOVERY_ACTIONS_RECORD_PERMISSION)
  finalize(
    @CurrentUser() user: AuthContext,
    @Param('recoveryActionId', new ParseUUIDPipe({ version: '4' }))
    recoveryActionId: string,
    @Req() req: Request,
  ): Promise<RecoveryActionRecord> {
    return this.actions.finalize(user, recoveryActionId, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }
}

/**
 * Settlements addressed by their own id.
 *
 * A separate controller because the two acts here answer to a different
 * authority than the case surface: approving a settlement and completing it are
 * the approval authority's, not the officer's who proposed it (Scenario 44).
 * Scope still resolves through the case, so the confinement is identical.
 */
@Controller('recovery/settlements')
export class SettlementController {
  constructor(private readonly settlements: SettlementService) {}

  @Post(':settlementId/decide')
  @RequirePermissions(RECOVERY_SETTLEMENTS_APPROVE_PERMISSION)
  decide(
    @CurrentUser() user: AuthContext,
    @Param('settlementId', new ParseUUIDPipe({ version: '4' }))
    settlementId: string,
    @Body() dto: DecideSettlementDto,
    @Req() req: Request,
  ): Promise<SettlementRecord> {
    return this.settlements.decide(user, settlementId, dto, this.meta(req));
  }

  /**
   * Completing an approved settlement.
   *
   * The moment value moves: the forgiven principal is recognised as a loss and
   * the receivable retired. Behind the same approval authority as the decision,
   * because completing is what makes the waiver real.
   */
  @Post(':settlementId/complete')
  @RequirePermissions(RECOVERY_SETTLEMENTS_APPROVE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  complete(
    @CurrentUser() user: AuthContext,
    @Param('settlementId', new ParseUUIDPipe({ version: '4' }))
    settlementId: string,
    @Body() dto: DecideSettlementDto,
    @Req() req: Request,
  ): Promise<SettlementRecord> {
    return this.settlements.complete(user, settlementId, dto, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }
}
