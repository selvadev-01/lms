import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { SESSION_REVOKE_REASON } from './session-state';
import { SessionService } from './session.service';

/**
 * SessionService — validation, listing and revocation.
 *
 * Exercised against an in-memory stand-in for the `user_sessions` table, which
 * is the right boundary for the questions the story asks: what is written, what
 * scope is applied, and what the caller can see. Real transaction and
 * constraint behaviour is covered by the e2e suite against Postgres.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '77777777-7777-7777-7777-777777777777';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_SESSION_ID = '44444444-4444-4444-4444-444444444444';
const BRANCH_ID = '55555555-5555-5555-5555-555555555555';

const MINUTE = 60_000;

const CONFIG_VALUES: Record<string, unknown> = {
  'auth.idleTimeoutMinutes': 30,
  'auth.sessionActivityWriteSeconds': 60,
  'auth.refreshTokenTtlDays': 7,
  'auth.maxConcurrentSessions': 0,
  'auth.sessionRetentionDays': 90,
};

const config = {
  get: (key: string) => CONFIG_VALUES[key],
} as unknown as ConfigService;

interface SessionRow {
  orgId: string;
  sessionId: string;
  userId: string;
  branchId: string | null;
  refreshTokenHash: string;
  issuedAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  const now = Date.now();
  return {
    orgId: ORG_ID,
    sessionId: SESSION_ID,
    userId: USER_ID,
    branchId: BRANCH_ID,
    refreshTokenHash: 'hash-of-a-refresh-token',
    issuedAt: new Date(now - 10 * MINUTE),
    lastSeenAt: new Date(now - MINUTE),
    expiresAt: new Date(now + 24 * 60 * MINUTE),
    revokedAt: null,
    revokedReason: null,
    ipAddress: '203.0.113.7',
    userAgent: 'jest-agent',
    ...overrides,
  };
}

/**
 * Implements only the `where` shapes this service actually issues. A predicate
 * that silently matched everything would make the scope tests meaningless, so
 * unknown keys are treated as non-matching rather than ignored.
 */
function matches(row: SessionRow, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;

    // `OR` is a list of alternative wheres — the pruning query is expressed as
    // "revoked long ago OR expired long ago", and as a list of composite keys.
    if (key === 'OR' && Array.isArray(condition)) {
      const alternatives = condition as Array<Record<string, unknown>>;
      if (!alternatives.some((clause) => matches(row, clause))) return false;
      continue;
    }

    if (key === 'revokedAt') {
      if (condition === null) {
        if (row.revokedAt !== null) return false;
        continue;
      }
      // `{ lt: cutoff }` — a row revoked before the retention cutoff. An
      // unrevoked row has no date and can never satisfy it.
      if (typeof condition === 'object') {
        const clause = condition as { lt?: Date };
        if (!clause.lt) return false;
        if (!row.revokedAt) return false;
        if (row.revokedAt.getTime() >= clause.lt.getTime()) return false;
        continue;
      }
      return false;
    }

    if (key === 'sessionId' && typeof condition === 'object' && condition) {
      const clause = condition as { not?: string; in?: string[] };
      if (clause.not !== undefined && row.sessionId === clause.not)
        return false;
      if (clause.in !== undefined && !clause.in.includes(row.sessionId)) {
        return false;
      }
      continue;
    }

    if (key === 'expiresAt' && typeof condition === 'object' && condition) {
      const clause = condition as { gt?: Date; lt?: Date };
      if (clause.gt && row.expiresAt.getTime() <= clause.gt.getTime()) {
        return false;
      }
      if (clause.lt && row.expiresAt.getTime() >= clause.lt.getTime()) {
        return false;
      }
      continue;
    }

    if (row[key as keyof SessionRow] !== condition) return false;
  }
  return true;
}

/**
 * Applies a Prisma `select` clause.
 *
 * Modelled faithfully rather than ignored, because "the query never names the
 * token hash" is exactly the property the leak tests assert — a fake that
 * returned whole rows regardless would make those tests vacuous.
 */
function project(
  row: SessionRow,
  select?: Record<string, boolean>,
): Record<string, unknown> {
  if (!select) return { ...row };
  const projected: Record<string, unknown> = {};
  for (const [column, wanted] of Object.entries(select)) {
    if (wanted) projected[column] = row[column as keyof SessionRow];
  }
  return projected;
}

class FakeDb {
  rows: SessionRow[] = [];

