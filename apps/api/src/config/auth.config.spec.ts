import { durationMs } from './auth.config';

/**
 * The access cookie's `maxAge` is derived from `AUTH_ACCESS_TTL` so the cookie
 * and the token it carries expire together. That makes this parser part of the
 * session lifetime: read it wrong and the session ends at a time nothing in the
 * configuration explains.
 */
describe('durationMs', () => {
  const FALLBACK = 15 * 60 * 1000;

  it.each([
    ['15m', 15 * 60 * 1000],
    ['1h', 60 * 60 * 1000],
    ['7d', 7 * 24 * 60 * 60 * 1000],
    ['30s', 30_000],
    ['500ms', 500],
  ])('reads %s', (value, expected) => {
    expect(durationMs(value, FALLBACK)).toBe(expected);
  });

  /** `jsonwebtoken` reads a bare number as seconds, not milliseconds. */
  it('treats a bare number as milliseconds, matching the ms library', () => {
    expect(durationMs('900', FALLBACK)).toBe(900);
  });

  it('tolerates surrounding whitespace and an inner space', () => {
    expect(durationMs('  15m  ', FALLBACK)).toBe(15 * 60 * 1000);
    expect(durationMs('15 m', FALLBACK)).toBe(15 * 60 * 1000);
  });

  it.each([undefined, '', 'fifteen minutes', '15y', '-5m', '1.5h'])(
    'falls back for %s rather than producing a wrong lifetime',
    (value) => {
      expect(durationMs(value, FALLBACK)).toBe(FALLBACK);
    },
  );
});

/**
 * Config values must be reachable through the `auth` namespace.
 *
 * `DEFAULT_RATE_LIMIT` was originally read from `process.env` inside the
 * ThrottlerModule factory, on the assumption that ConfigModule had already
 * populated it. It had not, so a deployment that configured the limit silently
 * got the default — and nothing failed, which is what made it survive.
 * Registering it here is what makes the value actually arrive.
 */
describe('authConfig', () => {
  const ORIGINAL = process.env;

  afterEach(() => {
    process.env = ORIGINAL;
  });

  function load(env: Record<string, string | undefined>) {
    process.env = { ...ORIGINAL, ...env };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const factory = require('./auth.config').default as () => Record<
      string,
      unknown
    >;
    return factory();
  }

  it('reads DEFAULT_RATE_LIMIT from the environment', () => {
    expect(load({ DEFAULT_RATE_LIMIT: '5000' }).defaultRateLimit).toBe(5000);
  });

  it('falls back to 240 when DEFAULT_RATE_LIMIT is unset', () => {
    expect(load({ DEFAULT_RATE_LIMIT: undefined }).defaultRateLimit).toBe(240);
  });

  it('reads TRUSTED_PROXY_HOPS, defaulting to 0 for a directly exposed process', () => {
    expect(load({ TRUSTED_PROXY_HOPS: '2' }).trustedProxyHops).toBe(2);
    expect(load({ TRUSTED_PROXY_HOPS: undefined }).trustedProxyHops).toBe(0);
  });

  it('reads AUTH_SESSION_RETENTION_DAYS', () => {
    expect(
      load({ AUTH_SESSION_RETENTION_DAYS: '30' }).sessionRetentionDays,
    ).toBe(30);
  });
});
