import { validateEnv } from './env.validation';

const BASE = {
  DATABASE_URL: 'postgresql://localhost:5432/lms',
  AUTH_JWT_SECRET: 'a'.repeat(32),
};

/** Returns the aggregated failure message, or null when validation passes. */
function errorFor(config: Record<string, unknown>): string | null {
  try {
    validateEnv({ ...BASE, ...config });
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe('validateEnv', () => {
  describe('core', () => {
    it('accepts a minimal valid configuration', () => {
      expect(errorFor({})).toBeNull();
    });

    it('requires DATABASE_URL', () => {
      expect(errorFor({ DATABASE_URL: undefined })).toContain(
        'DATABASE_URL is required',
      );
    });

    it('requires a sufficiently long AUTH_JWT_SECRET', () => {
      expect(errorFor({ AUTH_JWT_SECRET: 'short' })).toContain(
        'at least 32 characters',
      );
    });

    /** Every problem is reported at once, not one boot failure at a time. */
    it('aggregates multiple failures', () => {
      const message = errorFor({
        DATABASE_URL: undefined,
        AUTH_JWT_SECRET: undefined,
      });
      expect(message).toContain('DATABASE_URL is required');
      expect(message).toContain('AUTH_JWT_SECRET is required');
    });
  });

  describe('SMS provider', () => {
    it('defaults to console when SMS_PROVIDER is unset', () => {
      expect(errorFor({})).toBeNull();
    });

    it('rejects an unsupported provider name', () => {
      expect(errorFor({ SMS_PROVIDER: 'carrier-pigeon' })).toContain(
        'is not supported',
      );
    });

    it('accepts twilio when credentials are present', () => {
      expect(
        errorFor({
          SMS_PROVIDER: 'twilio',
          TWILIO_ACCOUNT_SID: 'ACxxxxxxxx',
          TWILIO_AUTH_TOKEN: 'token',
        }),
      ).toBeNull();
    });

    it('requires the account SID when twilio is selected', () => {
      expect(
        errorFor({ SMS_PROVIDER: 'twilio', TWILIO_AUTH_TOKEN: 'token' }),
      ).toContain('TWILIO_ACCOUNT_SID is required');
    });

    it('requires the auth token when twilio is selected', () => {
      expect(
        errorFor({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACxxxxxxxx' }),
      ).toContain('TWILIO_AUTH_TOKEN is required');
    });

    it('rejects an account SID that is not an AC identifier', () => {
      expect(
        errorFor({
          SMS_PROVIDER: 'twilio',
          TWILIO_ACCOUNT_SID: 'SKwrongkind',
          TWILIO_AUTH_TOKEN: 'token',
        }),
      ).toContain('must start with "AC"');
    });

    /**
     * Twilio credentials are not required merely because some organization row
     * might select TWILIO: boot cannot read the database, and must not depend
     * on it. That case surfaces as an audited delivery failure instead.
     */
    it('does not demand Twilio credentials when the env default is console', () => {
      expect(errorFor({ SMS_PROVIDER: 'console' })).toBeNull();
    });
  });

  describe('production guards', () => {
    /**
     * A production configuration with every console-mode provider replaced.
     *
     * Both SMS and email refuse to run in console mode in production, so a test
     * asserting one of them must satisfy the other or it fails for the wrong
     * reason. Spelled out once here rather than repeated per test.
     */
    const PRODUCTION_READY = {
      NODE_ENV: 'production',
      SMS_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: 'ACxxxxxxxx',
      TWILIO_AUTH_TOKEN: 'token',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.test',
      SMTP_FROM_ADDRESS: 'noreply@example.test',
    };

    /** ConsoleSmsProvider logs OTPs in plaintext (Scenario 25). */
    it('refuses console SMS in production', () => {
      expect(
        errorFor({ ...PRODUCTION_READY, SMS_PROVIDER: 'console' }),
      ).toContain('SMS_PROVIDER must not be "console" in production');
    });

    it('refuses console SMS in production even by omission', () => {
      expect(
        errorFor({ ...PRODUCTION_READY, SMS_PROVIDER: undefined }),
      ).toContain('SMS_PROVIDER must not be "console" in production');
    });

    it('allows twilio in production', () => {
      expect(errorFor(PRODUCTION_READY)).toBeNull();
    });

    it('refuses the development JWT placeholder in production', () => {
      expect(
        errorFor({ ...PRODUCTION_READY, AUTH_JWT_SECRET: 'dev-secret' }),
      ).toContain('development placeholder');
    });
  });

  /**
   * Module 16 — email gateway and queue settings.
   *
   * Deliberately the same shape as the SMS block above: only the
   * deployment-wide default is checked, because per-organization rows live in
   * `email_provider_configs` and boot cannot depend on what the database holds.
   */
  describe('email provider', () => {
    it('defaults to console when EMAIL_PROVIDER is unset', () => {
      expect(errorFor({})).toBeNull();
    });

    it('rejects an unknown provider', () => {
      // A typo must fail at boot rather than at the first notification, where
      // it would surface as a delivery failure on a channel that looks
      // configured.
      expect(errorFor({ EMAIL_PROVIDER: 'carrier-pigeon' })).toContain(
        'EMAIL_PROVIDER "carrier-pigeon" is not supported',
      );
    });

    it('requires a host when smtp is selected', () => {
      expect(
        errorFor({
          EMAIL_PROVIDER: 'smtp',
          SMTP_FROM_ADDRESS: 'noreply@example.test',
        }),
      ).toContain('SMTP_HOST is required');
    });

    it('requires a from-address when smtp is selected', () => {
      // A message with no envelope sender is rejected by most receivers, so an
      // unset from-address is a deployment that appears configured and delivers
      // nothing.
      expect(
        errorFor({ EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.test' }),
      ).toContain('SMTP_FROM_ADDRESS is required');
    });

    it('accepts a fully configured smtp deployment', () => {
      expect(
        errorFor({
          EMAIL_PROVIDER: 'smtp',
          SMTP_HOST: 'smtp.example.test',
          SMTP_FROM_ADDRESS: 'noreply@example.test',
        }),
      ).toBeNull();
    });

    it('rejects a port outside the valid range', () => {
      expect(errorFor({ SMTP_PORT: '70000' })).toContain(
        'SMTP_PORT must be a valid port',
      );
      expect(errorFor({ SMTP_PORT: 'not-a-port' })).toContain(
        'SMTP_PORT must be a valid port',
      );
    });

    it('refuses console email in production', () => {
      // ConsoleEmailProvider writes rendered notification content — loan
      // numbers, amounts, customer names — to a local file (Rule 55).
      expect(
        errorFor({
          NODE_ENV: 'production',
          SMS_PROVIDER: 'twilio',
          TWILIO_ACCOUNT_SID: 'ACxxxxxxxx',
          TWILIO_AUTH_TOKEN: 'token',
          EMAIL_PROVIDER: 'console',
        }),
      ).toContain('EMAIL_PROVIDER must not be "console" in production');
    });
  });

  describe('notification queue settings', () => {
    it('accepts an unset value, because each has a documented default', () => {
      expect(errorFor({})).toBeNull();
    });

    it.each([
      'NOTIFICATIONS_WORKER_BATCH_SIZE',
      'NOTIFICATIONS_WORKER_POLL_SECONDS',
      'NOTIFICATIONS_JOB_RETENTION_DAYS',
    ])('rejects a non-numeric %s', (key) => {
      expect(errorFor({ [key]: 'lots' })).toContain(
        `${key} must be a whole number`,
      );
    });

    it.each([
      'NOTIFICATIONS_WORKER_BATCH_SIZE',
      'NOTIFICATIONS_WORKER_POLL_SECONDS',
      'NOTIFICATIONS_JOB_RETENTION_DAYS',
    ])('rejects a zero %s rather than treating it as disabled', (key) => {
      // A zero batch size takes no jobs and a zero poll interval spins. Both
      // are deployments where notifications silently stop being delivered while
      // the process looks healthy — which is why zero is an error here and not
      // an off switch. `NOTIFICATIONS_WORKER_ENABLED` is the off switch.
      expect(errorFor({ [key]: '0' })).toContain(
        `${key} must be greater than 0`,
      );
    });
  });
});
