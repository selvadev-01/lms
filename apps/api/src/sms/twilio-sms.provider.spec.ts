import { ConfigService } from '@nestjs/config';

import { TwilioSmsProvider } from './twilio-sms.provider';
import type { SmsDeliveryConfig } from './sms.provider';

interface SentMessage {
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
}

const ENV: Record<string, unknown> = {
  'auth.twilioAccountSid': 'ACtest',
  'auth.twilioAuthToken': 'token',
  'auth.twilioFromNumber': '+15550000000',
  'auth.twilioDefaultCountryCode': '+91',
};

function configWith(overrides: Record<string, unknown> = {}): ConfigService {
  const values = { ...ENV, ...overrides };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** Redirects a provider's Logger into an array so assertions can read it. */
function captureLogs(provider: TwilioSmsProvider, into: string[]): void {
  const logger = (provider as unknown as { logger: Record<string, unknown> })
    .logger;
  for (const level of ['log', 'warn', 'error']) {
    logger[level] = (message: string) => into.push(message);
  }
}

/**
 * Captures the Twilio call by overriding the protected seam.
 *
 * Subclassing rather than injecting a function: Nest resolves constructor
 * params through DI, and a function-typed one has no injectable token, so the
 * container could not construct the provider at all.
 */
class RecordingTwilio extends TwilioSmsProvider {
  readonly sent: SentMessage[] = [];
  protected override createMessage(options: SentMessage): Promise<unknown> {
    this.sent.push(options);
    return Promise.resolve({});
  }
}

class FailingTwilio extends TwilioSmsProvider {
  constructor(
    config: ConfigService,
    private readonly failure: Error & { code?: number },
  ) {
    super(config);
  }
  protected override createMessage(): Promise<unknown> {
    return Promise.reject(this.failure);
  }
}

describe('TwilioSmsProvider', () => {
  describe('E.164 conversion', () => {
    it('prefixes a stored 10-digit number with the country code', async () => {
      const provider = new RecordingTwilio(configWith());
      await provider.send('9000000004', 'code 123456');

      expect(provider.sent[0].to).toBe('+919000000004');
    });

    it('leaves an already-prefixed number untouched', async () => {
      const provider = new RecordingTwilio(configWith());
      await provider.send('+447700900123', 'code 123456');

      expect(provider.sent[0].to).toBe('+447700900123');
    });

    it('takes the country code from the database row when present', async () => {
      const provider = new RecordingTwilio(configWith());
      const config: SmsDeliveryConfig = {
        fromNumber: '+15550000000',
        defaultCountryCode: '+44',
      };
      await provider.send('9000000004', 'code 123456', config);

      expect(provider.sent[0].to).toBe('+449000000004');
    });
  });

  describe('sender selection', () => {
    it('prefers a Messaging Service over a from-number', async () => {
      const provider = new RecordingTwilio(
        configWith({ 'auth.twilioMessagingServiceSid': 'MGenv' }),
      );
      await provider.send('9000000004', 'code 123456');

      expect(provider.sent[0].messagingServiceSid).toBe('MGenv');
      expect(provider.sent[0].from).toBeUndefined();
    });

    it('falls back to the from-number when no Messaging Service is set', async () => {
      const provider = new RecordingTwilio(configWith());
      await provider.send('9000000004', 'code 123456');

      expect(provider.sent[0].from).toBe('+15550000000');
    });

    /** The point of the feature: one deployment, different senders per org. */
    it('lets the database row override the environment sender', async () => {
      const provider = new RecordingTwilio(
        configWith({ 'auth.twilioMessagingServiceSid': 'MGenv' }),
      );
      await provider.send('9000000004', 'code 123456', {
        messagingServiceSid: 'MGorg',
      });

      expect(provider.sent[0].messagingServiceSid).toBe('MGorg');
    });

    it('rejects when neither sender is configured anywhere', async () => {
      const provider = new RecordingTwilio(
        configWith({ 'auth.twilioFromNumber': undefined }),
      );

      await expect(provider.send('9000000004', 'code')).rejects.toThrow(
        /neither a Messaging Service SID nor a from-number/,
      );
    });
  });

  describe('credentials', () => {
    /**
     * Credentials are checked at first use, not at boot: an organization on
     * `console` must not be blocked from starting because Twilio env vars are
     * unset.
     */
    it('rejects at send time when credentials are missing', async () => {
      const provider = new TwilioSmsProvider(
        configWith({ 'auth.twilioAuthToken': undefined }),
      );

      await expect(provider.send('9000000004', 'code')).rejects.toThrow(
        /TWILIO_ACCOUNT_SID \/ TWILIO_AUTH_TOKEN are not set/,
      );
    });

    it('rejects an account SID that is not an AC identifier', async () => {
      const provider = new TwilioSmsProvider(
        configWith({ 'auth.twilioAccountSid': 'SKwrongkind' }),
      );

      await expect(provider.send('9000000004', 'code')).rejects.toThrow(
        /must start with "AC"/,
      );
    });
  });

  describe('failure handling', () => {
    /**
     * Scenario 33: the caller audits RECOVERY_SMS_FAILED and leaves the request
     * replayable, which only works if the provider rejects rather than resolves.
     */
    it('rejects rather than swallowing a Twilio error', async () => {
      const error = Object.assign(new Error('not verified'), { code: 21608 });
      const provider = new FailingTwilio(configWith(), error);

      await expect(provider.send('9000000004', 'code 123456')).rejects.toThrow(
        'not verified',
      );
    });

    it('explains the trial-account error rather than logging a bare code', async () => {
      const error = Object.assign(new Error('not verified'), { code: 21608 });
      const provider = new FailingTwilio(configWith(), error);
      const logged: string[] = [];
      captureLogs(provider, logged);

      await expect(
        provider.send('9000000004', 'code 123456'),
      ).rejects.toThrow();

      expect(logged.join()).toContain('Verified Caller IDs');
      expect(logged.join()).toContain('21608');
    });
  });

  /**
   * Scenario 25: the OTP must never reach an application log. The audit
   * sanitizer cannot help here — these are Logger calls, not audit rows.
   */
  describe('secret hygiene', () => {
    it('never writes the message body to the log, on success or failure', async () => {
      const body = 'Your LMS password recovery code is 424242.';
      const logged: string[] = [];

      const ok = new RecordingTwilio(configWith());
      captureLogs(ok, logged);
      await ok.send('9000000004', body);

      const bad = new FailingTwilio(configWith(), new Error('boom'));
      captureLogs(bad, logged);
      await expect(bad.send('9000000004', body)).rejects.toThrow();

      const all = logged.join('\n');
      expect(all).not.toContain('424242');
      expect(all).not.toContain(body);
      // The recipient is masked too, so a log never names a full mobile number.
      expect(all).not.toContain('9000000004');
      expect(all).toContain('90XXXXXX04');
    });
  });
});
