/**
 * Boot-time environment validation.
 *
 * Wired into `ConfigModule.forRoot({ validate })` so a misconfigured deployment
 * fails on startup rather than at the first sign-in attempt. A missing
 * `AUTH_JWT_SECRET` in particular must never fall back to a default — that
 * would silently issue forgeable tokens.
 */
export function validateEnv(config: Record<string, unknown>) {
  const errors: string[] = [];

  const databaseUrl = config.DATABASE_URL as string | undefined;
  if (!databaseUrl) {
    errors.push('DATABASE_URL is required');
  }

  const jwtSecret = config.AUTH_JWT_SECRET as string | undefined;
  if (!jwtSecret) {
    errors.push('AUTH_JWT_SECRET is required (no default is permitted)');
  } else if (jwtSecret.length < 32) {
    errors.push('AUTH_JWT_SECRET must be at least 32 characters');
  }

  if (config.NODE_ENV === 'production' && jwtSecret === 'dev-secret') {
    errors.push('AUTH_JWT_SECRET must not use the development placeholder');
  }

  /**
   * SMS gateway.
   *
   * Only the environment-level default is checked here. Per-organization rows
   * live in `sms_provider_configs` and are validated at first use, because boot
   * cannot know what the database holds — and must not depend on it.
   */
  const smsProvider = (
    (config.SMS_PROVIDER as string | undefined) ?? 'console'
  ).toLowerCase();

  if (!['console', 'twilio'].includes(smsProvider)) {
    errors.push(
      `SMS_PROVIDER "${smsProvider}" is not supported (expected: console, twilio)`,
    );
  }

  if (smsProvider === 'twilio') {
    const accountSid = config.TWILIO_ACCOUNT_SID as string | undefined;
    if (!accountSid) {
      errors.push('TWILIO_ACCOUNT_SID is required when SMS_PROVIDER=twilio');
    } else if (!accountSid.startsWith('AC')) {
      errors.push('TWILIO_ACCOUNT_SID must start with "AC"');
    }

    if (!config.TWILIO_AUTH_TOKEN) {
      errors.push('TWILIO_AUTH_TOKEN is required when SMS_PROVIDER=twilio');
    }
  }

  /**
   * ConsoleSmsProvider logs recovery codes in plaintext and refuses to
   * construct in production. Catching it here turns an opaque DI-time failure
   * into a readable configuration error.
   */
  if (config.NODE_ENV === 'production' && smsProvider === 'console') {
    errors.push(
      'SMS_PROVIDER must not be "console" in production: it logs recovery ' +
        'codes instead of delivering them',
    );
  }

  /**
   * Field GPS check-in thresholds.
   *
   * Each has a documented default in `field.config.ts`, so an unset variable is
   * fine; only a *set but nonsensical* value is an error. `int()` there falls
   * back silently on an unparseable value, which would turn a typo into a
   * quietly wrong threshold — this is what makes that visible at boot instead.
   */
  for (const key of [
    'FIELD_GPS_MAX_ACCURACY_METERS',
    'FIELD_GPS_MAX_LOCATION_AGE_SECONDS',
    'FIELD_GPS_MAX_CLOCK_SKEW_SECONDS',
    'FIELD_GPS_TIMEOUT_SECONDS',
    'FIELD_CHECKIN_VALIDITY_HOURS',
  ]) {
    const raw = config[key] as string | undefined;
    if (raw === undefined || raw === '') continue;

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
      errors.push(`${key} must be a whole number (received "${raw}")`);
    } else if (parsed < 0) {
      errors.push(`${key} must not be negative (received ${parsed})`);
    }
  }

  /**
   * Zero means "disabled" for the accuracy rule alone, matching
   * AUTH_MAX_CONCURRENT_SESSIONS. For the rest it would be actively unsafe: a
   * zero freshness window rejects every position, and a zero validity window
   * makes a check-in expire the instant it is issued. Reject those rather than
   * shipping a deployment where field work silently cannot proceed.
   */
  for (const key of [
    'FIELD_GPS_MAX_LOCATION_AGE_SECONDS',
    'FIELD_GPS_TIMEOUT_SECONDS',
    'FIELD_CHECKIN_VALIDITY_HOURS',
  ]) {
    const raw: unknown = config[key];

    // Accepts both spellings: process.env yields strings, but a programmatic
    // config (as the tests build) can carry real numbers. Anything else is
    // ignored rather than stringified — an object would become
    // "[object Object]", parse to NaN, and quietly pass a check whose whole
    // purpose is to reject a zero.
    const parsed =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number.parseInt(raw, 10)
          : undefined;

    if (parsed === 0) {
      errors.push(`${key} must be greater than 0`);
    }
  }

  /**
   * Customer KYC limits (Module 04).
   *
   * Same shape as the GPS block: each has a documented default in
   * `customers.config.ts`, so unset is fine and only a set-but-nonsensical value
   * is an error. Zero is rejected for all three rather than treated as
   * "disabled" — a zero-byte upload limit refuses every document, a zero-length
   * OTP is no verification at all, and zero attempts locks out the first honest
   * try.
   */
  for (const key of [
    'KYC_MAX_DOCUMENT_BYTES',
    'CUSTOMER_OTP_LENGTH',
    'CUSTOMER_OTP_TTL_MINUTES',
    'CUSTOMER_OTP_MAX_ATTEMPTS',
  ]) {
    const raw = config[key] as string | number | undefined;
    if (raw === undefined || raw === '') continue;

    const parsed =
      typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);

    if (!Number.isFinite(parsed)) {
      errors.push(`${key} must be a whole number (received "${String(raw)}")`);
    } else if (parsed <= 0) {
      errors.push(`${key} must be greater than 0 (received ${parsed})`);
    }
  }

  /**
   * Email gateway (Module 16).
   *
   * Same shape as the SMS block above, and for the same reason: only the
   * deployment-wide default is checked here. Per-organization rows live in
   * `email_provider_configs` and are validated at first use, because boot cannot
   * know what the database holds — and must not depend on it.
   */
  const emailProvider = (
    (config.EMAIL_PROVIDER as string | undefined) ?? 'console'
  ).toLowerCase();

  if (!['console', 'smtp'].includes(emailProvider)) {
    errors.push(
      `EMAIL_PROVIDER "${emailProvider}" is not supported (expected: console, smtp)`,
    );
  }

  if (emailProvider === 'smtp') {
    if (!config.SMTP_HOST) {
      errors.push('SMTP_HOST is required when EMAIL_PROVIDER=smtp');
    }
    // A message with no envelope sender is rejected by most receivers, so an
    // unset from-address is a deployment that appears configured and delivers
    // nothing.
    if (!config.SMTP_FROM_ADDRESS) {
      errors.push('SMTP_FROM_ADDRESS is required when EMAIL_PROVIDER=smtp');
    }
  }

  /**
   * ConsoleEmailProvider writes message bodies to a local file and refuses to
   * construct in production. Catching it here turns an opaque DI-time failure
   * into a readable configuration error, exactly as the SMS check above does.
   */
  if (config.NODE_ENV === 'production' && emailProvider === 'console') {
    errors.push(
      'EMAIL_PROVIDER must not be "console" in production: it writes ' +
        'notification content to a local file instead of delivering it',
    );
  }

  const smtpPort = config.SMTP_PORT as string | number | undefined;
  if (smtpPort !== undefined && smtpPort !== '') {
    const parsed =
      typeof smtpPort === 'number' ? smtpPort : Number.parseInt(smtpPort, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
      errors.push(`SMTP_PORT must be a valid port (received "${smtpPort}")`);
    }
  }

  /**
   * Notification queue settings (Module 16).
   *
   * Each has a documented default in `notifications.config.ts`, so unset is
   * fine and only a set-but-nonsensical value is an error. Zero is rejected
   * rather than treated as "disabled": a zero batch size takes no jobs and a
   * zero poll interval spins, and both are deployments where notifications
   * silently stop being delivered while the process looks healthy.
   */
  for (const key of [
    'NOTIFICATIONS_WORKER_BATCH_SIZE',
    'NOTIFICATIONS_WORKER_POLL_SECONDS',
    'NOTIFICATIONS_JOB_RETENTION_DAYS',
  ]) {
    const raw = config[key] as string | number | undefined;
    if (raw === undefined || raw === '') continue;

    const parsed =
      typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);

    if (!Number.isFinite(parsed)) {
      errors.push(`${key} must be a whole number (received "${String(raw)}")`);
    } else if (parsed <= 0) {
      errors.push(`${key} must be greater than 0 (received ${parsed})`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return config;
}
