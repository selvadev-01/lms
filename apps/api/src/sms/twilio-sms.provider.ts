import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';
import type { Twilio } from 'twilio';

import { maskMobile } from '../audit/audit.service';
import { SmsProvider, type SmsDeliveryConfig } from './sms.provider';

/** Fields Twilio's REST client needs to place a message. */
interface CreateMessageOptions {
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
}

/**
 * Twilio error codes worth explaining rather than reporting as a bare number.
 *
 * These are configuration mistakes, not transient failures, and each one
 * otherwise looks identical to "the SMS just never arrived" — which the generic
 * non-disclosing 202 makes impossible to diagnose from the outside.
 */
const TWILIO_HINTS: Record<number, string> = {
  20003:
    'Twilio authentication failed. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
  21211: "Twilio rejected the 'To' number as invalid. Check E.164 conversion.",
  21608:
    'Trial account: the recipient is not a Verified Caller ID. Add it in the ' +
    'Twilio console (Phone Numbers -> Verified Caller IDs) or upgrade the account.',
  21614: "The 'To' number is not a valid mobile number.",
};

/**
 * Delivers SMS through Twilio.
 *
 * Addressing comes from the per-organization row when present and from the
 * environment otherwise, so one deployment can serve organizations on different
 * senders. Credentials are always environment-level: the auth token is never
 * stored in the database.
 *
 * Deliberately does NOT validate credentials at boot. An organization running
 * on `console` must not be blocked from starting because Twilio env vars are
 * unset, so a missing credential surfaces as a rejected send that the caller
 * audits (Scenario 33) rather than as a startup crash.
 */
@Injectable()
export class TwilioSmsProvider extends SmsProvider {
  private readonly logger = new Logger(TwilioSmsProvider.name);
  private client?: Twilio;

  constructor(private readonly config: ConfigService) {
    super();
  }

  /**
   * Builds the REST client on first use and caches it.
   *
   * Throws when credentials are absent, which is what propagates to the caller
   * as an audited delivery failure.
   */
  private getClient(): Twilio {
    if (this.client) return this.client;

    const accountSid = this.config.get<string>('auth.twilioAccountSid');
    const authToken = this.config.get<string>('auth.twilioAuthToken');

    if (!accountSid || !authToken) {
      throw new Error(
        'Twilio is selected but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set.',
      );
    }
    if (!accountSid.startsWith('AC')) {
      throw new Error('TWILIO_ACCOUNT_SID must start with "AC".');
    }

    this.client = twilio(accountSid, authToken);
    return this.client;
  }

  /**
   * Converts a stored 10-digit number to E.164.
   *
   * Users hold bare national numbers (`9000000004`); Twilio requires
   * `+919000000004`. An already-prefixed value passes through untouched so a
   * future international number is not double-prefixed.
   */
  private toE164(mobile: string, config?: SmsDeliveryConfig): string {
    const trimmed = mobile.replace(/\s+/g, '');
    if (trimmed.startsWith('+')) return trimmed;

    const prefix =
      config?.defaultCountryCode ??
      this.config.get<string>('auth.twilioDefaultCountryCode') ??
      '+91';

    return `${prefix}${trimmed}`;
  }

  /**
   * Chooses the sender, preferring a Messaging Service.
   *
   * A Messaging Service lets Twilio handle sender-ID selection and failover,
   * which matters for Indian deliverability; a bare `from` number is the
   * trial-account path.
   */
  private sender(config?: SmsDeliveryConfig): Partial<CreateMessageOptions> {
    const messagingServiceSid =
      config?.messagingServiceSid ??
      this.config.get<string>('auth.twilioMessagingServiceSid');
    if (messagingServiceSid) return { messagingServiceSid };

    const from =
      config?.fromNumber ?? this.config.get<string>('auth.twilioFromNumber');
    if (from) return { from };

    throw new Error(
      'Twilio is selected but neither a Messaging Service SID nor a from-number ' +
        'is configured, in the database or the environment.',
    );
  }

  async send(
    to: string,
    body: string,
    config?: SmsDeliveryConfig,
  ): Promise<void> {
    const masked = maskMobile(to);

    try {
      await this.createMessage({
        to: this.toE164(to, config),
        body,
        ...this.sender(config),
      });
      // Never log `body` — it carries the OTP (Scenario 25). The audit
      // sanitizer cannot help here: this is an application log, not an audit row.
      this.logger.log(`SMS accepted by Twilio for ${masked}`);
    } catch (error) {
      const code = (error as { code?: number }).code;
      const hint = code ? TWILIO_HINTS[code] : undefined;
      const detail = (error as Error).message;

      this.logger.error(
        `Twilio delivery failed for ${masked}` +
          (code ? ` (code ${code})` : '') +
          `: ${detail}` +
          (hint ? ` — ${hint}` : ''),
      );

      // Rethrow: SmsProvider's contract requires rejection so the caller audits
      // RECOVERY_SMS_FAILED and leaves the request replayable (Scenario 33).
      throw error;
    }
  }

  /**
   * The Twilio call itself.
   *
   * A protected method rather than a constructor parameter: Nest resolves
   * constructor params through DI, and a function-typed one has no injectable
   * token, so the container cannot instantiate the provider at all. Tests
   * override this by subclassing.
   */
  protected createMessage(options: CreateMessageOptions): Promise<unknown> {
    return this.getClient().messages.create(options);
  }
}
