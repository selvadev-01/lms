import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { SessionState, SessionSummary } from '@lms/types';

import { PrismaService } from '../prisma/prisma.service';
import {
  SESSION_REVOKE_REASON,
  SESSION_STATE,
  deriveSessionState,
  type SessionRevokeReason,
} from './session-state';

export interface CreateSessionInput {
  orgId: string;
  userId: string;
  branchId: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreatedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * The outcome of validating a session on a protected request.
 *
 * Carries the derived state even when it is not ACTIVE, so the guard can audit
 * *why* a request was rejected without repeating the derivation.
 */
export interface SessionValidation {
  state: SessionState;
  userId: string;
  branchId: string | null;
}

/**
 * Columns safe to return to a client.
 *
 * `refreshTokenHash` is absent by construction — a `select` that never names it
 * cannot leak it, which is stronger than deleting the field afterwards.
 */
const SESSION_SUMMARY_SELECT = {
  sessionId: true,
  userId: true,
  branchId: true,
  issuedAt: true,
  lastSeenAt: true,
  expiresAt: true,
  revokedAt: true,
  revokedReason: true,
  ipAddress: true,
  userAgent: true,
} as const;

/** Minimal surface of the Prisma client that session writes need. */
type SessionClient = Pick<PrismaService, 'userSession'>;

/**
 * Server-side session lifecycle.
 *
 * Sessions are database rows rather than self-contained tokens so that Logout
 * and revocation are genuinely enforceable (Scenario 36) — a stateless token
 * could not be invalidated before expiry.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Refresh tokens are hashed with SHA-256 rather than argon2 deliberately: the
   * token is 256 bits of cryptographic randomness, so it needs no work factor,
   * and refresh runs on every page load where argon2's cost would be felt.
   */
  static hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private refreshTtlMs(): number {
    const days = this.config.get<number>('auth.refreshTokenTtlDays') ?? 7;
    return days * 24 * 60 * 60 * 1000;
  }

  /** 0 disables idle expiry, leaving only the absolute lifetime. */
  private idleTimeoutMs(): number {
    const minutes = this.config.get<number>('auth.idleTimeoutMinutes') ?? 30;
    return Math.max(0, minutes) * 60 * 1000;
  }

  private activityWriteMs(): number {
    const seconds =
      this.config.get<number>('auth.sessionActivityWriteSeconds') ?? 60;
    return Math.max(0, seconds) * 1000;
  }

  /**
   * `tx` is required at sign-in so the session commits atomically with the
   * credential-validation side effects (Scenario 30: no partially active
   * session may survive a failure).
   */
  async createSession(
    input: CreateSessionInput,
    tx?: SessionClient,
  ): Promise<CreatedSession> {
    const client = tx ?? this.prisma;

    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshTtlMs());

    const session = await client.userSession.create({
      data: {
        orgId: input.orgId,
        userId: input.userId,
        branchId: input.branchId,
        refreshTokenHash: SessionService.hashToken(refreshToken),
        expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });

    return { sessionId: session.sessionId, refreshToken, expiresAt };
  }

