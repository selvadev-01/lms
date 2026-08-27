import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { GuarantorSummary } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ReviewGuarantorKycDto } from './dto/review-guarantor-kyc.dto';
import { SubmitGuarantorKycDto } from './dto/submit-guarantor-kyc.dto';
import {
  CUSTOMERS_GUARANTORS_KYC_REVIEW_PERMISSION,
  GuarantorKycService,
} from './guarantor-kyc.service';
import { CUSTOMERS_GUARANTORS_MANAGE_PERMISSION } from './guarantor.service';

/**
 * Guarantor KYC review (Module 05 Scenarios 20-25).
 *
 * Two routes, two authorities. Submitting is part of assembling the guarantor's
 * record, so it rides on `customers.guarantors.manage` — whoever may add a
 * guarantor may put their paperwork forward. Reviewing is a separate permission
 * because Scenario 25 needs a role that can do the first and is refused the
 * second; a branch preparing a pack must not be able to approve its own.
 *
 * `customers.guarantors.kyc.review` is deliberately not `customers.kyc.approve`.
 * Q-GUAR-13 asks whether a different role approves guarantor KYC and the source
 * does not answer, so the codes stay apart and the answer becomes a seed change.
 */
@Controller('customers/:customerId/guarantors/:guarantorId/kyc')
export class GuarantorKycController {
  constructor(private readonly kyc: GuarantorKycService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /** Scenario 20 — puts the assembled pack forward for review. */
  @Post('submit')
  @RequirePermissions(CUSTOMERS_GUARANTORS_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async submit(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Body() dto: SubmitGuarantorKycDto,
    @Req() req: Request,
  ): Promise<GuarantorSummary> {
    return this.kyc.submit(user, customerId, guarantorId, dto, this.meta(req));
  }

  /** Scenarios 21, 23, 24 — approve, reject, or send back for revision. */
  @Post('review')
  @RequirePermissions(CUSTOMERS_GUARANTORS_KYC_REVIEW_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async review(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Body() dto: ReviewGuarantorKycDto,
    @Req() req: Request,
  ): Promise<GuarantorSummary> {
    return this.kyc.review(user, customerId, guarantorId, dto, this.meta(req));
  }
}
