import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  CreditAssessmentDetail,
  CreditAssessmentHistory,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  APPLICATIONS_ASSESSMENT_RECORD_PERMISSION,
  APPLICATIONS_ASSESSMENT_VIEW_PERMISSION,
  CreditAssessmentService,
} from './credit-assessment.service';
import { RecordCreditAssessmentDto } from '../applications/dto/loan-application.dto';

/**
 * Module 08 — credit assessment (Scenarios 7, 8, 9).
 *
 * A separate controller rather than more routes on `LoanApplicationController`,
 * following `LoanApplicationDocumentController`'s precedent and for the same
 * reason: these two permissions are genuinely independent of the application's
 * own, so a reviewer can be entitled to see an application without being
 * entitled to see the borrower's CIBIL score.
 *
 * Scope still resolves through the application — an out-of-branch id is a 404
 * before any assessment row is read.
 */
@Controller('loan-applications/:applicationId/credit-assessment')
export class CreditAssessmentController {
  constructor(private readonly assessments: CreditAssessmentService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /** Scenario 7 — the current assessment and every superseded one. */
  @Get()
  @RequirePermissions(APPLICATIONS_ASSESSMENT_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<CreditAssessmentHistory> {
    return this.assessments.list(user, applicationId, this.meta(req));
  }

  /** Scenarios 7, 9 — supersedes whatever was current; never edits it. */
  @Post()
  @RequirePermissions(APPLICATIONS_ASSESSMENT_RECORD_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async record(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: RecordCreditAssessmentDto,
    @Req() req: Request,
  ): Promise<CreditAssessmentDetail> {
    return this.assessments.record(user, applicationId, dto, this.meta(req));
  }
}