  reset(rows: SessionRow[] = [sessionRow()]): void {
    this.rows = rows.map((row) => ({ ...row }));
  }

  readonly userSession = {
    findUnique: jest.fn(
      ({
        where,
        select,
      }: {
        where: {
          orgId_sessionId?: { orgId: string; sessionId: string };
          // The refresh-token hash is globally unique rather than org-scoped,
          // so a token resolves without knowing which tenant issued it.
          refreshTokenHash?: string;
        };
        select?: Record<string, boolean>;
      }) => {
        const key = where.orgId_sessionId;
        const found = key
          ? this.rows.find(
              (row) =>
                row.orgId === key.orgId && row.sessionId === key.sessionId,
            )
          : this.rows.find(
              (row) => row.refreshTokenHash === where.refreshTokenHash,
            );
        return Promise.resolve(found ? project(found, select) : null);
      },
    ),

    findMany: jest.fn(
      ({
        where,
        select,
        take,
      }: {
        where: Record<string, unknown>;
        select?: Record<string, boolean>;
        // Honoured because the prune relies on it to bound one call's work; a
        // fake that ignored it would let that test pass with an unbounded query.
        take?: number;
      }) => {
        const found = this.rows
          .filter((row) => matches(row, where))
          .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
          .map((row) => project(row, select));
        return Promise.resolve(
          take === undefined ? found : found.slice(0, take),
        );
      },
    ),

    deleteMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      const before = this.rows.length;
      this.rows = this.rows.filter((row) => !matches(row, where));
      return Promise.resolve({ count: before - this.rows.length });
    }),

    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<SessionRow>;
      }) => {
        let count = 0;
        for (const row of this.rows) {
          if (!matches(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return Promise.resolve({ count });
      },
    ),
  };
}

