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
} from '@nestjs/common';

import type { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';

import {
  CreateRetentionPolicyDto,
  ListRetentionPoliciesDto,
  UpdateRetentionPolicyDto,
} from './dto/retention-policy.dto';
import {
  RETENTION_POLICIES_MANAGE_PERMISSION,
  RETENTION_POLICIES_VIEW_PERMISSION,
  RetentionPolicyService,
  type RetentionPolicyDetail,
} from './retention-policy.service';

/**
 * Data retention policies (Scenarios 55-58).
 *
 * # Its own base path, not a branch of `/settings`
 *
 * `SettingsController` already routes `@Get(':settingId')`, and a literal route
 * added after it in a DIFFERENT controller is silently shadowed — the hazard
 * this codebase has hit before. `/retention/policies` avoids the ordering
 * question entirely, and retention is a distinct resource rather than a setting.
 *
 * # Every route is organization-scoped
 *
 * No route takes a branch: `RetentionPolicy` has no `branchId`. A Branch Admin
 * holding neither retention code is refused by the guard, which is the denial
 * Scenario 55's "authorized scope" requires.
 */
@Controller('retention/policies')
export class RetentionPolicyController {
  constructor(private readonly policies: RetentionPolicyService) {}

  @Get()
  @RequirePermissions(RETENTION_POLICIES_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListRetentionPoliciesDto,
  ): Promise<{ items: RetentionPolicyDetail[] }> {
    return { items: await this.policies.list(user, query) };
  }

  @Post()
  @RequirePermissions(RETENTION_POLICIES_MANAGE_PERMISSION)
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateRetentionPolicyDto,
  ): Promise<{ policy: RetentionPolicyDetail }> {
    return { policy: await this.policies.create(user, dto) };
  }

  @Get(':retentionPolicyId')
  @RequirePermissions(RETENTION_POLICIES_VIEW_PERMISSION)
  async get(
    @CurrentUser() user: AuthContext,
    @Param('retentionPolicyId', ParseUUIDPipe) retentionPolicyId: string,
  ): Promise<{ policy: RetentionPolicyDetail }> {
    return { policy: await this.policies.get(user, retentionPolicyId) };
  }

  /**
   * Edit, or activate/deactivate via `status`.
   *
   * PATCH rather than PUT: `expectedVersion` makes every write conditional, and
   * a full-replacement PUT would invite a caller to omit a field and blank it.
   */
  @Patch(':retentionPolicyId')
  @RequirePermissions(RETENTION_POLICIES_MANAGE_PERMISSION)
  async update(
    @CurrentUser() user: AuthContext,
    @Param('retentionPolicyId', ParseUUIDPipe) retentionPolicyId: string,
    @Body() dto: UpdateRetentionPolicyDto,
  ): Promise<{ policy: RetentionPolicyDetail }> {
    return {
      policy: await this.policies.update(user, retentionPolicyId, dto),
    };
  }

  /**
   * Delete a policy that has never governed processing (Scenario 56).
   *
   * A referenced policy is refused with a 409 naming deactivation as the
   * sanctioned alternative — see `RetentionPolicyService.remove`.
   */
  @Delete(':retentionPolicyId')
  @HttpCode(204)
  @RequirePermissions(RETENTION_POLICIES_MANAGE_PERMISSION)
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('retentionPolicyId', ParseUUIDPipe) retentionPolicyId: string,
  ): Promise<void> {
    await this.policies.remove(user, retentionPolicyId);
  }
}
