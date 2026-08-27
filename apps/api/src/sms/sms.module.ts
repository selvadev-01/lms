import { Module } from '@nestjs/common';

import { ConsoleSmsProvider } from './console-sms.provider';
import { SmsService } from './sms.service';
import { TwilioSmsProvider } from './twilio-sms.provider';

/**
 * Outbound SMS.
 *
 * `SmsService` is the only export: the gateway is chosen per organization from
 * `sms_provider_configs`, so it cannot be bound to a single `SmsProvider` at
 * boot the way a deployment-wide setting could. Both concrete providers are
 * registered as ordinary injectables and selected per send.
 *
 * Adding a gateway means adding a class, an enum value on `SmsProviderKind`,
 * and a branch in `SmsService.providerFor` — no caller changes, because
 * everything upstream depends on `SmsService`.
 */
@Module({
  providers: [ConsoleSmsProvider, TwilioSmsProvider, SmsService],
  exports: [SmsService],
})
export class SmsModule {}
