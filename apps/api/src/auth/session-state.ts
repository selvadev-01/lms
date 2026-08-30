import type { SessionState } from '@lms/types';

/**
 * Session lifecycle derivation.
 *
 * The Active Sessions story lists a `status` column with the four values below,
 * but `user_sessions` stores `revoked_at` + `revoked_reason` + `expires_at`
 * instead. That is deliberately kept: those columns record *when* and *why* a
 * session ended, not merely *that* it did, and a derived state cannot drift out
 * of step with the timestamps that actually decide it the way a stored copy
 * could.
 *
 * Runtime values are declared here rather than imported from @lms/constants:
 * that package ships raw ESM with no build step, so the CJS Nest build cannot
 * require it. The two lists must be kept in step — @lms/constants SESSION_STATE
 * and SESSION_REVOKE_REASON are the shared declaration for web.
 */

export const SESSION_STATE = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  LOGGED_OUT: 'LOGGED_OUT',
} as const satisfies Record<string, SessionState>;

/**
 * Written to `user_sessions.revoked_reason`, which is VARCHAR(50).
 *
 * ROTATED, CONCURRENCY_LIMIT, PASSWORD_CHANGE, PASSWORD_RESET,
 * ACCOUNT_INELIGIBLE and ORG_INACTIVE predate this story and are already
 * written by AuthService, RecoveryService and SessionService.
 */
export const SESSION_REVOKE_REASON = {
  /** The user chose Logout. The only reason that derives to LOGGED_OUT. */
  USER_LOGOUT: 'USER_LOGOUT',
  /** The user ended one of their own other sessions from Active Sessions. */
  USER_REVOKED: 'USER_REVOKED',
  /** An authorized administrator ended someone else's session. */
  ADMIN_REVOKED: 'ADMIN_REVOKED',
  IDLE_TIMEOUT: 'IDLE_TIMEOUT',
  ROTATED: 'ROTATED',
  CONCURRENCY_LIMIT: 'CONCURRENCY_LIMIT',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',
  ACCOUNT_INELIGIBLE: 'ACCOUNT_INELIGIBLE',
  ORG_INACTIVE: 'ORG_INACTIVE',
  /**
   * A refresh token was presented after it had already been rotated away.
   *
   * Rotation alone only refuses the replay; it says nothing about why a token
   * that was already spent came back. Either the legitimate holder raced
   * themselves, or someone else has a copy — and the two are indistinguishable
   * from here, so this is treated as theft and every session the user holds is
   * ended. See `AuthService.refresh`.
   */
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
} as const;

export type SessionRevokeReason =
  (typeof SESSION_REVOKE_REASON)[keyof typeof SESSION_REVOKE_REASON];

/** The columns state derivation depends on — anything wider is a Prisma row. */
export interface SessionTimestamps {
  revokedAt: Date | null;
  revokedReason: string | null;
  expiresAt: Date;
  lastSeenAt: Date;
}

/**
 * Classifies a session. Pure — it neither reads the clock nor touches the
 * database, so the caller supplies `now` and every branch is directly testable.
 *
 * Order is significant. An explicit termination outranks expiry: a session that
 * was revoked and has since passed its expiry is still REVOKED, because that is
 * the fact worth reporting and auditing. Only then does absolute lifetime
 * (Scenario 10) apply, and only then idle timeout (Scenario 9) — checked last
 * because it is the weakest claim, and a session cannot be idle-expired while a
 * harder terminal state already holds.
 *
 * @param idleTimeoutMs 0 disables idle expiry, leaving only absolute lifetime.
 */
export function deriveSessionState(
  session: SessionTimestamps,
  idleTimeoutMs: number,
  now: Date,
): SessionState {
  if (session.revokedAt) {
    return session.revokedReason === SESSION_REVOKE_REASON.USER_LOGOUT
      ? SESSION_STATE.LOGGED_OUT
      : SESSION_STATE.REVOKED;
  }

  const nowMs = now.getTime();

  if (session.expiresAt.getTime() <= nowMs) return SESSION_STATE.EXPIRED;

  if (
    idleTimeoutMs > 0 &&
    session.lastSeenAt.getTime() + idleTimeoutMs <= nowMs
  ) {
    return SESSION_STATE.EXPIRED;
  }

  return SESSION_STATE.ACTIVE;
}
