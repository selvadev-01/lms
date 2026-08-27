import {
  SESSION_REVOKE_REASON,
  deriveSessionState,
  type SessionTimestamps,
} from './session-state';

/**
 * Session state derivation — Active Sessions Scenarios 9, 10, 13.
 *
 * The function is pure and takes `now` as an argument, so every branch is
 * reachable without faking timers or waiting for real time to pass.
 */

const NOW = new Date('2026-08-18T12:00:00.000Z');
const MINUTE = 60_000;
const IDLE_30_MIN = 30 * MINUTE;

/** A session that is unambiguously healthy; each test spoils one property. */
function activeSession(
  overrides: Partial<SessionTimestamps> = {},
): SessionTimestamps {
  return {
    revokedAt: null,
    revokedReason: null,
    // Well inside the 7-day absolute lifetime.
    expiresAt: new Date(NOW.getTime() + 60 * MINUTE),
    // Seen a minute ago, so nowhere near the idle bound.
    lastSeenAt: new Date(NOW.getTime() - MINUTE),
    ...overrides,
  };
}

describe('deriveSessionState', () => {
  describe('active', () => {
    it('reports ACTIVE while unrevoked, unexpired and recently seen', () => {
      expect(deriveSessionState(activeSession(), IDLE_30_MIN, NOW)).toBe(
        'ACTIVE',
      );
    });

    it('treats the idle bound as not-yet-reached one millisecond before it', () => {
      const session = activeSession({
        lastSeenAt: new Date(NOW.getTime() - IDLE_30_MIN + 1),
      });
      expect(deriveSessionState(session, IDLE_30_MIN, NOW)).toBe('ACTIVE');
    });

    it('ignores idle entirely when the timeout is disabled with 0', () => {
      const longIdle = activeSession({
        lastSeenAt: new Date(NOW.getTime() - 30 * 24 * 60 * MINUTE),
      });
      expect(deriveSessionState(longIdle, 0, NOW)).toBe('ACTIVE');
    });
  });

  describe('Scenario 9: Idle session expires', () => {
    it('reports EXPIRED once the idle timeout has elapsed', () => {
      const session = activeSession({
        lastSeenAt: new Date(NOW.getTime() - IDLE_30_MIN - MINUTE),
      });
      expect(deriveSessionState(session, IDLE_30_MIN, NOW)).toBe('EXPIRED');
    });

    it('expires exactly at the idle boundary, not a moment later', () => {
      const session = activeSession({
        lastSeenAt: new Date(NOW.getTime() - IDLE_30_MIN),
      });
      expect(deriveSessionState(session, IDLE_30_MIN, NOW)).toBe('EXPIRED');
    });
  });

  describe('Scenario 10: Absolute session lifetime expires', () => {
    it('reports EXPIRED past expiresAt even when activity is recent', () => {
      const session = activeSession({
        expiresAt: new Date(NOW.getTime() - MINUTE),
        lastSeenAt: NOW,
      });
      expect(deriveSessionState(session, IDLE_30_MIN, NOW)).toBe('EXPIRED');
    });

    it('expires exactly at expiresAt', () => {
      const session = activeSession({ expiresAt: NOW });
      expect(deriveSessionState(session, IDLE_30_MIN, NOW)).toBe('EXPIRED');
    });
  });

  describe('Scenario 13: Explicitly revoked session', () => {
    it('reports REVOKED for an administrative revocation', () => {
      const session = activeSession({
        revokedAt: new Date(NOW.getTime() - MINUTE),
        revokedReason: SESSION_REVOKE_REASON.ADMIN_REVOKED,
      });
      expect(deriveSessionState(session, IDLE_30_MIN, NOW)).toBe('REVOKED');
    });

    it('reports REVOKED after a password-change revocation (Scenario 14)', () => {
      const session = activeSession({
        revokedAt: NOW,
        revokedReason: SESSION_REVOKE_REASON.PASSWORD_CHANGE,
      });
      expect(deriveSessionState(session, IDLE_30_MIN, NOW)).toBe('REVOKED');
    });

    it('reports REVOKED when the reason was never recorded', () => {
      const session = activeSession({ revokedAt: NOW, revokedReason: null });
      expect(deriveSessionState(session, IDLE_30_MIN, NOW)).toBe('REVOKED');
    });
  });

  describe('logout', () => {
    it('distinguishes USER_LOGOUT as LOGGED_OUT rather than REVOKED', () => {
      const session = activeSession({
        revokedAt: NOW,
        revokedReason: SESSION_REVOKE_REASON.USER_LOGOUT,
      });
      expect(deriveSessionState(session, IDLE_30_MIN, NOW)).toBe('LOGGED_OUT');
    });
  });

  describe('precedence', () => {
    /**
     * A terminated session is reported by how it ended, not by the fact that
     * time has since passed. Reversing this would rewrite every revocation as a
     * routine expiry once its lifetime elapsed, erasing the security signal.
     */
    it('reports REVOKED, not EXPIRED, when a revoked session is also past expiry', () => {
      const session = activeSession({
        revokedAt: new Date(NOW.getTime() - 10 * MINUTE),
        revokedReason: SESSION_REVOKE_REASON.ADMIN_REVOKED,
        expiresAt: new Date(NOW.getTime() - MINUTE),
        lastSeenAt: new Date(NOW.getTime() - 10 * 60 * MINUTE),
      });
      expect(deriveSessionState(session, IDLE_30_MIN, NOW)).toBe('REVOKED');
    });

    it('reports LOGGED_OUT, not EXPIRED, for a logged-out session past expiry', () => {
      const session = activeSession({
        revokedAt: new Date(NOW.getTime() - 10 * MINUTE),
        revokedReason: SESSION_REVOKE_REASON.USER_LOGOUT,
        expiresAt: new Date(NOW.getTime() - MINUTE),
      });
      expect(deriveSessionState(session, IDLE_30_MIN, NOW)).toBe('LOGGED_OUT');
    });

    it('prefers absolute expiry over idle when both have elapsed', () => {
      // Both produce EXPIRED, so this pins the classification rather than the
      // branch — the point is that neither condition can yield ACTIVE.
      const session = activeSession({
        expiresAt: new Date(NOW.getTime() - MINUTE),
        lastSeenAt: new Date(NOW.getTime() - 10 * 60 * MINUTE),
      });
      expect(deriveSessionState(session, IDLE_30_MIN, NOW)).toBe('EXPIRED');
    });
  });
});
