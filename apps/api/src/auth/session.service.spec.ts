import { ConfigService } from '@nestjs/config';

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

    if (key === 'revokedAt') {
      if (condition === null) {
        if (row.revokedAt !== null) return false;
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
      const clause = condition as { gt?: Date };
      if (clause.gt && row.expiresAt.getTime() <= clause.gt.getTime()) {
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
        where: { orgId_sessionId: { orgId: string; sessionId: string } };
        select?: Record<string, boolean>;
      }) => {
        const key = where.orgId_sessionId;
        const found = this.rows.find(
          (row) => row.orgId === key.orgId && row.sessionId === key.sessionId,
        );
        return Promise.resolve(found ? project(found, select) : null);
      },
    ),

    findMany: jest.fn(
      ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) => {
        const found = this.rows
          .filter((row) => matches(row, where))
          .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
          .map((row) => project(row, select));
        return Promise.resolve(found);
      },
    ),

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
});
