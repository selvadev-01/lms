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
import type { Request } from 'express';
import type { SavedReportDetail, SavedReportListResult } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  ListSavedReportsDto,
  SaveReportDto,
  UpdateSavedReportDto,
  VersionedDto,
} from '../dto/saved-report.dto';
import {
  REPORTS_SAVED_MANAGE_PERMISSION,
  REPORTS_SAVED_VIEW_PERMISSION,
  SavedReportService,
} from './saved-report.service';

/**
 * Saved report definitions.
 *
 * The only controller in Module 15 with a write path, because a saved report is
 * a stored filter set rather than a stored result — see the note on
 * `SavedReportService`.
 *
 * Literal segments are declared before `:reportDefinitionId` routes: Nest
 * matches in declaration order, and a bare `:id` above a literal would swallow
 * it.
 */
@Controller('reports/saved')
export class SavedReportController {
  constructor(private readonly saved: SavedReportService) {}

  @Get()
  @RequirePermissions(REPORTS_SAVED_VIEW_PERMISSION)
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListSavedReportsDto,
    @Req() req: Request,
  ): Promise<SavedReportListResult> {
    return this.saved.list(user, query, this.meta(req));
  }

  @Get(':reportDefinitionId')
  @RequirePermissions(REPORTS_SAVED_VIEW_PERMISSION)
  detail(
    @CurrentUser() user: AuthContext,
    @Param('reportDefinitionId', new ParseUUIDPipe({ version: '4' }))
    reportDefinitionId: string,
  ): Promise<SavedReportDetail> {
    return this.saved.detail(user, reportDefinitionId);
  }

  @Post()
  @RequirePermissions(REPORTS_SAVED_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: SaveReportDto,
    @Req() req: Request,
  ): Promise<SavedReportDetail> {
    return this.saved.create(user, dto, this.meta(req));
  }

  @Patch(':reportDefinitionId')
  @RequirePermissions(REPORTS_SAVED_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  update(
    @CurrentUser() user: AuthContext,
    @Param('reportDefinitionId', new ParseUUIDPipe({ version: '4' }))
    reportDefinitionId: string,
    @Body() dto: UpdateSavedReportDto,
    @Req() req: Request,
  ): Promise<SavedReportDetail> {
    return this.saved.update(user, reportDefinitionId, dto, this.meta(req));
  }

  /**
   * Deactivate.
   *
   * A POST rather than a DELETE, because nothing is removed: Scenario 41 keeps
   * the definition and its history and only stops it producing new output.
   * `@HttpCode(200)` because it returns the updated definition.
   */
  @Post(':reportDefinitionId/deactivate')
  @HttpCode(200)
  @RequirePermissions(REPORTS_SAVED_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  deactivate(
    @CurrentUser() user: AuthContext,
    @Param('reportDefinitionId', new ParseUUIDPipe({ version: '4' }))
    reportDefinitionId: string,
    @Body() dto: VersionedDto,
    @Req() req: Request,
  ): Promise<SavedReportDetail> {
    return this.saved.deactivate(user, reportDefinitionId, dto, this.meta(req));
  }

  /**
   * Delete, only when nothing references it.
   *
   * Scenario 42 blocks this whenever the definition has ever been run, and the
   * refusal names what blocks it rather than being a bare "no".
   */
  @Delete(':reportDefinitionId')
  @HttpCode(204)
  @RequirePermissions(REPORTS_SAVED_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  remove(
    @CurrentUser() user: AuthContext,
    @Param('reportDefinitionId', new ParseUUIDPipe({ version: '4' }))
    reportDefinitionId: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.saved.remove(user, reportDefinitionId, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }
}
