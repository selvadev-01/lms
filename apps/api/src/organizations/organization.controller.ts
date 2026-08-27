import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { OrganizationDetail } from '@lms/types';

import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { SetStatusDto } from './dto/set-status.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import {
  ORGANIZATIONS_UPDATE_PERMISSION,
  ORGANIZATIONS_VIEW_PERMISSION,
  OrganizationService,
} from './organization.service';

/**
 * Company Settings.
 *
 * Every route is `/me` because a caller has exactly one organization: the one
 * their token names. There is no `/organizations/:id`, which is what makes
 * cross-tenant access (Scenario 37) structurally impossible rather than a check
 * that could be forgotten.
 *
 * No route is `@Public()`; the global JwtAuthGuard refuses an unauthenticated
 * caller before this class is reached, and PermissionsGuard refuses an
 * authenticated one lacking the permission (Scenarios 3, 8).
 */
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /** Scenarios 1, 2. */
  @Get('me')
  @RequirePermissions(ORGANIZATIONS_VIEW_PERMISSION)
  async getOwn(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
  ): Promise<OrganizationDetail> {
    return this.organizations.getOwn(user, this.meta(req));
  }

  /** Scenarios 6, 7, 8. */
  @Patch('me')
  @RequirePermissions(ORGANIZATIONS_UPDATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async updateOwn(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpdateOrganizationDto,
    @Req() req: Request,
  ): Promise<OrganizationDetail> {
    return this.organizations.updateOwn(user, dto, this.meta(req));
  }

  /**
   * Scenarios 10, 11, 12.
   *
   * POST rather than PATCH: a status change is a lifecycle event with its own
   * audit action and its own reason, not one more editable attribute.
   */
  @Post('me/status')
  @RequirePermissions(ORGANIZATIONS_UPDATE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setStatus(
    @CurrentUser() user: AuthContext,
    @Body() dto: SetStatusDto,
    @Req() req: Request,
  ): Promise<OrganizationDetail> {
    return this.organizations.setStatus(user, dto, this.meta(req));
  }
}
