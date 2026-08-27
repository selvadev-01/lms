import { Module } from '@nestjs/common';

import { SettingsModule } from '../settings/settings.module';
import { EodSweepService } from './eod-sweep.service';
import { EodWorker } from './eod-worker';
import { EodService } from './eod.service';
import { MaintenanceJobService } from './maintenance-job.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceModeService } from './maintenance-mode.service';

/**
 * Module 17 — maintenance runs, EOD and maintenance mode.
 *
 * `SettingsModule` is imported for `BusinessCalendarService`: EOD derives its
 * business date and working-day rules from the calendar, which is configuration
 * this module consumes rather than owns.
 *
 * `MaintenanceModeService` is exported because `MaintenanceModeGuard` — a global
 * guard registered in `AppModule` — depends on it.
 */
@Module({
  imports: [SettingsModule],
  controllers: [MaintenanceController],
  providers: [
    MaintenanceJobService,
    EodService,
    EodSweepService,
    EodWorker,
    MaintenanceModeService,
  ],
  exports: [
    MaintenanceJobService,
    EodService,
    EodSweepService,
    MaintenanceModeService,
  ],
})
export class MaintenanceModule {}
