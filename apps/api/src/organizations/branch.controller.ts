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
  BranchDetail,
  BranchListResponse,
  DeleteBranchResponse,
} from '@lms/types';

import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  BRANCHES_ACTIVATE_PERMISSION,
  BRANCHES_CREATE_PERMISSION,
  BRANCHES_DELETE_PERMISSION,
  BRANCHES_UPDATE_PERMISSION,
  BRANCHES_VIEW_PERMISSION,
  BranchService,
} from './branch.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { ListBranchesDto } from './dto/list-branches.dto';
import { SetStatusDto } from './dto/set-status.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

/**
 * Branch Management.
 *
 * The permissions here grant actions, not reach. A Branch Admin holds
 * `branches.view` and reaches this controller legitimately; BranchService is
 * what confines them to their own branch (Scenarios 15, 16, 35, 38). Splitting
 * mutations across `branches.create` / `.update` / `.delete` / `.activate`
 * rather than one `branches.manage` is what lets the seed grant a Branch Admin
 * the read without any of the writes (Q-ORG-13, Scenario 34).
 */
@Controller('branches')
export class BranchController {
  constructor(private readonly branches: BranchService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /** Scenarios 13, 15, 38, 50. */
  @Get()
  @RequirePermissions(BRANCHES_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListBranchesDto,
    @Req() req: Request,
  ): Promise<BranchListResponse> {
    const branches = await this.branches.list(user, query, this.meta(req));

    return { branches };
  }

  /** Scenarios 17, 18, 19, 34, 46. */
  @Post()
  @RequirePermissions(BRANCHES_CREATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateBranchDto,
    @Req() req: Request,
  ): Promise<BranchDetail> {
    return this.branches.create(user, dto, this.meta(req));
  }

  /** Scenarios 14, 16, 35, 37. */
  @Get(':branchId')
  @RequirePermissions(BRANCHES_VIEW_PERMISSION)
  async getById(
    @CurrentUser() user: AuthContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Req() req: Request,
  ): Promise<BranchDetail> {
    return this.branches.getById(user, branchId, this.meta(req));
  }

  /** Scenarios 20, 21, 22. */
  @Patch(':branchId')
  @RequirePermissions(BRANCHES_UPDATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchDto,
    @Req() req: Request,
  ): Promise<BranchDetail> {
    return this.branches.update(user, branchId, dto, this.meta(req));
  }

  /** Scenarios 27, 28, 33, 48. */
  @Post(':branchId/status')
  @RequirePermissions(BRANCHES_ACTIVATE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setStatus(
    @CurrentUser() user: AuthContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: SetStatusDto,
    @Req() req: Request,
  ): Promise<BranchDetail> {
    return this.branches.setStatus(user, branchId, dto, this.meta(req));
  }

  /**
   * Scenarios 29, 30, 47, 54.
   *
   * 200 with a body rather than 204: a delete that was refused because records
   * reference the branch returns 409 carrying the blockers, and a caller
   * distinguishing those two outcomes needs something to read in both cases.
   */
  @Delete(':branchId')
  @RequirePermissions(BRANCHES_DELETE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Req() req: Request,
  ): Promise<DeleteBranchResponse> {
    return this.branches.remove(user, branchId, this.meta(req));
  }
}
