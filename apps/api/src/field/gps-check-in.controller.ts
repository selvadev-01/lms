import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  CheckInHistoryResponse,
  CheckInStatusResponse,
  SubmitCheckInResponse,
} from '@lms/types';

import type { RequestMeta } from '../auth/auth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthContext } from '../common/auth-context';
import { ReportFailureDto } from './dto/report-failure.dto';
import { SubmitCheckInDto } from './dto/submit-check-in.dto';
import {
  FIELD_CHECKIN_PERMISSION,
  FIELD_CHECKIN_VIEW_PERMISSION,
  GpsCheckInService,
} from './gps-check-in.service';

/**
 * Field Employee GPS check-in.
 *
 * No route here is `@Public()`. The global JwtAuthGuard denies by default, so
 * an unauthenticated caller is refused before reaching this class — which is
 * what satisfies Scenario 2 without a check of its own.
 *
 * `field.checkin` is held by Field Employees only and `field.checkin.view` by
 * administrators only, so an authenticated admin attempting a check-in is
 * refused by PermissionsGuard (Scenarios 3, 30) and a Field Employee cannot
 * read a colleague's history.
 */
@Controller('field/check-in')
export class GpsCheckInController {
  constructor(private readonly checkIns: GpsCheckInService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /**
   * Submits a location for verification (Scenarios 4, 9-12, 21).
   *
   * 201 for both a verified and a failed attempt: in each case a check-in
   * record was created, and the outcome is in the body. A failed verification
   * is a recorded result, not a malformed request, and returning 4xx would lose
   * the distinction between "your location was rejected" and "your request was
   * wrong".
   *
   * The throttle is generous because retrying after a GPS failure is expected
   * behaviour (Scenario 13), not abuse.
   */
  @Post()
  @RequirePermissions(FIELD_CHECKIN_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  async submit(
    @CurrentUser() user: AuthContext,
    @Body() dto: SubmitCheckInDto,
    @Req() req: Request,
  ): Promise<SubmitCheckInResponse> {
    return this.checkIns.submitCheckIn(user, dto, this.meta(req));
  }

  /**
   * Records a device-reported failure that never produced a position
   * (Scenarios 6-8, 11, 12).
   *
   * 202: the report is accepted and durably recorded, but nothing was verified.
   * A slightly higher limit than `submit` because a denied permission can
   * produce several rapid reports as the user retries.
   */
  @Post('failure')
  @RequirePermissions(FIELD_CHECKIN_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  async reportFailure(
    @CurrentUser() user: AuthContext,
    @Body() dto: ReportFailureDto,
    @Req() req: Request,
  ): Promise<SubmitCheckInResponse> {
    return this.checkIns.reportFailure(user, dto, this.meta(req));
  }

  /** Whether the caller may proceed into field operations now (Scenario 5). */
  @Get('status')
  @RequirePermissions(FIELD_CHECKIN_PERMISSION)
  async status(
    @CurrentUser() user: AuthContext,
  ): Promise<CheckInStatusResponse> {
    return this.checkIns.getCurrentStatus(user);
  }

  /**
   * The caller's own check-in history.
   *
   * Declared before `history/:userId` so the literal segment is not captured by
   * the parameterized route.
   */
  @Get('history')
  @RequirePermissions(FIELD_CHECKIN_PERMISSION)
  async ownHistory(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
  ): Promise<CheckInHistoryResponse> {
    const checkIns = await this.checkIns.listHistory(
      user,
      undefined,
      this.meta(req),
    );

    return { checkIns };
  }

  /**
   * Another user's check-in history (Q-GPS-14).
   *
   * The permission grants the action; GpsCheckInService enforces the reach it
   * cannot express — a Branch Admin sees only their own branch, and no one sees
   * another tenant.
   */
  @Get('history/:userId')
  @RequirePermissions(FIELD_CHECKIN_VIEW_PERMISSION)
  async userHistory(
    @CurrentUser() user: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ): Promise<CheckInHistoryResponse> {
    const checkIns = await this.checkIns.listHistory(
      user,
      userId,
      this.meta(req),
    );

    return { checkIns };
  }
}
