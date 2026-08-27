import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { GuarantorProfileResponse, GuarantorSummary } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ListGuarantorsDto } from './dto/list-guarantors.dto';
import { GuarantorDirectoryService } from './guarantor-directory.service';
import { CUSTOMERS_GUARANTORS_VIEW_PERMISSION } from './guarantor.service';

/**
 * The organization-scoped guarantor directory (GUA-001, GUA-002).
 *
 * **Read-only by design.** Every write stays on the customer-nested routes: see
 * `GuarantorDirectoryService` for why a top-level mutation would turn the scope
 * check into something a maintainer has to remember rather than something the
 * route shape guarantees.
 *
 * Gated on `customers.guarantors.view`, which existed before this module and was
 * never reachable from any screen — the guarantor list lived only as a tab
 * inside a customer profile. This is the surface that permission was always
 * describing.
 */
@Controller('guarantors')
export class GuarantorDirectoryController {
  constructor(private readonly directory: GuarantorDirectoryService) {}

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
    @Query() query: ListGuarantorsDto,
    @Req() req: Request,
  ): Promise<{ guarantors: GuarantorSummary[] }> {
    const guarantors = await this.directory.list(user, query, this.meta(req));

    return { guarantors };
  }

  @Get(':guarantorId')
  @RequirePermissions(CUSTOMERS_GUARANTORS_VIEW_PERMISSION)
  async findOne(
    @CurrentUser() user: AuthContext,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Req() req: Request,
  ): Promise<GuarantorProfileResponse> {
    return this.directory.findOne(user, guarantorId, this.meta(req));
  }
}
