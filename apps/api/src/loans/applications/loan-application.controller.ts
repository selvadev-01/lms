import {
  Body,
  Controller,
  Delete,
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
  ApplicationCompleteness,
  ApprovalReadiness,
  EmiScheduleView,
  LoanApplicationDetail,
  LoanApplicationHistoryEntry,
  LoanApplicationSummary,
  SanctionLetterDetail,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  AcceptSanctionDto,
  ApplicationTransitionDto,
  ApproveAndIssueDto,
  ApproveApplicationDto,
  CreateLoanApplicationDto,
  DeclineSanctionDto,
  EmiPreviewDto,
  IssueSanctionDto,
  ListLoanApplicationsDto,
  ModifyTermsDto,
  RecordAgreementDto,
  RejectApplicationDto,
  RequestMoreInfoDto,
  UpdateLoanApplicationDto,
} from './dto/loan-application.dto';
import {
  APPLICATIONS_AGREEMENT_RECORD_PERMISSION,
  APPLICATIONS_SANCTION_ISSUE_PERMISSION,
  APPLICATIONS_SANCTION_RECORD_RESPONSE_PERMISSION,
  LoanSanctionService,
} from '../approval/loan-sanction.service';
import {
  APPLICATIONS_APPROVE_PERMISSION,
  APPLICATIONS_MODIFY_TERMS_PERMISSION,
  APPLICATIONS_REJECT_PERMISSION,
  APPLICATIONS_REVIEW_PERMISSION,
  LoanApplicationReviewService,
} from '../approval/loan-application-review.service';
import {
  APPLICATIONS_CREATE_PERMISSION,
  APPLICATIONS_DELETE_DRAFT_PERMISSION,
  APPLICATIONS_SUBMIT_PERMISSION,
  APPLICATIONS_VIEW_PERMISSION,
  LoanApplicationService,
} from './loan-application.service';

/**
 * Module 07 — Loan Applications.
 *
 * Route order is deliberate and load-bearing. `emi-preview` is declared before
 * every `:applicationId` route because Nest matches in declaration order: placed
 * after, the literal segment would be captured by the parameter and then fail
 * `ParseUUIDPipe` with a confusing 400 about a malformed id.
 *
 * The permissions here grant actions, not reach. Confinement to the caller's own
 * organization and branch is `LoanApplicationService`'s job, so a Branch Admin
 * holding `loans.applications.view` still sees only their own branch's
 * applications (Scenarios 3, 4).
 */
