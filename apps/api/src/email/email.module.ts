import { Module } from '@nestjs/common';

import { ConsoleEmailProvider } from './console-email.provider';
import { EmailService } from './email.service';
import { SmtpEmailProvider } from './smtp-email.provider';

/**
 * Outbound email.
 *
 * `EmailService` is the only export, exactly as `SmsModule` exports only
 * `SmsService`: the gateway is chosen per organization from
 * `email_provider_configs`, so it cannot be bound to a single `EmailProvider`
 * at boot the way a deployment-wide setting could. Both concrete providers are
 * registered as ordinary injectables and selected per send.
 *
 * Adding a gateway means adding a class, an enum value on `EmailProviderKind`,
 * and a branch in `EmailService.providerFor` — no caller changes, because
 * everything upstream depends on `EmailService`.
 */
@Module({
  providers: [ConsoleEmailProvider, SmtpEmailProvider, EmailService],
  exports: [EmailService],
})
export class EmailModule {}
