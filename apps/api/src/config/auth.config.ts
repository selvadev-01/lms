import { registerAs } from '@nestjs/config';

/**
 * Authentication configuration.
 *
 * Every threshold here is env-driven with a documented default rather than
 * hard-coded. The Sign-In story requires this explicitly (rules 20 and 49): the
 * real password-policy and lockout parameters are unresolved open questions
 * (Q-PWD-*, Q-AUTH-4/5 in docs/OPEN-QUESTIONS.md), so the values below are
 * applied defaults that can be changed without a code edit.
 */

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default registerAs('auth', () => ({
  // --- Password hashing (Q-PWD-9) -----------------------------------------
  /** argon2id is the OWASP-recommended choice for new applications. */
  argon2MemoryKib: int(process.env.AUTH_ARGON2_MEMORY_KIB, 19456), // 19 MiB
  argon2TimeCost: int(process.env.AUTH_ARGON2_TIME_COST, 2),
  argon2Parallelism: int(process.env.AUTH_ARGON2_PARALLELISM, 1),

  // --- Password policy (Q-PWD-1 .. Q-PWD-4, Q-PWD-8) -----------------------
  /**
   * Every value here applies to password *creation*, never to sign-in
   * verification: enforcing the policy at sign-in would leak it to an attacker
   * and lock out users whose password predates a policy change.
   *
   * The defaults mirror the constants in `@lms/validation`, which is what
   * actually implements the rules. They are duplicated as env vars so a
   * deployment can tighten the policy without a code change.
   */
  passwordMinLength: int(process.env.AUTH_PASSWORD_MIN_LENGTH, 12),
  passwordMaxLength: int(process.env.AUTH_PASSWORD_MAX_LENGTH, 200),
  /** How many of upper/lower/digit/symbol a password must use (Q-PWD-3). */
  passwordRequiredClasses: int(process.env.AUTH_PASSWORD_REQUIRED_CLASSES, 3),
  /**
   * Previous passwords that may not be reused (Q-PWD-4). Each check costs one
   * argon2 verification, so raising this raises the cost of a reset; 0 disables
   * history entirely.
   */
  passwordHistoryDepth: int(process.env.AUTH_PASSWORD_HISTORY_DEPTH, 5),

  // --- Lockout (Q-AUTH-4, Q-AUTH-5) ---------------------------------------
  maxFailedAttempts: int(process.env.AUTH_MAX_FAILED_ATTEMPTS, 5),
  lockDurationMinutes: int(process.env.AUTH_LOCK_DURATION_MINUTES, 15),

  // --- Session lifetimes (Q-SESS-27, Q-SESS-28) ---------------------------
  accessTokenTtl: process.env.AUTH_ACCESS_TTL ?? '15m',
  refreshTokenTtlDays: int(process.env.AUTH_REFRESH_TTL_DAYS, 7),

  /**
   * 0 means unlimited. The concurrent-session policy is undefined by the source
   * (Q-SESS-2 / Scenario 32) and is revisited in the Active-Sessions story.
   */
  // TODO(open-question): Active Sessions Scenario 26 — the source defines
  // neither a concurrent-session limit nor which session to revoke on
  // exceeding it. Left unlimited; enforceConcurrencyLimit revokes oldest-first
  // when a deployment sets a value.
  maxConcurrentSessions: int(process.env.AUTH_MAX_CONCURRENT_SESSIONS, 0),

  /**
   * Idle timeout: a session with no accepted activity for this long is treated
   * as expired on its next request (Active Sessions Scenario 9). Distinct from
   * `refreshTokenTtlDays`, which is the absolute lifetime (Scenario 10) — a
   * session dies at whichever comes first.
   */
  // TODO(open-question): Active Sessions Scenario 9 — the source does not
  // define an idle timeout. 30 minutes is an applied default.
  idleTimeoutMinutes: int(process.env.AUTH_IDLE_TIMEOUT_MINUTES, 30),

  /**
   * Minimum gap between `last_seen_at` writes.
   *
   * Idle timeout needs an activity timestamp, but writing one on every request
   * would put a row update in front of every read in the system. Refreshing it
   * at most once per this interval keeps the timeout accurate to within the
   * interval at a fraction of the write cost.
   */
  sessionActivityWriteSeconds: int(
    process.env.AUTH_SESSION_ACTIVITY_WRITE_SECONDS,
    60,
  ),

  // --- Password recovery (Q-REC-1 .. Q-REC-17) -----------------------------
  /**
   * Every value below is an applied default, not a source-defined requirement.
   * The LMS diagrams contain no Forgot Password flow at all, so the mechanism
   * (SMS OTP), its length, lifetime and attempt caps are documented decisions
   * recorded in docs/OPEN-QUESTIONS.md and changeable without a code edit.
   */
  recoveryOtpLength: int(process.env.AUTH_RECOVERY_OTP_LENGTH, 6),
  recoveryOtpTtlMinutes: int(process.env.AUTH_RECOVERY_OTP_TTL_MINUTES, 10),
  recoveryMaxOtpAttempts: int(process.env.AUTH_RECOVERY_MAX_OTP_ATTEMPTS, 5),
  /** Per-account throttle; the endpoint's @Throttle is per-IP (Q-REC-17). */
  recoveryResendCooldownSeconds: int(
    process.env.AUTH_RECOVERY_RESEND_COOLDOWN_SECONDS,
    60,
  ),
  recoveryMaxResends: int(process.env.AUTH_RECOVERY_MAX_RESENDS, 3),
  /** Lifetime of the reset authorization minted by a verified OTP. */
  recoveryTokenTtlMinutes: int(process.env.AUTH_RECOVERY_TOKEN_TTL_MINUTES, 15),

  /**
   * Per-IP request caps for the recovery endpoints, per minute.
   *
   * Env-driven like every other threshold here, and for a concrete reason: the
   * e2e suite runs many workers from one address, so a value chosen for real
   * traffic makes the suite throttle itself.
   */
  recoveryRequestRateLimit: int(process.env.AUTH_RECOVERY_RATE_LIMIT, 5),
  recoveryVerifyRateLimit: int(process.env.AUTH_RECOVERY_VERIFY_RATE_LIMIT, 10),

  /**
   * Per-IP sign-in ceiling, for the same reason and with the same caveat as the
   * recovery limits above.
   *
   * The default of 20/minute is a security control: it blunts distributed
   * guessing across many accounts, which the per-account lockout cannot see, and
   * sits well above the 5-attempt lockout so a legitimate user meets the account
   * lock rather than the rate limiter.
   *
   * It is env-driven because the e2e suite authenticates far more often than any
   * real user and does so from one address. Refresh-token rotation revokes the
   * previous session on every refresh, so browser sessions cannot be shared
   * between tests — which is correct, and which means a suite of any size
   * necessarily signs in many times. Raising this in the test environment keeps
   * throttling from masquerading as a functional failure.
   */
  signInRateLimit: int(process.env.AUTH_SIGN_IN_RATE_LIMIT, 20),

  /**
   * Deployment-wide SMS gateway, used for organizations with no row in
   * `sms_provider_configs`. Per-organization rows take precedence.
   */
  smsProvider: process.env.SMS_PROVIDER ?? 'console',

  /**
   * Twilio credentials are environment-only and never persisted: the database
   * records which provider an organization uses and how to address it, but a
   * table read must never yield something that can send SMS at your cost.
   */
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  /** Fallback addressing when an organization's row leaves these unset. */
  twilioMessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER,
  /** E.164 prefix for the 10-digit numbers stored on users. */
  twilioDefaultCountryCode: process.env.TWILIO_DEFAULT_COUNTRY_CODE ?? '+91',

  // --- Cookies -------------------------------------------------------------
  cookieSecure:
    (process.env.AUTH_COOKIE_SECURE ?? '').toLowerCase() === 'true' ||
    process.env.NODE_ENV === 'production',
  cookieDomain: process.env.AUTH_COOKIE_DOMAIN || undefined,

  /** No default — a missing secret must fail at boot, not at first login. */
  jwtSecret: process.env.AUTH_JWT_SECRET as string,

  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
}));

export const ACCESS_COOKIE = 'lms_at';
export const REFRESH_COOKIE = 'lms_rt';
/** Scoped so the refresh token is never sent on ordinary API calls. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
