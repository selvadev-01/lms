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
import type { SelectOption } from '@lms/validation';
import type { Request } from 'express';

import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CreateMasterDataValueDto } from './dto/create-master-data-value.dto';
import { ListMasterDataDto } from './dto/list-master-data.dto';
import { UpdateMasterDataValueDto } from './dto/update-master-data-value.dto';
import {
  MASTER_DATA_MANAGE_PERMISSION,
  MASTER_DATA_VIEW_PERMISSION,
  MasterDataService,
  type MasterDataValueDetail,
} from './master-data.service';

/**
 * Master data — the admin-maintained option lists behind dropdown fields.
 *
 * Thin, as the other controllers are: it names the permission, passes the
 * `AuthContext` through and shapes the response. No handler accepts an `orgId`;
 * it comes from the JWT, which is what makes tenant isolation structural here
 * rather than a check that could be omitted from one route.
 *
 * The read endpoint returns `SelectOption[]` — the same shape the compiled-in
 * enum registries carry — so the web layer's `<SelectField>` consumes an
 * admin-managed list and a code-defined one identically.
 */
@Controller('master-data')
export class MasterDataController {
  constructor(private readonly masterData: MasterDataService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /**
   * The values in one list, ready to render.
   *
   * Guarded by `master_data.view` rather than left public: an option list names
   * the organization's document categories and business vocabulary, which is not
   * something an unauthenticated caller needs.
   */
  @Get()
  @RequirePermissions(MASTER_DATA_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListMasterDataDto,
  ): Promise<{ values: SelectOption[] }> {
    const values = await this.masterData.list(user, query);
    return { values };
  }

  /**
   * The management view — every column the admin screen shows.
   *
   * Guarded by `view`, not `manage`. A Branch Admin holds `view` and reaches the
   * settings screen to see how the lists are configured; gating this on `manage`
   * would render that page as a load failure for them, which reads as an outage
   * rather than as the read-only view it is. The write endpoints below are what
   * `manage` protects, and nothing here exposes more than the admin screen shows.
   */
  @Get('manage')
  @RequirePermissions(MASTER_DATA_VIEW_PERMISSION)
  async listDetailed(
    @CurrentUser() user: AuthContext,
    @Query() query: ListMasterDataDto,
  ): Promise<{ values: MasterDataValueDetail[] }> {
    const values = await this.masterData.listDetailed(user, query);
    return { values };
  }

  @Post()
  @RequirePermissions(MASTER_DATA_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateMasterDataValueDto,
    @Req() req: Request,
  ): Promise<{ value: MasterDataValueDetail }> {
    const value = await this.masterData.create(user, dto, this.meta(req));
    return { value };
  }

  @Patch(':valueId')
  @RequirePermissions(MASTER_DATA_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('valueId', ParseUUIDPipe) valueId: string,
    @Body() dto: UpdateMasterDataValueDto,
    @Req() req: Request,
  ): Promise<{ value: MasterDataValueDetail }> {
    const value = await this.masterData.update(
      user,
      valueId,
      dto,
      this.meta(req),
    );
    return { value };
  }

  /**
   * Delete a value.
   *
   * A seeded row is refused with a 409 rather than silently deactivated: the
   * caller asked for a delete, and quietly doing something else would leave them
   * believing the value is gone.
   */
  @Delete(':valueId')
  @HttpCode(200)
  @RequirePermissions(MASTER_DATA_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('valueId', ParseUUIDPipe) valueId: string,
    @Req() req: Request,
  ): Promise<{ valueId: string; deleted: true }> {
    return this.masterData.remove(user, valueId, this.meta(req));
  }
}
