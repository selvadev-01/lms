import { ForbiddenException, Injectable } from '@nestjs/common';
import type { RevokeSessionsResponse, SessionSummary } from '@lms/types';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import type { RequestMeta } from './auth.service';
import { SESSION_REVOKE_REASON } from './session-state';
import { SessionService } from './session.service';

/** Permission required to end a session belonging to somebody else. */
export const SESSIONS_REVOKE_PERMISSION = 'sessions.revoke';

/**
 * The Active Sessions screen: viewing and terminating sessions.
 *
 * Separate from AuthService, which owns credentials — establishing who someone
 * is and changing what proves it. This owns what happens to a session once it
 * exists, and the two share only SessionService.
 *
 * Every method takes the caller's AuthContext rather than loose ids, so the
 * scope enforced is always the authenticated one and there is no parameter a
 * handler could accidentally fill from request input (Scenarios 21, 22, 27).
 */
@Injectable()
export class SessionManagementService {
  constructor(
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Scenario 1 — the caller's own active sessions, and only those. */
  async listOwnSessions(
    user: AuthContext,
    meta: RequestMeta,
  ): Promise<SessionSummary[]> {
    const sessions = await this.sessions.listForUser(
      user.orgId,
      user.userId,
      user.sessionId,
    );

    await this.audit.record({
      orgId: user.orgId,
      action: AuditAction.SESSION_VIEWED,
      entityType: 'USER_SESSION',
      entityId: user.sessionId,
      actorUserId: user.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { sessionCount: sessions.length },
    });

    return sessions;
  }

  /**
   * Ends one of the caller's own sessions.
   *
   * Ownership lives in the where clause inside SessionService, so a caller who
   * guesses another user's session id changes nothing and learns nothing: the
   * response is identical to revoking an already-terminated session of their
   * own (Scenario 24).
   *
   * Idempotent by construction (Scenario 7) — `revokedAt: null` in the where
   * clause means a repeated revoke matches no rows and cannot reactivate
   * anything.
   */
  async revokeOwnSession(
    user: AuthContext,
    sessionId: string,
    meta: RequestMeta,
  ): Promise<RevokeSessionsResponse> {
    const isCurrent = sessionId === user.sessionId;

    const revokedCount = await this.sessions.revokeOwnedSession(
      user.orgId,
      user.userId,
      sessionId,
      // Ending your own current session is a logout; ending another of your
      // devices is a revocation. The distinction drives the derived state, so
      // the screen can say "signed out" rather than "revoked" for the former.
      isCurrent
        ? SESSION_REVOKE_REASON.USER_LOGOUT
        : SESSION_REVOKE_REASON.USER_REVOKED,
    );

    await this.audit.record({
      orgId: user.orgId,
      /**
       * Distinguishes a session that was actually ended from a request that
       * changed nothing.
       *
       * A no-op must not be recorded as a logout: the session id may have been
       * unknown, already terminated, or another user's, and claiming a
       * termination that never happened would make the audit trail describe an
       * event that did not occur. `alreadyTerminated` in the metadata says
       * which, without confirming to the caller which it was.
       */
      action:
        revokedCount > 0
          ? isCurrent
            ? AuditAction.LOGOUT
            : AuditAction.SESSION_REVOKED
          : AuditAction.SESSION_REVOKE_NOOP,
      entityType: 'USER_SESSION',
      entityId: sessionId,
      actorUserId: user.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        revokedCount,
        self: true,
        alreadyTerminated: revokedCount === 0,
      },
    });

    return {
      revokedCount,
      currentSessionRevoked: isCurrent && revokedCount > 0,
    };
  }

  /**
   * "Sign out everywhere else" — ends every other session for the caller.
   *
   * The current session is spared deliberately: signing the user out of the
   * screen they are using to secure their account would make the action feel
   * like a failure, and they can log out normally afterwards.
   */
  async revokeAllOtherSessions(
    user: AuthContext,
    meta: RequestMeta,
  ): Promise<RevokeSessionsResponse> {
    const revokedCount = await this.sessions.revokeAllExcept(
      user.orgId,
      user.userId,
      user.sessionId,
      SESSION_REVOKE_REASON.USER_REVOKED,
    );

    await this.audit.record({
      orgId: user.orgId,
      action: AuditAction.SESSION_REVOKED_ALL,
      entityType: 'USER_SESSION',
      entityId: user.sessionId,
      actorUserId: user.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { revokedCount },
    });

    return { revokedCount, currentSessionRevoked: false };
  }

  /**
   * Administrative revocation of another user's session (Scenario 23).
   *
   * The `sessions.revoke` permission is checked by PermissionsGuard before this
   * runs; what remains here is scope, which a permission cannot express: a
   * Branch Admin holding the permission may still only reach sessions within
   * their own branch, and no one may reach another organization's at all.
   *
   * `orgId` comes from the caller's session and is part of the lookup key, so a
   * cross-tenant target is not found rather than found-and-refused.
   */
  async revokeUserSession(
    actor: AuthContext,
    targetUserId: string,
    sessionId: string,
    meta: RequestMeta,
  ): Promise<RevokeSessionsResponse> {
    const target = await this.sessions.findForAdmin(actor.orgId, sessionId);

    const auditDenial = (reason: string) =>
      this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.SESSION_REVOKE_DENIED,
        entityType: 'USER_SESSION',
        entityId: sessionId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason, targetUserId },
      });

    // A session that does not exist, belongs to another tenant, or belongs to a
    // different user than the URL claims are all reported the same way, so the
    // endpoint cannot be used to discover which session ids are real.
    if (!target || target.userId !== targetUserId) {
      await auditDenial('NOT_FOUND_OR_OUT_OF_SCOPE');
      throw new ForbiddenException('Session cannot be revoked');
    }

    // A branch-scoped administrator is confined to their own branch. A caller
    // with no branch (Super Admin) is organization-wide and skips this.
    if (actor.branchId !== null && target.branchId !== actor.branchId) {
      await auditDenial('BRANCH_SCOPE');
      throw new ForbiddenException('Session cannot be revoked');
    }

    const revokedCount = await this.sessions.revokeOwnedSession(
      actor.orgId,
      targetUserId,
      sessionId,
      SESSION_REVOKE_REASON.ADMIN_REVOKED,
    );

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.SESSION_REVOKED,
      entityType: 'USER_SESSION',
      entityId: sessionId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { revokedCount, targetUserId, self: false },
    });

    return { revokedCount, currentSessionRevoked: false };
  }
}
