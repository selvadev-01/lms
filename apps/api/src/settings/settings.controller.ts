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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  BusinessCalendarService,
  SETTINGS_CALENDAR_MANAGE_PERMISSION,
  SETTINGS_CALENDAR_VIEW_PERMISSION,
  type BusinessCalendarDetail,
  type HolidayDetail,
} from './business-calendar.service';
import {
  ConfigTransferService,
  SETTINGS_EXPORT_PERMISSION,
  SETTINGS_IMPORT_PERMISSION,
  type ConfigurationExport,
  type ImportResult,
} from './config-transfer.service';
import { ImportConfigurationDto } from './dto/config-transfer.dto';
import {
  AddHolidayDto,
  ListChangeRequestsDto,
  ListSettingsDto,
  RejectChangeRequestDto,
  SetSettingStatusDto,
  UpsertBusinessCalendarDto,
  UpsertSettingDto,
} from './dto/settings.dto';
import {
  SETTINGS_CHANGES_APPROVE_PERMISSION,
  SETTINGS_CHANGES_VIEW_PERMISSION,
  SettingChangeService,
  type ChangeRequestDetail,
} from './setting-change.service';
import {
  SETTINGS_VIEW_PERMISSION,
  SettingService,
  type SettingDetail,
} from './setting.service';

