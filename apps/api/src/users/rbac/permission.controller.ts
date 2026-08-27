import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { PermissionCatalogResponse } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  PERMISSIONS_VIEW_PERMISSION,
  PermissionService,
} from './permission.service';

/**
 * The permission catalog the role editor lists.
 *
 * Read-only: there is no create, update or delete, because a permission code
 * only means anything if the API's own `@RequirePermissions()` decorators name
 * it. A user-authored permission row would grant nothing, forever.
 */
@Controller('permissions')
export class PermissionController {
  constructor(private readonly permissions: PermissionService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /** Scenario 29 — what the permission editor renders. */
  @Get()
  @RequirePermissions(PERMISSIONS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
  ): Promise<PermissionCatalogResponse> {
    const permissions = await this.permissions.list(user, this.meta(req));

    return { permissions };
  }
}
