import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import {
  PasswordPolicyException,
  PasswordPolicyService,
} from './password-policy.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import type { AuthContext } from '../common/auth-context';

/**
 * Change Password, exercised against an in-memory stand-in for Prisma. The
 * behaviours the story cares about — what is written, what is deliberately NOT
 * written, and what an attacker can infer — are all observable at that boundary.
 *
 * Two things this cannot verify, both covered by the e2e suite against
 * Postgres: real transaction rollback (Scenarios 28 and 33), since the fake's
 * `$transaction` simply invokes the callback with no rollback semantics, and
 * the end-to-end effect of session revocation (Scenario 24).
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const MOBILE = '9000000001';
const ORG_CODE = 'DEMO';
const USER_NAME = 'Priya Sharma';

/**
 * Both satisfy the policy — 12+ characters, three character classes, not
 * blocklisted, containing none of the account identifiers — and differ from
 * each other, which the reuse rule requires.
 */
const CURRENT_PASSWORD = 'Kestrel7Vault';
const NEW_PASSWORD = 'Marigold4Ledger';

/** Low argon2 cost so the suite stays fast; production values come from config. */
const CONFIG_VALUES: Record<string, unknown> = {
  'auth.argon2MemoryKib': 1024,
  'auth.argon2TimeCost': 1,
  'auth.argon2Parallelism': 1,
  'auth.passwordHistoryDepth': 5,
};

const config = {
  get: (key: string) => CONFIG_VALUES[key],
} as unknown as ConfigService;

type UserRow = {
  orgId: string;
  userId: string;
  name: string;
  mobile: string | null;
  status: string;
  passwordHash: string | null;
  passwordChangedAt: Date | null;
  lockedUntil: Date | null;
  failedLoginAttempts: number;
  branchId: string | null;
};

type PasswordHistoryRow = {
  orgId: string;
  historyId: string;
  userId: string;
  passwordHash: string;
  createdAt: Date;
};

/** Minimal predicate matcher covering the `where` shapes this service uses. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && 'in' in expected) {
      return (expected.in as unknown[]).includes(actual);
    }
    return actual === expected;
  });
}

class FakeDb {
  users: UserRow[] = [];
  passwordHistory: PasswordHistoryRow[] = [];
  organizations = [{ orgId: ORG_ID, code: ORG_CODE, status: 'ACTIVE' }];
  audits: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
  private historySeq = 0;

  reset(userOverrides: Partial<UserRow> = {}) {
    this.users = [
      {
        orgId: ORG_ID,
        userId: USER_ID,
        name: USER_NAME,
        mobile: MOBILE,
        status: 'ACTIVE',
        passwordHash: null,
        passwordChangedAt: null,
        lockedUntil: null,
        failedLoginAttempts: 0,
        branchId: null,
        ...userOverrides,
      },
    ];
    this.passwordHistory = [];
    this.audits = [];
    this.organizations = [{ orgId: ORG_ID, code: ORG_CODE, status: 'ACTIVE' }];
  }

  nextHistoryId(): string {
    this.historySeq += 1;
    return `hist-${this.historySeq}`;
  }

  user(): UserRow {
    const row = this.users[0];
    if (!row) throw new Error('No user row');
    return row;
  }

  client(db: FakeDb = this): PrismaService {
    const api = {
      user: {
        /**
         * changePassword reads the account for the identifiers a password may
         * not contain, so the fake must return the organization relation the
         * real query selects.
         */
        findUnique: ({
          where,
        }: {
          where: { orgId_userId: { orgId: string; userId: string } };
        }) => {
          const { orgId, userId } = where.orgId_userId;
          const row = db.users.find(
            (u) => u.orgId === orgId && u.userId === userId,
          );
          if (!row) return Promise.resolve(null);
          const organization = db.organizations.find((o) => o.orgId === orgId);
          return Promise.resolve({
            ...row,
            organization: { code: organization?.code ?? ORG_CODE },
          });
        },
        update: ({
          where,
          data,
        }: {
          where: { orgId_userId: { orgId: string; userId: string } };
          data: Partial<UserRow>;
        }) => {
          const { orgId, userId } = where.orgId_userId;
          const row = db.users.find(
            (u) => u.orgId === orgId && u.userId === userId,
          );
          if (!row) throw new Error('User not found');
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      },
      passwordHistory: {
        findMany: ({
          where,
          take,
        }: {
          where: Record<string, unknown>;
          take?: number;
          orderBy?: unknown;
          select?: unknown;
        }) => {
          // Always newest-first, matching the single `orderBy` the service uses.
          const rows = db.passwordHistory
            .filter((r) => matches(r, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return Promise.resolve(take == null ? rows : rows.slice(0, take));
        },
        create: ({ data }: { data: Partial<PasswordHistoryRow> }) => {
          const row: PasswordHistoryRow = {
            historyId: db.nextHistoryId(),
            // Monotonic per insert: real rows are ordered by a timestamp, and
            // several can otherwise land inside the same millisecond here.
            createdAt: new Date(Date.now() + db.passwordHistory.length),
            ...data,
          } as PasswordHistoryRow;
          db.passwordHistory.push(row);
          return Promise.resolve(row);
        },
        deleteMany: ({ where }: { where: Record<string, unknown> }) => {
          const before = db.passwordHistory.length;
          db.passwordHistory = db.passwordHistory.filter(
            (r) => !matches(r, where),
          );
          return Promise.resolve({ count: before - db.passwordHistory.length });
        },
      },
      auditLog: { create: () => Promise.resolve({}) },
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(api),
    };
    return api as unknown as PrismaService;
  }
}

