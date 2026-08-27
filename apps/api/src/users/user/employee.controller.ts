import {
  Body,
  Controller,
  Delete,
  Get,
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
  DeleteUserResponse,
  UserDetail,
  UserListResponse,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AssignEmployeeDto } from './dto/assign-employee.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { SetUserStatusDto } from './dto/set-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  EMPLOYEES_ACTIVATE_PERMISSION,
  EMPLOYEES_ASSIGN_PERMISSION,
  EMPLOYEES_CREATE_PERMISSION,
  EMPLOYEES_DELETE_PERMISSION,
  EMPLOYEES_UPDATE_PERMISSION,
  EMPLOYEES_VIEW_PERMISSION,
  UserService,
} from './user.service';

/**
 * Employee Management — "Add, Assign, Deactivate" from the Super Admin flow, and
 * the Branch Admin dashboard's employee area.
 *
 * The same service as `UserController`, over the same table, distinguished by the
 * `'EMPLOYEE'` surface: these routes see only records carrying an
 * `employeeCode`. Two permission families over one table is what makes Scenarios
 * 22 and 25 expressible — a Branch Admin who reaches Employee Management and is
 * refused Admin Management.
 *
 * Q-RBAC-21 is answered by the seed rather than here: a Branch Admin is granted
 * `employees.view` and `employees.activate` but not `create` or `assign`, so the
 * story's undefined Branch Admin action set starts restricted and can be widened
 * without a code change.
 */
@Controller('employees')
export class EmployeeController {
  constructor(private readonly users: UserService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /**
   * Scenarios 14, 20, 22, 53.
   *
   * `?activeOnly=true&roleCode=FIELD_EMPLOYEE` is what the field-collection
   * assignment selector calls: a deactivated employee must not be offered for new
   * work. The eventual assignment write must re-check — the selector is a
   * convenience, not the control.
   */
  @Get()
  @RequirePermissions(EMPLOYEES_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListUsersDto,
    @Req() req: Request,
  ): Promise<UserListResponse> {
    const users = await this.users.list(
      user,
      'EMPLOYEE',
      query,
      this.meta(req),
    );

    return { users };
  }

  /** Scenarios 15, 16. */
  @Post()
  @RequirePermissions(EMPLOYEES_CREATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateEmployeeDto,
    @Req() req: Request,
  ): Promise<UserDetail> {
    return this.users.create(user, 'EMPLOYEE', dto, this.meta(req));
  }

  /** Scenarios 22, 23. */
  @Get(':userId')
  @RequirePermissions(EMPLOYEES_VIEW_PERMISSION)
  async getById(
    @CurrentUser() user: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ): Promise<UserDetail> {
    return this.users.getById(user, 'EMPLOYEE', userId, this.meta(req));
  }

  /** Scenarios 5, 25. */
  @Patch(':userId')
  @RequirePermissions(EMPLOYEES_UPDATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ): Promise<UserDetail> {
    return this.users.update(user, 'EMPLOYEE', userId, dto, this.meta(req));
  }

  /**
   * "Assign" from the source-defined Add / Assign / Deactivate — Scenarios 17,
   * 18, 19, 50, 60.
   *
   * Q-RBAC-4 asked what Assign assigns; this answers "branch", the only target
   * the source proves is a scope concept. Field-collection assignment is a
   * separate Branch Admin flow and stays there.
   */
  @Post(':userId/assignment')
  @RequirePermissions(EMPLOYEES_ASSIGN_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async assign(
    @CurrentUser() user: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AssignEmployeeDto,
    @Req() req: Request,
  ): Promise<UserDetail> {
    return this.users.assign(user, userId, dto, this.meta(req));
  }

  /** Scenarios 10, 11, 20, 21, 53. */
  @Post(':userId/status')
  @RequirePermissions(EMPLOYEES_ACTIVATE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setStatus(
    @CurrentUser() user: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetUserStatusDto,
    @Req() req: Request,
  ): Promise<UserDetail> {
    return this.users.setStatus(user, 'EMPLOYEE', userId, dto, this.meta(req));
  }

  /** Scenario 55 — refused whenever collection history exists. */
  @Delete(':userId')
  @RequirePermissions(EMPLOYEES_DELETE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ): Promise<DeleteUserResponse> {
    return this.users.remove(user, 'EMPLOYEE', userId, this.meta(req));
  }
}