/**
 * Module 17 — settings, configuration governance and the business calendar.
 *
 * # Write permissions are checked in the service, not here
 *
 * Every mutating route below is guarded only by `settings.view`, and that is
 * deliberate. Which write permission applies depends on the setting's SCOPE and
 * on whether the registry marks it protected — `settings.manage`,
 * `settings.branch.manage` or `settings.protected.manage` — and a decorator
 * cannot see the request body. `SettingService.assertMayWrite` makes that
 * decision with the definition in hand.
 *
 * The consequence is intended: a Branch Admin REACHES these routes and is
 * refused at the specific act, which is what makes Scenarios 44 and 64 provable
 * in an e2e run. A route-level `settings.manage` would turn both into a blanket
 * 403 that proves nothing about scope.
 *
 * # Route order
 *
 * The literal `changes` and `business-calendar` prefixes are declared before
 * `:settingId`, or the parameterised route would swallow them.
 */
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingService,
    private readonly changes: SettingChangeService,
    private readonly calendar: BusinessCalendarService,
    private readonly configTransfer: ConfigTransferService,
  ) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  // --- catalog and list ---------------------------------------------------

  /**
   * The registry, so the UI can offer only supported codes.
   *
   * Declared before `:settingId` — "catalog" is not a uuid, but the
   * parameterised route would still match it and fail in the pipe.
   */
  @Get('catalog')
  @RequirePermissions(SETTINGS_VIEW_PERMISSION)
  catalog(): ReturnType<SettingService['catalog']> {
    return this.settings.catalog();
  }

  @Get()
  @RequirePermissions(SETTINGS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListSettingsDto,
  ): Promise<{ items: SettingDetail[] }> {
    return { items: await this.settings.list(user, query) };
  }

  // --- configuration transfer (before :settingId) -------------------------

  /**
   * Export the organization configuration (Rule 56).
   *
   * A protected value the caller may not read is masked in the document exactly
   * as it is on the settings screen — see `ConfigTransferService.export`.
   */
  @Get('export')
  @RequirePermissions(SETTINGS_EXPORT_PERMISSION)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async exportConfiguration(
    @CurrentUser() user: AuthContext,
  ): Promise<ConfigurationExport> {
    return this.configTransfer.export(user);
  }

  /**
   * Import a configuration document (Scenarios 59-62).
   *
   * A 400 carries the per-entry `problems` list and means nothing was changed;
   * a 409 means a setting moved while the import was being applied.
   */
  @Post('import')
  @RequirePermissions(SETTINGS_IMPORT_PERMISSION)
  // 20/min, matching the other settings writes rather than the 5/min export.
  // Export is a bulk READ and its low cap is a scraping guard; an import is a
  // write an operator legitimately retries after fixing the entries a refusal
  // named, and a rejected import changes nothing while still costing budget.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async importConfiguration(
    @CurrentUser() user: AuthContext,
    @Body() dto: ImportConfigurationDto,
  ): Promise<ImportResult> {
    return this.configTransfer.import(user, dto);
  }

  // --- change requests (before :settingId) --------------------------------

  @Get('changes')
  @RequirePermissions(SETTINGS_CHANGES_VIEW_PERMISSION)
  async listChanges(
    @CurrentUser() user: AuthContext,
    @Query() query: ListChangeRequestsDto,
  ): Promise<{ items: ChangeRequestDetail[] }> {
    return { items: await this.changes.list(user, query) };
  }

  @Get('changes/:changeRequestId')
  @RequirePermissions(SETTINGS_CHANGES_VIEW_PERMISSION)
  async getChange(
    @CurrentUser() user: AuthContext,
    @Param('changeRequestId', ParseUUIDPipe) changeRequestId: string,
  ): Promise<ChangeRequestDetail> {
    return this.changes.get(user, changeRequestId);
  }

  /**
   * Approve and apply (Scenario 10).
   *
   * Self-approval is refused inside the service, not by this permission: the
   * permission decides who may approve at all, the service decides which ones
   * (Scenario 11).
   */
  @Post('changes/:changeRequestId/approve')
  @RequirePermissions(SETTINGS_CHANGES_APPROVE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async approveChange(
    @CurrentUser() user: AuthContext,
    @Param('changeRequestId', ParseUUIDPipe) changeRequestId: string,
    @Req() req: Request,
  ): Promise<ChangeRequestDetail> {
    return this.changes.approve(user, changeRequestId, this.meta(req));
  }

  @Post('changes/:changeRequestId/reject')
  @RequirePermissions(SETTINGS_CHANGES_APPROVE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async rejectChange(
    @CurrentUser() user: AuthContext,
    @Param('changeRequestId', ParseUUIDPipe) changeRequestId: string,
    @Body() dto: RejectChangeRequestDto,
    @Req() req: Request,
  ): Promise<ChangeRequestDetail> {
    return this.changes.reject(
      user,
      changeRequestId,
      dto.rejectionReason,
      this.meta(req),
    );
  }

  /**
   * Withdraw one's own pending request.
   *
   * Guarded by `changes.view` rather than `changes.approve`: cancelling is the
   * submitter's act, and the service refuses anyone else. Requiring the approver
   * permission would mean a submitter could not withdraw their own proposal.
   */
  @Post('changes/:changeRequestId/cancel')
  @RequirePermissions(SETTINGS_CHANGES_VIEW_PERMISSION)
  async cancelChange(
    @CurrentUser() user: AuthContext,
    @Param('changeRequestId', ParseUUIDPipe) changeRequestId: string,
    @Req() req: Request,
  ): Promise<ChangeRequestDetail> {
    return this.changes.cancel(user, changeRequestId, this.meta(req));
  }

  // --- business calendar (before :settingId) ------------------------------

  @Get('business-calendar')
  @RequirePermissions(SETTINGS_CALENDAR_VIEW_PERMISSION)
  async listCalendars(
    @CurrentUser() user: AuthContext,
  ): Promise<{ items: BusinessCalendarDetail[] }> {
    return { items: await this.calendar.list(user) };
  }

  @Put('business-calendar')
  @RequirePermissions(SETTINGS_CALENDAR_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async upsertCalendar(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpsertBusinessCalendarDto,
    @Req() req: Request,
  ): Promise<BusinessCalendarDetail> {
    return this.calendar.upsert(user, dto, this.meta(req));
  }

  @Post('business-calendar/:calendarId/holidays')
  @RequirePermissions(SETTINGS_CALENDAR_MANAGE_PERMISSION)
  async addHoliday(
    @CurrentUser() user: AuthContext,
    @Param('calendarId', ParseUUIDPipe) calendarId: string,
    @Body() dto: AddHolidayDto,
    @Req() req: Request,
  ): Promise<HolidayDetail> {
    return this.calendar.addHoliday(user, calendarId, dto, this.meta(req));
  }

  @Delete('business-calendar/:calendarId/holidays/:holidayId')
  @RequirePermissions(SETTINGS_CALENDAR_MANAGE_PERMISSION)
  @HttpCode(204)
  async removeHoliday(
    @CurrentUser() user: AuthContext,
    @Param('calendarId', ParseUUIDPipe) calendarId: string,
    @Param('holidayId', ParseUUIDPipe) holidayId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.calendar.removeHoliday(
      user,
      calendarId,
      holidayId,
      this.meta(req),
    );
  }

  // --- settings by id -----------------------------------------------------

  /**
   * Create or update.
   *
   * A code whose definition requires approval returns `{ changeRequestId }` and
   * leaves the active setting untouched (Scenario 9), so a 200 here does not
   * mean the value took effect — the response body says which happened.
   */
  @Put()
  @RequirePermissions(SETTINGS_VIEW_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async upsert(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpsertSettingDto,
    @Req() req: Request,
  ): Promise<{ setting?: SettingDetail; changeRequestId?: string }> {
    return this.settings.upsert(user, dto, this.meta(req));
  }

  @Get(':settingId')
  @RequirePermissions(SETTINGS_VIEW_PERMISSION)
  async get(
    @CurrentUser() user: AuthContext,
    @Param('settingId', ParseUUIDPipe) settingId: string,
  ): Promise<SettingDetail> {
    return this.settings.get(user, settingId);
  }

  @Patch(':settingId/status')
  @RequirePermissions(SETTINGS_VIEW_PERMISSION)
  async setStatus(
    @CurrentUser() user: AuthContext,
    @Param('settingId', ParseUUIDPipe) settingId: string,
    @Body() dto: SetSettingStatusDto,
    @Req() req: Request,
  ): Promise<SettingDetail> {
    return this.settings.setStatus(
      user,
      settingId,
      dto.status,
      dto.expectedVersion,
      this.meta(req),
    );
  }

  @Delete(':settingId')
  @RequirePermissions(SETTINGS_VIEW_PERMISSION)
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('settingId', ParseUUIDPipe) settingId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.settings.remove(user, settingId, this.meta(req));
  }
}