describe('AuthService.changePassword', () => {
  const db = new FakeDb();
  let service: AuthService;
  let passwords: PasswordService;
  let revokeAllForUser: jest.Mock;
  let auditRecord: jest.Mock;

  const ctx: AuthContext = {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: ORG_CODE,
    sessionId: SESSION_ID,
    branchId: null,
    roles: [],
    permissions: [],
  };

  const change = (
    currentPassword = CURRENT_PASSWORD,
    newPassword = NEW_PASSWORD,
  ) => service.changePassword(ctx, { currentPassword, newPassword }, {});

  const actions = () => db.audits.map((a) => a.action);

  beforeAll(async () => {
    passwords = new PasswordService(config);
    await passwords.onModuleInit();
  });

  beforeEach(async () => {
    db.reset({ passwordHash: await passwords.hash(CURRENT_PASSWORD) });
    revokeAllForUser = jest.fn().mockResolvedValue(2);

    auditRecord = jest.fn(
      (input: { action: string; metadata?: Record<string, unknown> }) => {
        db.audits.push({ action: input.action, metadata: input.metadata });
        return Promise.resolve();
      },
    );

    const audit = { record: auditRecord } as unknown as AuditService;
    const sessions = { revokeAllForUser } as unknown as SessionService;

    service = new AuthService(
      db.client(),
      passwords,
      new PasswordPolicyService(db.client(), passwords, config),
      sessions,
      audit,
      {} as unknown as JwtService,
      config,
      // A real service over the same stand-in rather than a mock: these tests
      // cover Change Password, which never resolves authorization, so a mock
      // would assert nothing while a real one would fail loudly if that changed.
      new AuthorizationService(db.client()),
    );
  });

  /**
   * Scenario 26 / rule 10, asserted for every case rather than case by case: a
   * plaintext password must never reach an audit record, whatever the outcome.
   */
  afterEach(() => {
    const serialized = JSON.stringify(db.audits);
    expect(serialized).not.toContain(CURRENT_PASSWORD);
    expect(serialized).not.toContain(NEW_PASSWORD);
  });

  // ---------------------------------------------------------------------------
  describe('successful change', () => {
    /** Scenario 17. */
    it('replaces the stored hash and stamps the change time', async () => {
      const before = db.user().passwordHash;
      await change();

      const row = db.user();
      expect(row.passwordHash).not.toBe(before);
      expect(row.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await passwords.verify(row.passwordHash, NEW_PASSWORD)).toBe(true);
      expect(row.passwordChangedAt).toBeInstanceOf(Date);
    });

    /** Scenario 17: the old password can no longer authenticate. */
    it('leaves the old password unable to verify', async () => {
      await change();
      expect(
        await passwords.verify(db.user().passwordHash, CURRENT_PASSWORD),
      ).toBe(false);
    });

    /** Rule 8 — history is what makes Scenario 14 enforceable next time. */
    it('records the new hash in the password history', async () => {
      await change();
      expect(db.passwordHistory).toHaveLength(1);
      expect(db.passwordHistory[0]?.passwordHash).toBe(db.user().passwordHash);
    });

    /** Scenario 39. */
    it('audits the completed change', async () => {
      await change();
      expect(actions()).toContain('AUTH_PASSWORD_CHANGE_COMPLETED');
    });

    /** Scenarios 23 and 25. */
    it('revokes every session for the user', async () => {
      await change();
      expect(revokeAllForUser).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        'PASSWORD_CHANGE',
      );
    });

    /**
     * Scenarios 18, 19, 20, 30 and 31 together. These hold because the update
     * touches only the credential columns, so the assertion is that everything
     * else is untouched rather than that anything specific happened.
     */
    it('changes nothing about the account beyond the credential', async () => {
      const before = { ...db.user() };
      await change();

      const after = db.user();
      expect(after.status).toBe(before.status);
      expect(after.branchId).toBe(before.branchId);
      expect(after.failedLoginAttempts).toBe(before.failedLoginAttempts);
      expect(after.lockedUntil).toBe(before.lockedUntil);
      expect(after.orgId).toBe(before.orgId);
      expect(after.userId).toBe(before.userId);
    });
  });

  // ---------------------------------------------------------------------------
  describe('current-password verification', () => {
    /** Scenario 8. */
    it('rejects an incorrect current password and leaves the credential intact', async () => {
      const before = db.user().passwordHash;
      await expect(change('WrongPassword9Z')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(db.user().passwordHash).toBe(before);
      expect(db.user().passwordChangedAt).toBeNull();
    });

    /** Scenarios 8 and 40. */
    it('audits the credential denial', async () => {
      await expect(change('WrongPassword9Z')).rejects.toThrow();
      expect(actions()).toContain('AUTH_PASSWORD_CHANGE_DENIED_CREDENTIALS');
    });

    /**
     * The applied answer to the story's Open Question under Scenario 9: an
     * authenticated endpoint must not feed the sign-in lockout counter, or
     * anyone reaching an open session could lock the real user out.
     */
    it('does not touch the sign-in lockout state', async () => {
      await expect(change('WrongPassword9Z')).rejects.toThrow();
      expect(db.user().failedLoginAttempts).toBe(0);
      expect(db.user().lockedUntil).toBeNull();
      expect(db.user().status).toBe('ACTIVE');
    });

    /** Scenario 11: a failed change must not disturb sessions. */
    it('revokes no sessions', async () => {
      await expect(change('WrongPassword9Z')).rejects.toThrow();
      expect(revokeAllForUser).not.toHaveBeenCalled();
    });

    /** No history is written for a change that never happened. */
    it('writes no password history', async () => {
      await expect(change('WrongPassword9Z')).rejects.toThrow();
      expect(db.passwordHistory).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('password policy', () => {
    /** Scenarios 12 and 13. */
    it('rejects a new password that fails the complexity policy', async () => {
      const before = db.user().passwordHash;
      await expect(
        change(CURRENT_PASSWORD, 'abcdefghijklmnop'),
      ).rejects.toBeInstanceOf(PasswordPolicyException);
      expect(db.user().passwordHash).toBe(before);
      expect(db.audits.at(-1)).toMatchObject({
        action: 'AUTH_PASSWORD_CHANGE_FAILED',
        metadata: { reason: 'POLICY' },
      });
    });

    /** Scenario 16: the account's own identifiers are not usable as a password. */
    it('rejects a new password containing an account identifier', async () => {
      await expect(
        change(CURRENT_PASSWORD, `Ledger${MOBILE}x`),
      ).rejects.toBeInstanceOf(PasswordPolicyException);
      expect(db.audits.at(-1)).toMatchObject({
        metadata: { reason: 'POLICY' },
      });
    });

    /**
     * Scenario 15. Surfaces as reuse rather than as a distinct rule, because
     * assertNotReused checks the current hash before walking the history.
     */
    it('rejects a new password identical to the current one', async () => {
      await expect(
        change(CURRENT_PASSWORD, CURRENT_PASSWORD),
      ).rejects.toBeInstanceOf(PasswordPolicyException);
      expect(db.audits.at(-1)).toMatchObject({
        action: 'AUTH_PASSWORD_CHANGE_FAILED',
        metadata: { reason: 'HISTORY' },
      });
    });

    /** Scenario 14. */
    it('rejects a new password held in the history', async () => {
      const stale = 'Thornfield3Anvil';
      db.passwordHistory.push({
        orgId: ORG_ID,
        historyId: db.nextHistoryId(),
        userId: USER_ID,
        passwordHash: await passwords.hash(stale),
        createdAt: new Date(),
      });

      await expect(change(CURRENT_PASSWORD, stale)).rejects.toBeInstanceOf(
        PasswordPolicyException,
      );
      expect(db.user().passwordHash).not.toBe(stale);
      expect(db.audits.at(-1)).toMatchObject({
        metadata: { reason: 'HISTORY' },
      });
    });

    it('revokes no sessions when the policy rejects the password', async () => {
      await expect(
        change(CURRENT_PASSWORD, 'abcdefghijklmnop'),
      ).rejects.toThrow();
      expect(revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('account eligibility', () => {
    /** Scenario 21: a session that outlived its account's eligibility. */
    it('denies a deactivated account', async () => {
      db.reset({
        status: 'INACTIVE',
        passwordHash: await passwords.hash(CURRENT_PASSWORD),
      });
      const before = db.user().passwordHash;

      await expect(change()).rejects.toBeInstanceOf(UnauthorizedException);
      expect(db.user().passwordHash).toBe(before);
      expect(db.audits.at(-1)).toMatchObject({
        action: 'AUTH_PASSWORD_CHANGE_DENIED_INELIGIBLE',
        metadata: { status: 'INACTIVE' },
      });
    });

    /**
     * Scenario 21 again, at a finer grain: eligibility is checked before any
     * password material is touched, so the endpoint cannot be used as a
     * password oracle against an account that is no longer allowed in.
     */
    it('denies a deactivated account without verifying the password', async () => {
      db.reset({
        status: 'INACTIVE',
        passwordHash: await passwords.hash(CURRENT_PASSWORD),
      });
      const verify = jest.spyOn(passwords, 'verify');

      await expect(change()).rejects.toThrow();
      expect(verify).not.toHaveBeenCalled();
      verify.mockRestore();
    });

    /** Scenario 22. */
    it('denies a locked account whose lock is still live', async () => {
      db.reset({
        status: 'LOCKED',
        lockedUntil: new Date(Date.now() + 60_000),
        passwordHash: await passwords.hash(CURRENT_PASSWORD),
      });

      await expect(change()).rejects.toBeInstanceOf(UnauthorizedException);
      expect(actions()).toContain('AUTH_PASSWORD_CHANGE_DENIED_INELIGIBLE');
    });

    /**
     * Rule 15, and the deliberate divergence from signIn: sign-in restores an
     * account whose lock has elapsed, Change Password must not, or it becomes a
     * way to clear a lock. The guard is that the account is still LOCKED after.
     */
    it('does not clear an expired lock', async () => {
      db.reset({
        status: 'LOCKED',
        lockedUntil: new Date(Date.now() - 60_000),
        passwordHash: await passwords.hash(CURRENT_PASSWORD),
      });

      await expect(change()).rejects.toBeInstanceOf(UnauthorizedException);
      expect(db.user().status).toBe('LOCKED');
      expect(db.user().lockedUntil).not.toBeNull();
      expect(actions()).toContain('AUTH_PASSWORD_CHANGE_DENIED_INELIGIBLE');
    });

    /** A valid token whose user row has gone is a session fault, not a credential one. */
    it('rejects when the account row no longer exists', async () => {
      db.users = [];
      await expect(change()).rejects.toBeInstanceOf(UnauthorizedException);
      // No audit row: AuditLog.actorUserId is a composite FK into users, so a
      // record naming a non-existent user could not be inserted.
      expect(db.audits).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('post-commit failures', () => {
    /**
     * Scenario 34. The committed change must stand — reverting it would leave
     * the user's new password silently non-existent while they believe it works.
     */
    it('keeps the new password when session revocation fails', async () => {
      revokeAllForUser.mockRejectedValue(
        new Error('session store unavailable'),
      );

      await expect(change()).resolves.toBeUndefined();
      expect(await passwords.verify(db.user().passwordHash, NEW_PASSWORD)).toBe(
        true,
      );
      expect(db.audits.at(-1)).toMatchObject({
        action: 'AUTH_PASSWORD_CHANGE_REVOCATION_FAILED',
        metadata: { sessionInvalidationStatus: 'FAILED' },
      });
    });

    /** Scenario 35: an audit failure must not undo or fail a committed change. */
    it('still succeeds when the escalation audit write fails', async () => {
      revokeAllForUser.mockRejectedValue(
        new Error('session store unavailable'),
      );
      auditRecord.mockImplementation((input: { action: string }) => {
        if (input.action === 'AUTH_PASSWORD_CHANGE_REVOCATION_FAILED') {
          return Promise.reject(new Error('audit sink unavailable'));
        }
        db.audits.push({ action: input.action });
        return Promise.resolve();
      });

      await expect(change()).resolves.toBeUndefined();
      expect(await passwords.verify(db.user().passwordHash, NEW_PASSWORD)).toBe(
        true,
      );
    });
  });
});