describe('SessionService', () => {
  let db: FakeDb;
  let service: SessionService;

  beforeEach(() => {
    db = new FakeDb();
    db.reset();
    service = new SessionService(db as unknown as PrismaService, config);
  });

  describe('validateForRequest', () => {
    it('accepts an active session and reports its user and branch', async () => {
      const result = await service.validateForRequest(ORG_ID, SESSION_ID);

      expect(result).toEqual({
        state: 'ACTIVE',
        userId: USER_ID,
        branchId: BRANCH_ID,
      });
    });

    it('Scenario 28: returns null for an unknown session identifier', async () => {
      const result = await service.validateForRequest(ORG_ID, OTHER_SESSION_ID);

      expect(result).toBeNull();
    });

    it('Scenario 22: does not resolve a session belonging to another organization', async () => {
      // Same session id, different tenant — orgId is part of the primary key,
      // so this is a miss rather than a cross-tenant read.
      const result = await service.validateForRequest(OTHER_ORG_ID, SESSION_ID);

      expect(result).toBeNull();
    });

    it('Scenario 6: reports LOGGED_OUT for a session ended by logout', async () => {
      db.reset([
        sessionRow({
          revokedAt: new Date(),
          revokedReason: SESSION_REVOKE_REASON.USER_LOGOUT,
        }),
      ]);

      const result = await service.validateForRequest(ORG_ID, SESSION_ID);

      expect(result?.state).toBe('LOGGED_OUT');
    });

    it('Scenario 13: reports REVOKED for an administratively revoked session', async () => {
      db.reset([
        sessionRow({
          revokedAt: new Date(),
          revokedReason: SESSION_REVOKE_REASON.ADMIN_REVOKED,
        }),
      ]);

      const result = await service.validateForRequest(ORG_ID, SESSION_ID);

      expect(result?.state).toBe('REVOKED');
    });

    it('Scenario 10: reports EXPIRED past the absolute lifetime', async () => {
      db.reset([sessionRow({ expiresAt: new Date(Date.now() - MINUTE) })]);

      const result = await service.validateForRequest(ORG_ID, SESSION_ID);

      expect(result?.state).toBe('EXPIRED');
    });

    describe('Scenario 9: idle expiry', () => {
      it('reports EXPIRED once activity is older than the idle timeout', async () => {
        db.reset([
          sessionRow({ lastSeenAt: new Date(Date.now() - 31 * MINUTE) }),
        ]);

        const result = await service.validateForRequest(ORG_ID, SESSION_ID);

        expect(result?.state).toBe('EXPIRED');
      });

      it('persists the expiry so the state is durable and auditable', async () => {
        db.reset([
          sessionRow({ lastSeenAt: new Date(Date.now() - 31 * MINUTE) }),
        ]);

        await service.validateForRequest(ORG_ID, SESSION_ID);

        expect(db.rows[0].revokedAt).not.toBeNull();
        expect(db.rows[0].revokedReason).toBe(
          SESSION_REVOKE_REASON.IDLE_TIMEOUT,
        );
      });

      it('does not overwrite the reason a session was already revoked for', async () => {
        const revokedAt = new Date(Date.now() - 5 * MINUTE);
        db.reset([
          sessionRow({
            revokedAt,
            revokedReason: SESSION_REVOKE_REASON.ADMIN_REVOKED,
            lastSeenAt: new Date(Date.now() - 31 * MINUTE),
          }),
        ]);

        await service.validateForRequest(ORG_ID, SESSION_ID);

        expect(db.rows[0].revokedReason).toBe(
          SESSION_REVOKE_REASON.ADMIN_REVOKED,
        );
        expect(db.rows[0].revokedAt).toEqual(revokedAt);
      });
    });

    describe('activity tracking', () => {
      it('refreshes last_seen_at once the write interval has elapsed', async () => {
        const stale = new Date(Date.now() - 5 * MINUTE);
        db.reset([sessionRow({ lastSeenAt: stale })]);

        await service.validateForRequest(ORG_ID, SESSION_ID);

        expect(db.rows[0].lastSeenAt.getTime()).toBeGreaterThan(
          stale.getTime(),
        );
      });

      it('skips the write inside the interval, so a burst is not a write per request', async () => {
        const recent = new Date(Date.now() - 5_000);
        db.reset([sessionRow({ lastSeenAt: recent })]);

        await service.validateForRequest(ORG_ID, SESSION_ID);

        expect(db.userSession.updateMany).not.toHaveBeenCalled();
        expect(db.rows[0].lastSeenAt).toEqual(recent);
      });

      it('does not touch a session that is not active', async () => {
        db.reset([
          sessionRow({
            revokedAt: new Date(),
            revokedReason: SESSION_REVOKE_REASON.ADMIN_REVOKED,
            lastSeenAt: new Date(Date.now() - 5 * MINUTE),
          }),
        ]);

        await service.validateForRequest(ORG_ID, SESSION_ID);

        // updateMany is guarded by `revokedAt: null`, so nothing changed.
        expect(db.rows[0].lastSeenAt.getTime()).toBeLessThan(Date.now());
      });
    });

    it('Scenario 36: propagates a store failure rather than reporting a valid session', async () => {
      db.userSession.findUnique.mockRejectedValueOnce(
        new Error('connection refused'),
      );

      await expect(
        service.validateForRequest(ORG_ID, SESSION_ID),
      ).rejects.toThrow('connection refused');
    });
  });

  describe('listForUser', () => {
    it('Scenario 1: returns the caller’s active sessions, marking the current one', async () => {
      db.reset([
        sessionRow(),
        sessionRow({
          sessionId: OTHER_SESSION_ID,
          issuedAt: new Date(Date.now() - 60 * MINUTE),
        }),
      ]);

      const sessions = await service.listForUser(ORG_ID, USER_ID, SESSION_ID);

      expect(sessions).toHaveLength(2);
      expect(sessions.find((s) => s.sessionId === SESSION_ID)?.isCurrent).toBe(
        true,
      );
      expect(
        sessions.find((s) => s.sessionId === OTHER_SESSION_ID)?.isCurrent,
      ).toBe(false);
    });

    it('never exposes the refresh token hash', async () => {
      const sessions = await service.listForUser(ORG_ID, USER_ID, SESSION_ID);

      expect(JSON.stringify(sessions)).not.toContain('hash-of-a-refresh-token');
      expect(sessions[0]).not.toHaveProperty('refreshTokenHash');
    });

    it('omits terminated sessions, which the user cannot act on', async () => {
      db.reset([
        sessionRow(),
        sessionRow({
          sessionId: OTHER_SESSION_ID,
          revokedAt: new Date(),
          revokedReason: SESSION_REVOKE_REASON.USER_REVOKED,
        }),
      ]);

      const sessions = await service.listForUser(ORG_ID, USER_ID, SESSION_ID);

      expect(sessions.map((s) => s.sessionId)).toEqual([SESSION_ID]);
    });

    it('Scenario 24: does not return another user’s sessions', async () => {
      db.reset([
        sessionRow(),
        sessionRow({ sessionId: OTHER_SESSION_ID, userId: OTHER_USER_ID }),
      ]);

      const sessions = await service.listForUser(ORG_ID, USER_ID, SESSION_ID);

      expect(sessions.map((s) => s.sessionId)).toEqual([SESSION_ID]);
    });

    it('Scenario 22: does not return another organization’s sessions', async () => {
      db.reset([
        sessionRow(),
        sessionRow({ sessionId: OTHER_SESSION_ID, orgId: OTHER_ORG_ID }),
      ]);

      const sessions = await service.listForUser(ORG_ID, USER_ID, SESSION_ID);

      expect(sessions.map((s) => s.sessionId)).toEqual([SESSION_ID]);
    });

    it('serializes timestamps as ISO strings for the wire', async () => {
      const [session] = await service.listForUser(ORG_ID, USER_ID, SESSION_ID);

      expect(typeof session.issuedAt).toBe('string');
      expect(new Date(session.issuedAt).toISOString()).toBe(session.issuedAt);
    });
  });

  describe('revokeOwnedSession', () => {
    it('revokes the caller’s own session and records the reason', async () => {
      const count = await service.revokeOwnedSession(
        ORG_ID,
        USER_ID,
        SESSION_ID,
        SESSION_REVOKE_REASON.USER_REVOKED,
      );

      expect(count).toBe(1);
      expect(db.rows[0].revokedAt).not.toBeNull();
      expect(db.rows[0].revokedReason).toBe(SESSION_REVOKE_REASON.USER_REVOKED);
    });

    it('Scenario 7: is idempotent — a repeat revoke changes nothing', async () => {
      await service.revokeOwnedSession(
        ORG_ID,
        USER_ID,
        SESSION_ID,
        SESSION_REVOKE_REASON.USER_REVOKED,
      );
      const revokedAt = db.rows[0].revokedAt;

      const second = await service.revokeOwnedSession(
        ORG_ID,
        USER_ID,
        SESSION_ID,
        SESSION_REVOKE_REASON.USER_REVOKED,
      );

      expect(second).toBe(0);
      // Crucially, the session is not reactivated by the repeat.
      expect(db.rows[0].revokedAt).toEqual(revokedAt);
    });

    it('Scenario 24: cannot revoke a session belonging to another user', async () => {
      db.reset([sessionRow({ userId: OTHER_USER_ID })]);

      const count = await service.revokeOwnedSession(
        ORG_ID,
        USER_ID,
        SESSION_ID,
        SESSION_REVOKE_REASON.USER_REVOKED,
      );

      expect(count).toBe(0);
      expect(db.rows[0].revokedAt).toBeNull();
    });

    it('Scenario 22: cannot revoke a session in another organization', async () => {
      const count = await service.revokeOwnedSession(
        OTHER_ORG_ID,
        USER_ID,
        SESSION_ID,
        SESSION_REVOKE_REASON.USER_REVOKED,
      );

      expect(count).toBe(0);
      expect(db.rows[0].revokedAt).toBeNull();
    });
  });

  describe('revokeAllExcept', () => {
    it('ends every other session and spares the current one', async () => {
      db.reset([
        sessionRow(),
        sessionRow({ sessionId: OTHER_SESSION_ID }),
        sessionRow({ sessionId: '66666666-6666-6666-6666-666666666666' }),
      ]);

      const count = await service.revokeAllExcept(
        ORG_ID,
        USER_ID,
        SESSION_ID,
        SESSION_REVOKE_REASON.USER_REVOKED,
      );

      expect(count).toBe(2);
      expect(
        db.rows.find((r) => r.sessionId === SESSION_ID)?.revokedAt,
      ).toBeNull();
    });

    it('leaves other users’ sessions untouched', async () => {
      db.reset([
        sessionRow(),
        sessionRow({ sessionId: OTHER_SESSION_ID, userId: OTHER_USER_ID }),
      ]);

      await service.revokeAllExcept(
        ORG_ID,
        USER_ID,
        SESSION_ID,
        SESSION_REVOKE_REASON.USER_REVOKED,
      );

      expect(
        db.rows.find((r) => r.sessionId === OTHER_SESSION_ID)?.revokedAt,
      ).toBeNull();
    });
  });

  describe('findForAdmin', () => {
    it('returns the target session without its secret material', async () => {
      const found = await service.findForAdmin(ORG_ID, SESSION_ID);

      expect(found?.userId).toBe(USER_ID);
      expect(found).not.toHaveProperty('refreshTokenHash');
    });

    it('Scenario 22: does not resolve across organizations', async () => {
      const found = await service.findForAdmin(OTHER_ORG_ID, SESSION_ID);

      expect(found).toBeNull();
    });
  });

  /**
   * Refresh-token reuse detection.
   *
   * Rotation on its own only refuses the replay. What makes rotation worth
   * anything is noticing that a *spent* token came back at all, which is only
   * possible if "already rotated" stays distinguishable from "no such token" —
   * the distinction `findActiveByRefreshToken` collapses.
   */
  describe('classifyRefreshToken', () => {
    /** The service hashes the raw token, so fixtures must store the hash. */
    const RAW_TOKEN = 'a-refresh-token';
    const hashOf = (raw: string) =>
      createHash('sha256').update(raw).digest('hex');

    beforeEach(() => {
      db.reset([{ ...sessionRow(), refreshTokenHash: hashOf(RAW_TOKEN) }]);
    });

    it('reports a live token as active', async () => {
      const result = await service.classifyRefreshToken(RAW_TOKEN);

      expect(result.kind).toBe('active');
    });

    it('reports a token nobody issued as unknown', async () => {
      const result = await service.classifyRefreshToken('never-issued');

      expect(result).toEqual({ kind: 'unknown' });
    });

    it('reports a rotated token as reused', async () => {
      db.rows[0].revokedAt = new Date();
      db.rows[0].revokedReason = SESSION_REVOKE_REASON.ROTATED;

      const result = await service.classifyRefreshToken(RAW_TOKEN);

      expect(result.kind).toBe('reused');
    });

    /**
     * The distinction that keeps this from crying wolf. A session the user
     * ended themselves is simply over; presenting its token again is what a
     * stale browser tab does, not what an attacker does. Treating it as theft
     * would revoke every session of anyone who logs out with a tab still open.
     */
    it.each([
      SESSION_REVOKE_REASON.USER_LOGOUT,
      SESSION_REVOKE_REASON.ADMIN_REVOKED,
      SESSION_REVOKE_REASON.PASSWORD_CHANGE,
      SESSION_REVOKE_REASON.IDLE_TIMEOUT,
    ])('does not treat a session ended by %s as reuse', async (reason) => {
      db.rows[0].revokedAt = new Date();
      db.rows[0].revokedReason = reason;

      const result = await service.classifyRefreshToken(RAW_TOKEN);

      expect(result).toEqual({ kind: 'unknown' });
    });

    /** Expired is aged out, never spent — so it is not evidence of a replay. */
    it('does not treat an expired token as reuse', async () => {
      db.rows[0].expiresAt = new Date(Date.now() - 1000);

      const result = await service.classifyRefreshToken(RAW_TOKEN);

      expect(result).toEqual({ kind: 'unknown' });
    });
  });

  /**
   * Rotation writes a row per refresh and revokes the old one, so this table
   * only ever grew — and it is read on every authenticated request. These tests
   * pin the two things that make pruning safe: it deletes only sessions that are
   * already over, and it never touches a live one.
   */
  describe('pruneDeadSessions', () => {
    const ANCIENT = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

    it('deletes a long-revoked session', async () => {
      db.rows[0].revokedAt = ANCIENT;
      db.rows[0].revokedReason = SESSION_REVOKE_REASON.ROTATED;

      expect(await service.pruneDeadSessions()).toBe(1);
      expect(db.rows).toHaveLength(0);
    });

    it('deletes a long-expired session', async () => {
      db.rows[0].expiresAt = ANCIENT;

      expect(await service.pruneDeadSessions()).toBe(1);
      expect(db.rows).toHaveLength(0);
    });

    /** The whole point: pruning must never be able to sign anybody out. */
    it('leaves a live session alone', async () => {
      expect(await service.pruneDeadSessions()).toBe(0);
      expect(db.rows).toHaveLength(1);
    });

    /** Recently dead rows are still the evidence an investigation needs. */
    it('leaves a recently revoked session alone', async () => {
      db.rows[0].revokedAt = new Date(Date.now() - 60_000);

      expect(await service.pruneDeadSessions()).toBe(0);
      expect(db.rows).toHaveLength(1);
    });
  });
});
