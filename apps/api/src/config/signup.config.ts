import { registerAs } from '@nestjs/config';

/**
 * Public organization signup.
 *
 * Answers Q-ACT-2 (*who is authorized to create a new organization*): nobody,
 * unless this is switched on, in which case anyone who can reach
 * `POST /auth/sign-up`.
 *
 * Intended for local development and controlled trials. The endpoint always
 * exists — it returns 404 when disabled rather than being conditionally
 * registered, so the application has the same shape in every environment.
 */

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default registerAs('signup', () => ({
  /**
   * Default-deny. A deployment that never sets this variable does not let the
   * internet create tenants in it.
   *
   * Compared against the exact string rather than tested for truthiness, so
   * `ALLOW_PUBLIC_SIGNUP=false` and `=0` both correctly mean off — a truthiness
   * check enables it on the string "false".
   *
   * WARNING: switching this on in a production deployment means anyone who can
   * reach the API may create an organization. There is no email or mobile
   * verification, and each signup writes ~470 rows and burns an argon2 hash, so
   * the rate limit below is the only thing standing between the endpoint and a
   * botnet. Leave it off unless you have a specific reason not to.
   */
  allowPublicSignup:
    (process.env.ALLOW_PUBLIC_SIGNUP ?? '').toLowerCase() === 'true',

  /**
   * Signups per minute per IP. Creating an organization is a once-per-lifetime
   * act, so anything above single digits is abuse. Env-driven because a test
   * suite running from one address would otherwise throttle itself.
   */
  rateLimit: int(process.env.SIGNUP_RATE_LIMIT, 3),

  /**
   * Interactive-transaction budget for provisioning.
   *
   * The work is ~12 statements — `createMany` throughout rather than a row at a
   * time — so this is headroom for a cold connection pool rather than a figure
   * the writes need. It is bounded, and the rate limit above keeps a long-held
   * transaction from being weaponised.
   */
  transactionTimeoutMs: int(process.env.SIGNUP_TRANSACTION_TIMEOUT_MS, 30_000),
}));
