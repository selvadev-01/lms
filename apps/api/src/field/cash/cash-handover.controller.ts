import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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
  AgentCashBalance,
  CashHandoverDetail,
  CashHandoverListResult,
  CashHandoverReadiness,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CashCustodyService } from './cash-custody.service';
import {
  CASH_HANDOVERS_RECEIVE_PERMISSION,
  CASH_HANDOVERS_REVERSE_PERMISSION,
  CASH_HANDOVERS_SUBMIT_PERMISSION,
  CASH_HANDOVERS_VIEW_PERMISSION,
  CashHandoverService,
} from './cash-handover.service';
import {
  CreateCashHandoverDto,
  ListCashHandoversDto,
  ReceiveCashHandoverDto,
  ReverseCashHandoverDto,
  SubmitCashHandoverDto,
} from './dto/cash-handover.dto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Module 12 — cash handover.
 *
 * # Two idempotency conventions, on purpose
 *
 * `POST /` takes its key in the **body**: the key identifies the handover being
 * created, and the client mints it before the row exists.
 * `POST /:id/receive` takes an **`Idempotency-Key` header**: it identifies a
 * retry of an operation against a row that already exists. That is the split
 * Modules 09/11 and Module 14 already draw, and following it means a reader who
 * knows one knows both.
 *
 * # Route order
 *
 * `readiness` and `agents` are literals and must precede `:handoverId`, or a
 * GET to `/field/cash-handovers/readiness` would resolve as a handover whose id
 * is "readiness". The API's e2e spec asserts this.
 *
 * # No delete route
 *
 * `cash_handovers_append_only` refuses a delete on anything past CREATED, and
 * the custody trail is retained (Rules 28, 29; Scenario 35).
 */
@Controller('field/cash-handovers')
export class CashHandoverController {
  constructor(
    private readonly handovers: CashHandoverService,
    private readonly custody: CashCustodyService,
  ) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /**
   * A retry without a key cannot be recognised as a retry, so accepting one
   * would risk a duplicate custody posting.
   */
  private requireIdempotencyKey(value: string | undefined): string {
    if (!value || !UUID_PATTERN.test(value)) {
      throw new BadRequestException(
        'An Idempotency-Key header containing a UUID is required for this operation.',
      );
    }
    return value;
  }

  /** What the calling agent can hand over right now. Literal route. */
  @Get('readiness')
  @RequirePermissions(CASH_HANDOVERS_VIEW_PERMISSION)
  readiness(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
  ): Promise<CashHandoverReadiness> {
    return this.handovers.readiness(user, this.meta(req));
  }

  /**
   * Every agent in scope who is holding cash — the branch's work list.
   *
   * Literal route. Gated on `receive` rather than `view`: this is a
   * cross-agent read, and an agent has no business seeing what their
   * colleagues are carrying.
   */
  @Get('agents')
  @RequirePermissions(CASH_HANDOVERS_RECEIVE_PERMISSION)
  agents(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
  ): Promise<AgentCashBalance[]> {
    return this.custody.agentBalances(user, this.meta(req));
  }

  @Get()
  @RequirePermissions(CASH_HANDOVERS_VIEW_PERMISSION)
  list(
    @CurrentUser() user: AuthContext,
    @Query() dto: ListCashHandoversDto,
    @Req() req: Request,
  ): Promise<CashHandoverListResult> {
    return this.handovers.list(user, dto, this.meta(req));
  }

  /** Create a draft handover. 200, not 201: a replay returns the original. */
  @Post()
  @HttpCode(200)
  @RequirePermissions(CASH_HANDOVERS_SUBMIT_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateCashHandoverDto,
    @Req() req: Request,
  ): Promise<CashHandoverDetail> {
    return this.handovers.create(user, dto, this.meta(req));
  }

  @Get(':handoverId')
  @RequirePermissions(CASH_HANDOVERS_VIEW_PERMISSION)
  detail(
    @CurrentUser() user: AuthContext,
    @Param('handoverId', new ParseUUIDPipe({ version: '4' }))
    handoverId: string,
    @Req() req: Request,
  ): Promise<CashHandoverDetail> {
    return this.handovers.getDetail(user, handoverId, this.meta(req));
  }

  @Post(':handoverId/submit')
  @HttpCode(200)
  @RequirePermissions(CASH_HANDOVERS_SUBMIT_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  submit(
    @CurrentUser() user: AuthContext,
    @Param('handoverId', new ParseUUIDPipe({ version: '4' }))
    handoverId: string,
    @Body() dto: SubmitCashHandoverDto,
    @Req() req: Request,
  ): Promise<CashHandoverDetail> {
    return this.handovers.submit(user, handoverId, dto, this.meta(req));
  }

  /**
   * Receive the cash at the branch — the act that posts the custody journal.
   *
   * Withheld from Field Employees: one person holding both sides of a transfer
   * could sign for cash they never handed over.
   */
  @Post(':handoverId/receive')
  @HttpCode(200)
  @RequirePermissions(CASH_HANDOVERS_RECEIVE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  receive(
    @CurrentUser() user: AuthContext,
    @Param('handoverId', new ParseUUIDPipe({ version: '4' }))
    handoverId: string,
    @Body() dto: ReceiveCashHandoverDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ): Promise<CashHandoverDetail> {
    return this.handovers.receive(
      user,
      handoverId,
      dto,
      this.requireIdempotencyKey(idempotencyKey),
      this.meta(req),
    );
  }

  /**
   * Reverse a received handover.
   *
   * Withheld from Branch Admin: it unwinds a committed custody journal, on the
   * same footing as `collections.reverse`.
   */
  @Post(':handoverId/reverse')
  @HttpCode(200)
  @RequirePermissions(CASH_HANDOVERS_REVERSE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reverse(
    @CurrentUser() user: AuthContext,
    @Param('handoverId', new ParseUUIDPipe({ version: '4' }))
    handoverId: string,
    @Body() dto: ReverseCashHandoverDto,
    @Req() req: Request,
  ): Promise<CashHandoverDetail> {
    return this.handovers.reverse(user, handoverId, dto, this.meta(req));
  }
}
