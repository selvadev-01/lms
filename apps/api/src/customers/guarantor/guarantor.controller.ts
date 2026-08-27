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
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  DeleteGuarantorResponse,
  GuarantorDeleteBlockedResponse,
  GuarantorReadiness,
  GuarantorSummary,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateGuarantorDto } from './dto/create-guarantor.dto';
import { DeactivateGuarantorDto } from './dto/deactivate-guarantor.dto';
import { ReactivateGuarantorDto } from './dto/reactivate-guarantor.dto';
import { RecordConsentDto } from '../shared/dto/record-consent.dto';
import { UpdateGuarantorDto } from './dto/update-guarantor.dto';
import {
  CUSTOMERS_GUARANTORS_DEACTIVATE_PERMISSION,
  CUSTOMERS_GUARANTORS_DELETE_PERMISSION,
  CUSTOMERS_GUARANTORS_MANAGE_PERMISSION,
  CUSTOMERS_GUARANTORS_VIEW_PERMISSION,
  GuarantorService,
} from './guarantor.service';

/**
 * Guarantors (Module 04, Scenarios 24-26).
 *
 * Nested under the customer for the same reason the KYC routes are: the scope
 * rule lives on the customer, so a guarantor must never be reachable without
 * naming one the caller can already see.
 *
 * View and manage are separate permissions because a Field Employee may
 * legitimately need to see who guaranteed a loan they are collecting on without
 * being able to change it.
 */
@Controller('customers/:customerId/guarantors')
export class GuarantorController {
  constructor(private readonly guarantors: GuarantorService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  @Get()
  @RequirePermissions(CUSTOMERS_GUARANTORS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Req() req: Request,
  ): Promise<{ guarantors: GuarantorSummary[] }> {
    const guarantors = await this.guarantors.list(
      user,
      customerId,
      this.meta(req),
    );

    return { guarantors };
  }

  /**
   * The loan-application guarantor gate (Scenarios 41-43).
   *
   * **Declared before `GET :guarantorId` on purpose.** Nest matches routes in
   * declaration order, so with the parameterized route first, `readiness` would
   * be captured as a `guarantorId` and rejected by `ParseUUIDPipe` as a
   * malformed id — a 400 on a route that exists.
   */
  @Get('readiness')
  @RequirePermissions(CUSTOMERS_GUARANTORS_VIEW_PERMISSION)
  async readiness(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Req() req: Request,
  ): Promise<GuarantorReadiness> {
    return this.guarantors.evaluateReadiness(user, customerId, this.meta(req));
  }

  /** Scenario 2. */
  @Get(':guarantorId')
  @RequirePermissions(CUSTOMERS_GUARANTORS_VIEW_PERMISSION)
  async findOne(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Req() req: Request,
  ): Promise<GuarantorSummary> {
    return this.guarantors.findOne(
      user,
      customerId,
      guarantorId,
      this.meta(req),
    );
  }

  /** Scenarios 6, 10. */
  @Post()
  @RequirePermissions(CUSTOMERS_GUARANTORS_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: CreateGuarantorDto,
    @Req() req: Request,
  ): Promise<GuarantorSummary> {
    return this.guarantors.create(user, customerId, dto, this.meta(req));
  }

  @Patch(':guarantorId')
  @RequirePermissions(CUSTOMERS_GUARANTORS_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Body() dto: UpdateGuarantorDto,
    @Req() req: Request,
  ): Promise<GuarantorSummary> {
    return this.guarantors.update(
      user,
      customerId,
      guarantorId,
      dto,
      this.meta(req),
    );
  }

  /**
   * Scenario 28 — deactivation, the supported alternative to a blocked delete.
   *
   * Its own permission rather than `.manage`: Scenario 29 needs a role that can
   * edit a guarantor and is refused this specific action.
   */
  @Post(':guarantorId/deactivate')
  @RequirePermissions(CUSTOMERS_GUARANTORS_DEACTIVATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async deactivate(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Body() dto: DeactivateGuarantorDto,
    @Req() req: Request,
  ): Promise<GuarantorSummary> {
    return this.guarantors.deactivate(
      user,
      customerId,
      guarantorId,
      dto,
      this.meta(req),
    );
  }

  @Post(':guarantorId/reactivate')
  @RequirePermissions(CUSTOMERS_GUARANTORS_DEACTIVATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async reactivate(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Body() dto: ReactivateGuarantorDto,
    @Req() req: Request,
  ): Promise<GuarantorSummary> {
    return this.guarantors.reactivate(
      user,
      customerId,
      guarantorId,
      dto,
      this.meta(req),
    );
  }

  /** Scenario 25 — consent and its timestamp. */
  @Post(':guarantorId/consent')
  @RequirePermissions(CUSTOMERS_GUARANTORS_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async recordConsent(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Body() dto: RecordConsentDto,
    @Req() req: Request,
  ): Promise<GuarantorSummary> {
    return this.guarantors.recordConsent(
      user,
      customerId,
      guarantorId,
      dto,
      this.meta(req),
    );
  }

  /**
   * Scenarios 31-33 — deletion, blocked when a loan references the guarantor.
   *
   * Answers 200 with `deleted: false` and the blockers rather than throwing a
   * 409, matching `CustomerController.remove` and the Module 03 precedent: the
   * blocked and successful shapes are then the same readable object, and the UI
   * can render "cannot delete because…" without parsing an error body.
   *
   * Its own permission rather than `.manage`, so Scenario 40 has a role that
   * reaches the screen and is refused exactly this.
   */
  @Delete(':guarantorId')
  @RequirePermissions(CUSTOMERS_GUARANTORS_DELETE_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Req() req: Request,
  ): Promise<DeleteGuarantorResponse | GuarantorDeleteBlockedResponse> {
    const outcome = await this.guarantors.remove(
      user,
      customerId,
      guarantorId,
      this.meta(req),
    );

    if (!outcome.deleted) {
      return {
        message:
          'This guarantor is referenced by a loan and cannot be deleted. Deactivate them instead.',
        blockedBy: outcome.blockedBy,
      };
    }

    return { guarantorId, deleted: true };
  }
}
