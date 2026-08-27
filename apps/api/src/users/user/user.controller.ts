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
  DeleteUserResponse,
  UserDetail,
  UserListResponse,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AssignRolesDto } from '../rbac/dto/assign-roles.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { SetUserStatusDto } from './dto/set-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  USERS_ACTIVATE_PERMISSION,
  USERS_ASSIGN_ROLE_PERMISSION,
  USERS_CREATE_PERMISSION,
  USERS_DELETE_PERMISSION,
  USERS_UPDATE_PERMISSION,
  USERS_VIEW_PERMISSION,
  UserService,
} from './user.service';

/**
 * Admin Management — "Create & Manage Admins" from the Super Admin flow.
 *
 * Every handler passes the `'USER'` surface, which confines this controller to
 * records with no `employeeCode`. The employee controller passes `'EMPLOYEE'` and
 * sees the complement. That is what lets a Branch Admin hold `employees.view`
 * without thereby being able to read an administrator's record (Scenarios 22, 25)
 * even though both live in the `users` table.
 */
@Controller('users')
export class UserController {
  constructor(private readonly users: UserService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /** Scenarios 1, 4. */
  @Get()
  @RequirePermissions(USERS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListUsersDto,
    @Req() req: Request,
  ): Promise<UserListResponse> {
    const users = await this.users.list(user, 'USER', query, this.meta(req));

    return { users };
  }

  /** Scenarios 2, 3, 4, 48, 58. */
  @Post()
  @RequirePermissions(USERS_CREATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateUserDto,
    @Req() req: Request,
  ): Promise<UserDetail> {
    return this.users.create(user, 'USER', dto, this.meta(req));
  }

  /** Scenarios 5, 23. */
  @Get(':userId')
  @RequirePermissions(USERS_VIEW_PERMISSION)
  async getById(
    @CurrentUser() user: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ): Promise<UserDetail> {
    return this.users.getById(user, 'USER', userId, this.meta(req));
  }

  /** Scenarios 5, 6, 7. */
  @Patch(':userId')
  @RequirePermissions(USERS_UPDATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ): Promise<UserDetail> {
    return this.users.update(user, 'USER', userId, dto, this.meta(req));
  }

  /**
   * Scenarios 34, 35, 36, 37.
   *
   * `PUT` because the body is the user's complete role set afterwards. Its own
   * permission, because granting a role is an authorization change rather than a
   * profile edit.
   */
  @Put(':userId/roles')
  @RequirePermissions(USERS_ASSIGN_ROLE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async assignRoles(
    @CurrentUser() user: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AssignRolesDto,
    @Req() req: Request,
  ): Promise<UserDetail> {
    return this.users.assignRoles(user, userId, dto, this.meta(req));
  }

  /** Scenarios 8, 12, 13, 49. */
  @Post(':userId/status')
  @RequirePermissions(USERS_ACTIVATE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setStatus(
    @CurrentUser() user: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetUserStatusDto,
    @Req() req: Request,
  ): Promise<UserDetail> {
    return this.users.setStatus(user, 'USER', userId, dto, this.meta(req));
  }

  /**
   * Scenario 54.
   *
   * Returns 200 with a body rather than 204, so a success and a 409 carrying
   * `blockedBy` are both readable shapes on the same route.
   */
  @Delete(':userId')
  @RequirePermissions(USERS_DELETE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ): Promise<DeleteUserResponse> {
    return this.users.remove(user, 'USER', userId, this.meta(req));
  }
}