  /** Returns the session only if it is unrevoked and unexpired. */
  async findActiveByRefreshToken(rawToken: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: SessionService.hashToken(rawToken) },
    });

    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;

    return session;
  }

  async revoke(
    orgId: string,
    sessionId: string,
    reason: string,
    tx?: SessionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.userSession.updateMany({
      where: { orgId, sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Used when a credential change must invalidate every existing session. */
  async revokeAllForUser(
    orgId: string,
    userId: string,
    reason: string,
  ): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: { orgId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  /**
   * Rotates a refresh token: the presented session is revoked and replaced, so
   * a captured token cannot be replayed after its legitimate use (Scenario 32).
   */
  async rotate(
    session: {
      orgId: string;
      sessionId: string;
      userId: string;
      branchId: string | null;
    },
    ipAddress?: string | null,
    userAgent?: string | null,
  ): Promise<CreatedSession> {
    return this.prisma.$transaction(async (tx) => {
      await this.revoke(
        session.orgId,
        session.sessionId,
        SESSION_REVOKE_REASON.ROTATED,
        tx,
      );
      return this.createSession(
        {
          orgId: session.orgId,
          userId: session.userId,
          branchId: session.branchId,
          ipAddress,
          userAgent,
        },
        tx,
      );
    });
  }

  /**
   * Enforces the configured concurrent-session cap by revoking the oldest
   * sessions. A cap of 0 means unlimited (Q-SESS-2 is unresolved).
   */
  async enforceConcurrencyLimit(orgId: string, userId: string): Promise<void> {
    const limit = this.config.get<number>('auth.maxConcurrentSessions') ?? 0;
    if (limit <= 0) return;

    const active = await this.prisma.userSession.findMany({
      where: { orgId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { issuedAt: 'desc' },
      select: { sessionId: true },
    });

    const excess = active.slice(limit);
    if (excess.length === 0) return;

    await this.prisma.userSession.updateMany({
      where: { orgId, sessionId: { in: excess.map((s) => s.sessionId) } },
      data: {
        revokedAt: new Date(),
        revokedReason: SESSION_REVOKE_REASON.CONCURRENCY_LIMIT,
      },
    });
  }

  /**
   * Validates the session behind a protected request. Called by JwtAuthGuard on
   * every authenticated route.
   *
   * This is what makes Logout and revocation real. A signed access token proves
   * only that the server issued it, never that the session behind it still
   * exists — without this lookup a logged-out or revoked session keeps working
   * until its token expires (Scenarios 11, 12, 13, 17, 28, 29).
   *
   * Deliberately does not catch: a session-store failure must reach the guard
   * and become a denial, never a silent allow (Scenario 36 — fail closed).
   *
   * Returns null when no such session exists, which covers both an unknown
   * identifier and a session belonging to another tenant, since `orgId` is part
   * of the primary key.
   */
  async validateForRequest(
    orgId: string,
    sessionId: string,
  ): Promise<SessionValidation | null> {
    const session = await this.prisma.userSession.findUnique({
      where: { orgId_sessionId: { orgId, sessionId } },
      select: {
        userId: true,
        branchId: true,
        revokedAt: true,
        revokedReason: true,
        expiresAt: true,
        lastSeenAt: true,
      },
    });

    if (!session) return null;

    const now = new Date();
    const state = deriveSessionState(session, this.idleTimeoutMs(), now);

    if (state === SESSION_STATE.ACTIVE) {
      await this.touchLastSeen(orgId, sessionId, session.lastSeenAt, now);
    } else if (!session.revokedAt) {
      // Persist the expiry so the state is durable and the audit trail shows a
      // terminated session rather than one that merely looks stale on read.
      await this.markExpired(orgId, sessionId, now);
    }

    return { state, userId: session.userId, branchId: session.branchId };
  }

  /**
   * Refreshes the activity timestamp, but at most once per the configured
   * interval: idle timeout needs an activity clock, yet writing one on every
   * request would put a row update in front of every read in the system.
   *
   * `updateMany` with `revokedAt: null` so a session revoked between the read
   * above and this write is not resurrected by a stray activity touch.
   */
  private async touchLastSeen(
    orgId: string,
    sessionId: string,
    lastSeenAt: Date,
    now: Date,
  ): Promise<void> {
    const interval = this.activityWriteMs();
    if (now.getTime() - lastSeenAt.getTime() < interval) return;

    await this.prisma.userSession.updateMany({
      where: { orgId, sessionId, revokedAt: null },
      data: { lastSeenAt: now },
    });
  }

  private async markExpired(
    orgId: string,
    sessionId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { orgId, sessionId, revokedAt: null },
      data: {
        revokedAt: now,
        revokedReason: SESSION_REVOKE_REASON.IDLE_TIMEOUT,
      },
    });
  }

  /**
   * The user's sessions, newest first, for the Active Sessions screen.
   *
   * Scoped by `orgId` *and* `userId` in the query itself — a caller can only
   * ever see their own sessions, and cross-tenant reads are impossible rather
   * than merely filtered afterwards (Scenarios 22, 24).
   */
  async listForUser(
    orgId: string,
    userId: string,
    currentSessionId: string,
  ): Promise<SessionSummary[]> {
    const rows = await this.prisma.userSession.findMany({
      where: { orgId, userId },
      orderBy: { issuedAt: 'desc' },
      select: SESSION_SUMMARY_SELECT,
    });

    const idleMs = this.idleTimeoutMs();
    const now = new Date();

    return (
      rows
        .map((row) => ({
          sessionId: row.sessionId,
          state: deriveSessionState(row, idleMs, now),
          isCurrent: row.sessionId === currentSessionId,
          issuedAt: row.issuedAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          ipAddress: row.ipAddress,
          userAgent: row.userAgent,
          branchId: row.branchId,
        }))
        // Terminated sessions are retained in the table for audit, but listing
        // them would turn the screen into a history log rather than the set of
        // sessions the user can act on.
        .filter((session) => session.state === SESSION_STATE.ACTIVE)
    );
  }

  /**
   * Revokes one session belonging to a specific user.
   *
   * `userId` is part of the where clause rather than checked after a fetch, so
   * revoking someone else's session cannot succeed even by guessing a valid
   * session id (Scenarios 21, 22, 24).
   *
   * Returns the number of rows actually changed: 0 means the session was
   * already terminated, absent, or another user's. All three are reported to
   * the caller identically, which keeps the endpoint from confirming whether a
   * session id exists.
   */
  async revokeOwnedSession(
    orgId: string,
    userId: string,
    sessionId: string,
    reason: SessionRevokeReason,
  ): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: { orgId, userId, sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  /**
   * Ends every session for a user except one — "sign out everywhere else".
   *
   * The caller's own session is preserved so the user is not signed out of the
   * screen they are using to secure their account.
   */
  async revokeAllExcept(
    orgId: string,
    userId: string,
    exceptSessionId: string,
    reason: SessionRevokeReason,
  ): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: {
        orgId,
        userId,
        revokedAt: null,
        sessionId: { not: exceptSessionId },
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  /**
   * Looks up a session for the administrative revoke path, which must know the
   * target's branch before deciding whether the caller may act on it.
   *
   * Returns only non-secret columns.
   */
  async findForAdmin(orgId: string, sessionId: string) {
    return this.prisma.userSession.findUnique({
      where: { orgId_sessionId: { orgId, sessionId } },
      select: SESSION_SUMMARY_SELECT,
    });
  }
}
