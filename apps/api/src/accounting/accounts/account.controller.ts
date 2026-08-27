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
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  AccountDetail,
  AccountSummary,
  AccountTreeNode,
} from '@lms/types';
import type { Request } from 'express';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  ACCOUNTS_MANAGE_PERMISSION,
  ACCOUNTS_VIEW_PERMISSION,
  AccountService,
} from './account.service';
import {
  ActivateAccountDto,
  CreateAccountDto,
  DeactivateAccountDto,
  ListAccountsDto,
  UpdateAccountDto,
} from './dto/account.dto';

/**
 * Chart of accounts.
 *
 * # Route order
 *
 * `tree` is declared before `:accountId`. Nest matches in declaration order, so
 * the reverse would bind the literal `tree` as a uuid parameter and answer 400
 * for a route that exists. `app.e2e-spec.ts` asserts this class of bug.
 *
 * # Why there is no `@UseGuards`
 *
 * `JwtAuthGuard` and `PermissionsGuard` are global `APP_GUARD`s, so a new route
 * is protected by default rather than by remembering a decorator. Only
 * `@RequirePermissions` is written here.
 */
@Controller('accounting/accounts')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Get()
  @RequirePermissions(ACCOUNTS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListAccountsDto,
  ): Promise<{ accounts: AccountSummary[]; total: number }> {
    const { items, total } = await this.accounts.list(user, query);
    return { accounts: items, total };
  }

  @Get('tree')
  @RequirePermissions(ACCOUNTS_VIEW_PERMISSION)
  async tree(
    @CurrentUser() user: AuthContext,
  ): Promise<{ nodes: AccountTreeNode[] }> {
    return { nodes: await this.accounts.tree(user) };
  }

  @Get(':accountId')
  @RequirePermissions(ACCOUNTS_VIEW_PERMISSION)
  async get(
    @CurrentUser() user: AuthContext,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
  ): Promise<{ account: AccountDetail }> {
    return { account: await this.accounts.get(user, accountId) };
  }

  @Post()
  @RequirePermissions(ACCOUNTS_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateAccountDto,
    @Req() req: Request,
  ): Promise<{ account: AccountDetail }> {
    return { account: await this.accounts.create(user, dto, this.meta(req)) };
  }

  @Patch(':accountId')
  @RequirePermissions(ACCOUNTS_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Body() dto: UpdateAccountDto,
    @Req() req: Request,
  ): Promise<{ account: AccountDetail }> {
    return {
      account: await this.accounts.update(user, accountId, dto, this.meta(req)),
    };
  }

  /**
   * `@HttpCode(200)`: this is a state change on an existing account, not the
   * creation of anything, so 201 would misdescribe it.
   */
  @Post(':accountId/deactivate')
  @HttpCode(200)
  @RequirePermissions(ACCOUNTS_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async deactivate(
    @CurrentUser() user: AuthContext,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Body() dto: DeactivateAccountDto,
    @Req() req: Request,
  ): Promise<{ account: AccountDetail }> {
    return {
      account: await this.accounts.deactivate(
        user,
        accountId,
        dto,
        this.meta(req),
      ),
    };
  }

  @Post(':accountId/activate')
  @HttpCode(200)
  @RequirePermissions(ACCOUNTS_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async activate(
    @CurrentUser() user: AuthContext,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Body() dto: ActivateAccountDto,
    @Req() req: Request,
  ): Promise<{ account: AccountDetail }> {
    return {
      account: await this.accounts.activate(
        user,
        accountId,
        dto,
        this.meta(req),
      ),
    };
  }

  /**
   * Exists so that it can refuse (Scenario 10).
   *
   * An account with any downstream reference answers 409 naming the blockers.
   * Only a genuinely unreferenced account is removed.
   */
  @Delete(':accountId')
  @HttpCode(200)
  @RequirePermissions(ACCOUNTS_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Req() req: Request,
  ): Promise<{ accountId: string; deleted: true }> {
    return this.accounts.remove(user, accountId, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }
}
