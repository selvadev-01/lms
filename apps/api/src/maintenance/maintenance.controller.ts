import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
  ListMaintenanceJobsDto,
  SetMaintenanceModeDto,
  StartEodDto,
} from './dto/maintenance.dto';
import { EodService, MAINTENANCE_EOD_RUN_PERMISSION } from './eod.service';
import {
  MAINTENANCE_JOBS_RETRY_PERMISSION,
  MAINTENANCE_JOBS_VIEW_PERMISSION,
  MaintenanceJobService,
  type MaintenanceJobDetail,
} from './maintenance-job.service';
import {
  MAINTENANCE_MODE_MANAGE_PERMISSION,
  MaintenanceModeService,
  type MaintenanceModeDetail,
} from './maintenance-mode.service';

/**
 * Module 17 — maintenance runs, EOD and maintenance mode.
 *
 * # Two kinds of denial, and both are needed
 *
 * A Branch Admin is refused `retry` because it lacks the permission — that is an
 * AUTHORITY denial and proves nothing about scope. Scenario 45 asks for
 * something stricter: an operator who HOLDS the permission and is still refused
 * another branch's job. The seeded `MAINT_OPERATOR` role supplies that, and the
 * refusal comes from `MaintenanceJobService.findInScope`, not from this
 * decorator.
 *
 * # `/maintenance/mode` stays reachable during maintenance
 *
 * `MaintenanceModeGuard` allow-lists this prefix. Without that, enabling
 * maintenance mode would block the only route that can disable it.
 */
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly jobs: MaintenanceJobService,
    private readonly eod: EodService,
    private readonly mode: MaintenanceModeService,
  ) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  // --- maintenance mode (literal prefix, before jobs/:jobRunId) -----------

  @Get('mode')
  @RequirePermissions(MAINTENANCE_JOBS_VIEW_PERMISSION)
  async listMode(
    @CurrentUser() user: AuthContext,
  ): Promise<{ items: MaintenanceModeDetail[] }> {
    return { items: await this.mode.list(user) };
  }

  @Put('mode')
  @RequirePermissions(MAINTENANCE_MODE_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setMode(
    @CurrentUser() user: AuthContext,
    @Body() dto: SetMaintenanceModeDto,
    @Req() req: Request,
  ): Promise<MaintenanceModeDetail> {
    return this.mode.set(user, dto, this.meta(req));
  }

  // --- end of day ---------------------------------------------------------

  /**
   * Start EOD for a business date.
   *
   * Returns `ALREADY_HANDLED` rather than a 409 when the execution key is
   * already claimed: a duplicate request is recognised idempotently, which is
   * the designed outcome rather than an error (Scenarios 22, 66).
   */
  @Post('eod')
  @RequirePermissions(MAINTENANCE_EOD_RUN_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async runEod(
    @CurrentUser() user: AuthContext,
    @Body() dto: StartEodDto,
    @Req() req: Request,
  ): Promise<{ outcome: string; job: MaintenanceJobDetail }> {
    return this.eod.run(user, dto, this.meta(req));
  }

  // --- jobs ---------------------------------------------------------------

  @Get('jobs')
  @RequirePermissions(MAINTENANCE_JOBS_VIEW_PERMISSION)
  async listJobs(
    @CurrentUser() user: AuthContext,
    @Query() query: ListMaintenanceJobsDto,
  ): Promise<{ items: MaintenanceJobDetail[] }> {
    return { items: await this.jobs.list(user, query) };
  }

  @Get('jobs/:jobRunId')
  @RequirePermissions(MAINTENANCE_JOBS_VIEW_PERMISSION)
  async getJob(
    @CurrentUser() user: AuthContext,
    @Param('jobRunId', ParseUUIDPipe) jobRunId: string,
  ): Promise<MaintenanceJobDetail> {
    return this.jobs.get(user, jobRunId);
  }

  /**
   * Retry a failed run (Scenarios 24, 30).
   *
   * Re-queues the original execution identity and then resumes it, so steps that
   * already succeeded are skipped rather than repeated.
   */
  @Post('jobs/:jobRunId/retry')
  @RequirePermissions(MAINTENANCE_JOBS_RETRY_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async retryJob(
    @CurrentUser() user: AuthContext,
    @Param('jobRunId', ParseUUIDPipe) jobRunId: string,
    @Req() req: Request,
  ): Promise<MaintenanceJobDetail> {
    const requeued = await this.jobs.retry(user, jobRunId, this.meta(req));

    // Only EOD has a runner today. Another job type re-queues and waits for
    // whatever owns it rather than being executed from here.
    if (requeued.jobType === 'EOD') {
      return this.eod.resume(user, jobRunId);
    }
    return requeued;
  }
}
