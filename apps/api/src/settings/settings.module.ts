import { Module } from '@nestjs/common';

import { BusinessCalendarService } from './business-calendar.service';
import { ConfigTransferService } from './config-transfer.service';
import { RetentionPolicyController } from './retention-policy.controller';
import { RetentionPolicyService } from './retention-policy.service';
import { SettingsController } from './settings.controller';
import { SettingChangeService } from './setting-change.service';
import { SettingService } from './setting.service';

/**
 * Module 17 — settings, configuration governance and the business calendar.
 *
 * `PrismaModule` and `AuditModule` are `@Global`, so nothing is imported here.
 * `BusinessCalendarService` is exported because `EodService` resolves the
 * business date and the EOD window through it — the calendar is configuration,
 * and configuration belongs to this module rather than to maintenance.
 */
@Module({
  // `RetentionPolicyController` has its own base path (`/retention/policies`)
  // rather than extending `/settings`, so no route here can be shadowed by
  // `SettingsController`'s `:settingId`.
  controllers: [SettingsController, RetentionPolicyController],
  providers: [
    SettingService,
    SettingChangeService,
    BusinessCalendarService,
    RetentionPolicyService,
    ConfigTransferService,
  ],
  exports: [
    SettingService,
    SettingChangeService,
    BusinessCalendarService,
    // Exported for the purge path: `assertPurgeAllowed` is the only sanctioned
    // way to decide whether records may be destroyed (Rule 76, Scenario 58).
    RetentionPolicyService,
  ],
})
export class SettingsModule {}