@Controller('loan-applications')
export class LoanApplicationController {
  constructor(
    private readonly applications: LoanApplicationService,
    private readonly reviews: LoanApplicationReviewService,
    private readonly sanctions: LoanSanctionService,
  ) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /**
   * Wizard step 4. Stateless — no application need exist yet, which is what lets
   * the wizard show a schedule before anything is persisted (D-APP-1).
   *
   * A POST rather than a GET because the input is a structured body; it creates
   * nothing and is safe to repeat.
   */
  @Post('emi-preview')
  @RequirePermissions(APPLICATIONS_VIEW_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  preview(@Body() dto: EmiPreviewDto): EmiScheduleView {
    return this.applications.preview(dto);
  }

  /** Scenarios 1, 3, 4. */
  @Get()
  @RequirePermissions(APPLICATIONS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListLoanApplicationsDto,
    @Req() req: Request,
  ): Promise<{ applications: LoanApplicationSummary[] }> {
    const applications = await this.applications.list(
      user,
      query,
      this.meta(req),
    );

    return { applications };
  }

  /** Scenarios 5, 41, 42, 43. */
  @Post()
  @RequirePermissions(APPLICATIONS_CREATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateLoanApplicationDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.applications.create(user, dto, this.meta(req));
  }

  /** Scenarios 2, 3, 4. */
  @Get(':applicationId')
  @RequirePermissions(APPLICATIONS_VIEW_PERMISSION)
  async getById(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.applications.getById(user, applicationId, this.meta(req));
  }

  /** Scenarios 14, 15. */
  @Patch(':applicationId')
  @RequirePermissions(APPLICATIONS_CREATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: UpdateLoanApplicationDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.applications.update(user, applicationId, dto, this.meta(req));
  }

  /** Scenario 36. Only a draft with no documents or review history. */
  @Delete(':applicationId')
  @RequirePermissions(APPLICATIONS_DELETE_DRAFT_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<{ applicationId: string; deleted: boolean }> {
    return this.applications.remove(user, applicationId, this.meta(req));
  }

  /** Wizard step 6's validation summary. Advisory — submit re-runs every check. */
  @Get(':applicationId/completeness')
  @RequirePermissions(APPLICATIONS_VIEW_PERMISSION)
  async completeness(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<ApplicationCompleteness> {
    return this.applications.completenessFor(
      user,
      applicationId,
      this.meta(req),
    );
  }

  /**
   * Module 08 Scenarios 6, 13 — what is still standing between this
   * application and approval. Advisory; `approve` re-runs every check.
   */
  @Get(':applicationId/approval-readiness')
  @RequirePermissions(APPLICATIONS_VIEW_PERMISSION)
  async approvalReadiness(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<ApprovalReadiness> {
    return this.reviews.approvalReadiness(user, applicationId, this.meta(req));
  }

  /** Module 08 — the issued sanction letter, or a 404. */
  @Get(':applicationId/sanction')
  @RequirePermissions(APPLICATIONS_VIEW_PERMISSION)
  async sanction(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<SanctionLetterDetail> {
    return this.sanctions.get(user, applicationId, this.meta(req));
  }

  /** Scenario 60 — the append-only review and terms-change history. */
  @Get(':applicationId/history')
  @RequirePermissions(APPLICATIONS_VIEW_PERMISSION)
  async history(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<{ history: LoanApplicationHistoryEntry[] }> {
    const history = await this.reviews.history(
      user,
      applicationId,
      this.meta(req),
    );

    return { history };
  }

  /** T3/T6 — Scenarios 5, 21, 23. */
  @Post(':applicationId/submit')
  @RequirePermissions(APPLICATIONS_SUBMIT_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async submit(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: ApplicationTransitionDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.applications.submit(
      user,
      applicationId,
      dto.expectedVersion,
      this.meta(req),
    );
  }

  /** T4 — an explicit claim on an application, not implicit on read. */
  @Post(':applicationId/start-review')
  @RequirePermissions(APPLICATIONS_REVIEW_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async startReview(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: ApplicationTransitionDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.reviews.startReview(
      user,
      applicationId,
      dto.expectedVersion,
      this.meta(req),
    );
  }

  /** T5 — Scenario 22. */
  @Post(':applicationId/request-info')
  @RequirePermissions(APPLICATIONS_REVIEW_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async requestInfo(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: RequestMoreInfoDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.reviews.requestMoreInfo(
      user,
      applicationId,
      dto,
      this.meta(req),
    );
  }

  /** T7 — Scenario 16. */
  @Post(':applicationId/modify-terms')
  @RequirePermissions(APPLICATIONS_MODIFY_TERMS_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async modifyTerms(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: ModifyTermsDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.reviews.modifyTerms(user, applicationId, dto, this.meta(req));
  }

  /** T8 — Scenarios 25, 28, 30. Approval does not disburse. */
  @Post(':applicationId/approve')
  @RequirePermissions(APPLICATIONS_APPROVE_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async approve(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: ApproveApplicationDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.reviews.approve(user, applicationId, dto, this.meta(req));
  }

  /** T9/T10 — Scenarios 26, 27, 29. */
  @Post(':applicationId/reject')
  @RequirePermissions(APPLICATIONS_REJECT_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async reject(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: RejectApplicationDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.reviews.reject(user, applicationId, dto, this.meta(req));
  }

  /** T11 — Module 08 Scenarios 30, 31. Approval alone does not disburse. */
  @Post(':applicationId/sanction')
  @RequirePermissions(APPLICATIONS_SANCTION_ISSUE_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async issueSanction(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: IssueSanctionDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.sanctions.issue(user, applicationId, dto, this.meta(req));
  }

  /**
   * T8 then T11 in one request, for a caller who may do both.
   *
   * Requires **both** grants, so it adds no authority: someone who may only
   * approve, or only issue, keeps using the two routes above. Those remain the
   * primitives — this is a convenience that calls them in order.
   */
  @Post(':applicationId/approve-and-sanction')
  @RequirePermissions(
    APPLICATIONS_APPROVE_PERMISSION,
    APPLICATIONS_SANCTION_ISSUE_PERMISSION,
  )
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async approveAndSanction(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: ApproveAndIssueDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.sanctions.approveAndIssue(
      user,
      applicationId,
      dto,
      this.meta(req),
    );
  }

  /** T12 — Module 08 Scenario 33. */
  @Post(':applicationId/sanction/accept')
  @RequirePermissions(APPLICATIONS_SANCTION_RECORD_RESPONSE_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async acceptSanction(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: AcceptSanctionDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.sanctions.accept(user, applicationId, dto, this.meta(req));
  }

  /** T13 — Module 08 Scenario 32. Lands on the unified REJECTED (Rule 13). */
  @Post(':applicationId/sanction/decline')
  @RequirePermissions(APPLICATIONS_SANCTION_RECORD_RESPONSE_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async declineSanction(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: DeclineSanctionDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.sanctions.decline(user, applicationId, dto, this.meta(req));
  }

  /** T14 — Module 08 Scenarios 33, 34. Disbursal itself is Module 09's. */
  @Post(':applicationId/agreement')
  @RequirePermissions(APPLICATIONS_AGREEMENT_RECORD_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async recordAgreement(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: RecordAgreementDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDetail> {
    return this.sanctions.recordAgreement(
      user,
      applicationId,
      dto,
      this.meta(req),
    );
  }
}
