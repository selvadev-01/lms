import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { LoanSchemeDetail, LoanSchemeSummary } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateLoanSchemeDto } from './dto/create-loan-scheme.dto';
import { ListLoanSchemesDto } from './dto/list-loan-schemes.dto';
import {
  CreateSchemeDurationDto,
  UpdateSchemeDurationDto,
} from './dto/scheme-duration.dto';
import { SetLoanConfigStatusDto } from './dto/set-loan-config-status.dto';
import { UpdateLoanSchemeDto } from './dto/update-loan-scheme.dto';
import {
  LOAN_SCHEMES_ACTIVATE_PERMISSION,
  LOAN_SCHEMES_MANAGE_PERMISSION,
  LOAN_SCHEMES_VIEW_PERMISSION,
  LoanSchemeService,
} from './loan-scheme.service';

/**
 * Module 06 — Loan Schemes and their duration options.
 *
 * Route order matters and is deliberate: `@Get()` and `@Post()` on the bare path
 * come before any `:schemeId` route, and the nested `durations` routes are
 * declared after the scheme routes they hang under. Nest matches in declaration
 * order, so a static segment placed after a parameterized one would be captured
 * by the parameter instead.
 */
@Controller('loan-schemes')
export class LoanSchemeController {
  constructor(private readonly schemes: LoanSchemeService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  @Get()
  @RequirePermissions(LOAN_SCHEMES_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListLoanSchemesDto,
    @Req() req: Request,
  ): Promise<{ schemes: LoanSchemeSummary[] }> {
    const schemes = await this.schemes.list(user, query, this.meta(req));

    return { schemes };
  }

  @Post()
  @RequirePermissions(LOAN_SCHEMES_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateLoanSchemeDto,
    @Req() req: Request,
  ): Promise<LoanSchemeDetail> {
    return this.schemes.create(user, dto, this.meta(req));
  }

  @Get(':schemeId')
  @RequirePermissions(LOAN_SCHEMES_VIEW_PERMISSION)
  async getById(
    @CurrentUser() user: AuthContext,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Req() req: Request,
  ): Promise<LoanSchemeDetail> {
    return this.schemes.getById(user, schemeId, this.meta(req));
  }

  @Patch(':schemeId')
  @RequirePermissions(LOAN_SCHEMES_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Body() dto: UpdateLoanSchemeDto,
    @Req() req: Request,
  ): Promise<LoanSchemeDetail> {
    return this.schemes.update(user, schemeId, dto, this.meta(req));
  }

  @Post(':schemeId/status')
  @RequirePermissions(LOAN_SCHEMES_ACTIVATE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setStatus(
    @CurrentUser() user: AuthContext,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Body() dto: SetLoanConfigStatusDto,
    @Req() req: Request,
  ): Promise<LoanSchemeDetail> {
    return this.schemes.setStatus(user, schemeId, dto, this.meta(req));
  }

  @Post(':schemeId/durations')
  @RequirePermissions(LOAN_SCHEMES_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async addDuration(
    @CurrentUser() user: AuthContext,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Body() dto: CreateSchemeDurationDto,
    @Req() req: Request,
  ): Promise<LoanSchemeDetail> {
    return this.schemes.addDuration(user, schemeId, dto, this.meta(req));
  }

  @Patch(':schemeId/durations/:durationId')
  @RequirePermissions(LOAN_SCHEMES_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async setDurationStatus(
    @CurrentUser() user: AuthContext,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Param('durationId', ParseUUIDPipe) durationId: string,
    @Body() dto: UpdateSchemeDurationDto,
    @Req() req: Request,
  ): Promise<LoanSchemeDetail> {
    return this.schemes.setDurationStatus(
      user,
      schemeId,
      durationId,
      dto,
      this.meta(req),
    );
  }

  @Delete(':schemeId/durations/:durationId')
  @RequirePermissions(LOAN_SCHEMES_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async removeDuration(
    @CurrentUser() user: AuthContext,
    @Param('schemeId', ParseUUIDPipe) schemeId: string,
    @Param('durationId', ParseUUIDPipe) durationId: string,
    @Req() req: Request,
  ): Promise<LoanSchemeDetail> {
    return this.schemes.removeDuration(
      user,
      schemeId,
      durationId,
      this.meta(req),
    );
  }
}
