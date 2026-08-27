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
import type { KycRecord } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import {
  CUSTOMERS_KYC_APPROVE_PERMISSION,
  CUSTOMERS_KYC_SUBMIT_PERMISSION,
  CUSTOMERS_KYC_VIEW_PERMISSION,
  KycService,
} from './kyc.service';

/**
 * KYC review (Module 04, Scenarios 6-12).
 *
 * Nested under the customer rather than exposed as `/kyc/:kycId`, and that is a
 * security decision rather than a REST preference: a flat route would let a
 * caller reach a KYC record by its own id, and the scope rule lives on the
 * customer. With this shape, every request must name a customer the caller can
 * already reach before the KYC record is looked at.
 *
 * Submit and approve are separate permissions because they are separate
 * authorities. A branch clerk assembles and submits the pack; the Branch Admin
 * decides (Rule 9, Scenario 10). One permission for both would make the
 * source-named approval authority unenforceable.
 */
@Controller('customers/:customerId/kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  @Get()
  @RequirePermissions(CUSTOMERS_KYC_VIEW_PERMISSION)
  async get(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Req() req: Request,
  ): Promise<KycRecord> {
    return this.kyc.get(user, customerId, this.meta(req));
  }

  /** Scenario 6 — the assembled pack goes to review. */
  @Post('submit')
  @RequirePermissions(CUSTOMERS_KYC_SUBMIT_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async submit(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: SubmitKycDto,
    @Req() req: Request,
  ): Promise<KycRecord> {
    return this.kyc.submit(user, customerId, dto, this.meta(req));
  }

  /**
   * Scenarios 8, 9, 10 — approve, reject, or return for revision.
   *
   * One endpoint for all three decisions rather than three, because they are one
   * transition with different outcomes and share every precondition: the same
   * version check, the same already-approved guard, the same audit shape.
   */
  @Post('review')
  @RequirePermissions(CUSTOMERS_KYC_APPROVE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async review(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: ReviewKycDto,
    @Req() req: Request,
  ): Promise<KycRecord> {
    return this.kyc.review(user, customerId, dto, this.meta(req));
  }
}
