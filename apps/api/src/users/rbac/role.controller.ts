import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  DeleteRoleResponse,
  RoleDetail,
  RoleListResponse,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { ListRolesDto } from './dto/list-roles.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { SetRoleStatusDto } from './dto/set-role-status.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import {
  ROLES_ACTIVATE_PERMISSION,
  ROLES_ASSIGN_PERMISSIONS_PERMISSION,
  ROLES_CREATE_PERMISSION,
  ROLES_DELETE_PERMISSION,
  ROLES_UPDATE_PERMISSION,
  ROLES_VIEW_PERMISSION,
  RoleService,
} from './role.service';

/**
 * Role & Permission Management.
 *
 * The permissions are split finely — `roles.view` / `.create` / `.update` /
 * `.delete` / `.activate` / `.assign_permissions` — for the same reason Module
 * 02 splits branch permissions: it lets the seed grant a Branch Admin the read
 * without any of the writes, which is what gives Scenarios 25, 37 and 40 an
 * account that reaches the screen and is refused the mutation. A single
 * `roles.manage` could not express that.
 *
 * `roles.assign_permissions` is deliberately separate from `roles.update`. The
 * difference between renaming a role and changing what it grants is the
 * difference between a cosmetic edit and an authorization change.
 */
@Controller('roles')
export class RoleController {
  constructor(private readonly roles: RoleService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /** Scenario 26. */
  @Get()
  @RequirePermissions(ROLES_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListRolesDto,
    @Req() req: Request,
  ): Promise<RoleListResponse> {
    const roles = await this.roles.list(user, query, this.meta(req));

    return { roles };
  }

  /** Scenarios 27, 28, 51, 59. */
  @Post()
  @RequirePermissions(ROLES_CREATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateRoleDto,
    @Req() req: Request,
  ): Promise<RoleDetail> {
    return this.roles.create(user, dto, this.meta(req));
  }

  /** Scenarios 26, 29 — the permission editor's read. */
  @Get(':roleId')
  @RequirePermissions(ROLES_VIEW_PERMISSION)
  async getById(
    @CurrentUser() user: AuthContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Req() req: Request,
  ): Promise<RoleDetail> {
    return this.roles.getById(user, roleId, this.meta(req));
  }

  /** Scenario 51. */
  @Patch(':roleId')
  @RequirePermissions(ROLES_UPDATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: Request,
  ): Promise<RoleDetail> {
    return this.roles.update(user, roleId, dto, this.meta(req));
  }

  /**
   * Assign Module Permissions — Scenarios 29, 38, 39, 40, 52, 57, 59.
   *
   * `PUT` because the body is the role's complete permission set afterwards, not
   * a delta. See SetRolePermissionsDto for why replacement beats add/remove.
   */
  @Put(':roleId/permissions')
  @RequirePermissions(ROLES_ASSIGN_PERMISSIONS_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async setPermissions(
    @CurrentUser() user: AuthContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: SetRolePermissionsDto,
    @Req() req: Request,
  ): Promise<RoleDetail> {
    return this.roles.setPermissions(user, roleId, dto, this.meta(req));
  }

  /**
   * Save & Activate, and its reverse — Scenarios 30, 41.
   *
   * A POST to its own sub-resource rather than a field on PATCH, so activation
   * carries its own permission and its own audit action. Throttled harder than
   * an ordinary edit because it changes what a whole set of users may do.
   */
  @Post(':roleId/status')
  @RequirePermissions(ROLES_ACTIVATE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setStatus(
    @CurrentUser() user: AuthContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: SetRoleStatusDto,
    @Req() req: Request,
  ): Promise<RoleDetail> {
    return this.roles.setStatus(user, roleId, dto, this.meta(req));
  }

  /**
   * Scenario 56.
   *
   * Returns 200 with a body rather than 204, so a refusal carrying `blockedBy`
   * and a success are both readable shapes on the same route.
   */
  @Delete(':roleId')
  @RequirePermissions(ROLES_DELETE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Req() req: Request,
  ): Promise<DeleteRoleResponse> {
    return this.roles.remove(user, roleId, this.meta(req));
  }
}
