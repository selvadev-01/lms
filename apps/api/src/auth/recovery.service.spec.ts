import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { PasswordPolicyService } from './password-policy.service';
import { PasswordService } from './password.service';
import { RecoveryService } from './recovery.service';
import { SessionService } from './session.service';

/**
 * These tests exercise RecoveryService against an in-memory stand-in for
 * Prisma rather than a live database. The behaviours the Forgot Password story
 * actually cares about — what is written, what is deliberately NOT written, and
 * what the caller can infer — are all observable at that boundary.
 *
 * `FOR UPDATE` row locking and real transaction rollback are the two things
 * this cannot verify; those are covered by the e2e suite against Postgres.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const MOBILE = '9000000001';
const ORG_CODE = 'DEMO';
const USER_NAME = 'Priya Sharma';

/**
 * A password that satisfies the policy: 12+ characters, three character
 * classes, not blocklisted, and containing none of the account identifiers.
 */
const COMPLIANT_PASSWORD = 'Kestrel7Vault';

/** Low argon2 cost so the suite stays fast; production values come from config. */
const CONFIG_VALUES: Record<string, unknown> = {
  'auth.argon2MemoryKib': 1024,
  'auth.argon2TimeCost': 1,
  'auth.argon2Parallelism': 1,
  'auth.recoveryOtpLength': 6,
  'auth.recoveryOtpTtlMinutes': 10,
  'auth.recoveryMaxOtpAttempts': 5,
  'auth.recoveryResendCooldownSeconds': 60,
  'auth.recoveryMaxResends': 3,
  'auth.recoveryTokenTtlMinutes': 15,
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

type RecoveryRow = {
  orgId: string;
  requestId: string;
  userId: string;
  otpHash: string;
  resetTokenHash: string | null;
  status: string;
  attemptCount: number;
  resendCount: number;
  lastSentAt: Date;
  expiresAt: Date;
  tokenExpiresAt: Date | null;
  consumedAt: Date | null;
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
  recoveries: RecoveryRow[] = [];
  passwordHistory: PasswordHistoryRow[] = [];
  organizations = [{ orgId: ORG_ID, code: ORG_CODE, status: 'ACTIVE' }];
  audits: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
  private seq = 0;
  private historySeq = 0;

  reset(userOverrides: Partial<UserRow> = {}) {
    this.users = [
      {
        orgId: ORG_ID,
        userId: USER_ID,
        name: USER_NAME,
        mobile: MOBILE,
        status: 'ACTIVE',
        passwordHash: 'existing-hash',
        passwordChangedAt: null,
        lockedUntil: null,
        failedLoginAttempts: 0,
        branchId: null,
        ...userOverrides,
      },
    ];
    this.recoveries = [];
    this.passwordHistory = [];
    this.audits = [];
    this.organizations = [{ orgId: ORG_ID, code: ORG_CODE, status: 'ACTIVE' }];
  }

  nextHistoryId(): string {
    this.historySeq += 1;
    return `hist-${this.historySeq}`;
  }

  nextId(): string {
    this.seq += 1;
    return `req-${this.seq}`;
  }

  client(db: FakeDb = this): PrismaService {
    const api = {
      organization: {
        findUnique: ({ where }: { where: { code: string } }) =>
          Promise.resolve(
            db.organizations.find((o) => o.code === where.code) ?? null,
          ),
      },
      user: {
        /**
         * The reset path reads the account to obtain the identifiers the
         * password may not contain, so the fake must return the organization
         * relation the real query selects.
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
        findUniqueOrThrow: ({
          where,
        }: {
          where: { orgId_userId: { orgId: string; userId: string } };
        }) => {
          const { orgId, userId } = where.orgId_userId;
          const row = db.users.find(
            (u) => u.orgId === orgId && u.userId === userId,
          );
          if (!row) throw new Error('User not found');
          return Promise.resolve(row);
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
      passwordRecoveryRequest: {
        findFirst: ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            [...db.recoveries].reverse().find((r) => matches(r, where)) ?? null,
          ),
        findUnique: ({ where }: { where: { resetTokenHash?: string } }) =>
          Promise.resolve(
            db.recoveries.find(
              (r) =>
                where.resetTokenHash != null &&
                r.resetTokenHash === where.resetTokenHash,
            ) ?? null,
          ),
        create: ({ data }: { data: Partial<RecoveryRow> }) => {
          const row: RecoveryRow = {
            requestId: db.nextId(),
            resetTokenHash: null,
            status: 'REQUESTED',
            attemptCount: 0,
            resendCount: 0,
            tokenExpiresAt: null,
            consumedAt: null,
            createdAt: new Date(),
            ...data,
          } as RecoveryRow;
          db.recoveries.push(row);
          return Promise.resolve(row);
        },
        update: ({
          where,
          data,
        }: {
          where: { orgId_requestId: { orgId: string; requestId: string } };
          data: Partial<RecoveryRow>;
        }) => {
          const { orgId, requestId } = where.orgId_requestId;
          const row = db.recoveries.find(
            (r) => r.orgId === orgId && r.requestId === requestId,
          );
          if (!row) throw new Error('Recovery request not found');
          Object.assign(row, data);
          return Promise.resolve(row);
        },
        updateMany: ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<RecoveryRow>;
        }) => {
          const hits = db.recoveries.filter((r) => matches(r, where));
          hits.forEach((r) => Object.assign(r, data));
          return Promise.resolve({ count: hits.length });
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
      $queryRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
        const [orgId, mobile] = values as [string, string];
        return Promise.resolve(
          db.users
            .filter((u) => u.orgId === orgId && u.mobile === mobile)
            .map((u) => ({ user_id: u.userId })),
        );
      },
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(api),
    };
    return api as unknown as PrismaService;
  }
}

describe('RecoveryService', () => {
  const db = new FakeDb();
  let service: RecoveryService;
  let passwords: PasswordService;
  let sentMessages: Array<{ to: string; body: string }>;
  let revokeAllForUser: jest.Mock;

  beforeAll(async () => {
    passwords = new PasswordService(config);
    await passwords.onModuleInit();
  });

  beforeEach(() => {
    db.reset();
    sentMessages = [];
    revokeAllForUser = jest.fn().mockResolvedValue(1);

    // Stands in for the SmsService facade; per-org provider resolution is
    // covered by sms.service.spec.ts, so orgId is accepted and ignored here.
    const sms = {
      send: (_orgId: string, to: string, body: string) => {
        sentMessages.push({ to, body });
        return Promise.resolve();
      },
    } as unknown as SmsService;

    const audit = {
      record: (input: {
        action: string;
        metadata?: Record<string, unknown>;
      }) => {
        db.audits.push({ action: input.action, metadata: input.metadata });
        return Promise.resolve();
      },
      recordUnresolvableTenant: () => {
        db.audits.push({ action: 'AUTH_LOGIN_UNKNOWN_ORG' });
      },
    } as unknown as AuditService;

    const sessions = { revokeAllForUser } as unknown as SessionService;

    service = new RecoveryService(
      db.client(),
      passwords,
      new PasswordPolicyService(db.client(), passwords, config),
      sessions,
      audit,
      sms,
      config,
    );
  });

  /** Pulls the OTP out of the message the fake gateway "delivered". */
  function deliveredOtp(): string {
    const match = /(\d{6})/.exec(sentMessages.at(-1)?.body ?? '');
    if (!match) throw new Error('No OTP was delivered');
    return match[1];
  }

  const request = () =>
    service.requestRecovery({ orgCode: ORG_CODE, mobile: MOBILE }, {});

  const actions = () => db.audits.map((a) => a.action);

  // ---------------------------------------------------------------------------
  describe('requestRecovery', () => {
    it('creates a request and delivers an OTP for an eligible account', async () => {
      await request();

      expect(db.recoveries).toHaveLength(1);
      expect(db.recoveries[0].status).toBe('REQUESTED');
      expect(sentMessages).toHaveLength(1);
      expect(actions()).toContain('AUTH_RECOVERY_REQUESTED');
    });

    // Scenario 15: the request alone never changes the password.
    it('leaves the existing password untouched', async () => {
      await request();
      expect(db.users[0].passwordHash).toBe('existing-hash');
      expect(db.users[0].passwordChangedAt).toBeNull();
    });

    // Scenario 25: the OTP is stored only as a hash.
    it('never persists the OTP in plaintext', async () => {
      await request();
      const stored = db.recoveries[0].otpHash;
      expect(stored).not.toBe(deliveredOtp());
      expect(stored.startsWith('$argon2id$')).toBe(true);
    });

    // Scenario 8 / rule 25: an unknown mobile creates nothing.
    it('creates no account and no request for an unknown mobile number', async () => {
      await service.requestRecovery(
        { orgCode: ORG_CODE, mobile: '9111111111' },
        {},
      );

      expect(db.users).toHaveLength(1);
      expect(db.recoveries).toHaveLength(0);
      expect(sentMessages).toHaveLength(0);
      expect(actions()).toContain('AUTH_RECOVERY_REQUEST_IGNORED');
    });

    // Scenario 22: unknown and known accounts are indistinguishable.
    it('resolves identically for known and unknown mobile numbers', async () => {
      await expect(request()).resolves.toBeUndefined();
      db.reset();
      await expect(
        service.requestRecovery(
          { orgCode: ORG_CODE, mobile: '9111111111' },
          {},
        ),
      ).resolves.toBeUndefined();
    });

    // Scenarios 11 and 14: INACTIVE is a silent no-op.
    it.each(['INACTIVE', 'SUSPENDED'])(
      'sends no code and changes nothing for a %s account',
      async (status) => {
        db.reset({ status });
        await request();

        expect(sentMessages).toHaveLength(0);
        expect(db.recoveries).toHaveLength(0);
        expect(db.users[0].status).toBe(status);
      },
    );

    // Scenario 12: a LOCKED account may recover, but stays locked.
    it('accepts a request from a LOCKED account without unlocking it', async () => {
      const lockedUntil = new Date(Date.now() + 900_000);
      db.reset({ status: 'LOCKED', lockedUntil, failedLoginAttempts: 5 });

      await request();

      expect(sentMessages).toHaveLength(1);
      expect(db.users[0].status).toBe('LOCKED');
      expect(db.users[0].lockedUntil).toBe(lockedUntil);
      expect(db.users[0].failedLoginAttempts).toBe(5);
    });

    // Scenario 21 / Q-REC-17: a resend inside the cooldown is refused.
    it('rate limits a second request inside the cooldown window', async () => {
      await request();
      await request();

      expect(sentMessages).toHaveLength(1);
      expect(db.recoveries).toHaveLength(1);
      expect(actions()).toContain('AUTH_RECOVERY_RATE_LIMITED');
    });

    // Q-REC-8: only one authorization may be live at a time.
    it('cancels the previous request when a new one is issued', async () => {
      await request();
      db.recoveries[0].lastSentAt = new Date(Date.now() - 120_000);

      await request();

      expect(db.recoveries).toHaveLength(2);
      expect(db.recoveries[0].status).toBe('CANCELLED');
      expect(db.recoveries[1].status).toBe('REQUESTED');
    });

    it('stops resending once the resend cap is reached', async () => {
      await request();
      for (let i = 0; i < 5; i += 1) {
        db.recoveries.at(-1)!.lastSentAt = new Date(Date.now() - 120_000);
        await request();
      }
      // 1 initial + 3 resends allowed by AUTH_RECOVERY_MAX_RESENDS.
      expect(sentMessages).toHaveLength(4);
    });

    // Scenario 33: delivery failure must not look like success, nor throw.
    it('audits an SMS failure without changing the password', async () => {
      const failing = {
        send: () => Promise.reject(new Error('gateway down')),
      } as unknown as SmsService;
      service = new RecoveryService(
        db.client(),
        passwords,
        new PasswordPolicyService(db.client(), passwords, config),
        { revokeAllForUser } as unknown as SessionService,
        {
          record: (input: { action: string }) => {
            db.audits.push({ action: input.action });
            return Promise.resolve();
          },
          recordUnresolvableTenant: () => {},
        } as unknown as AuditService,
        failing,
        config,
      );

      await expect(request()).resolves.toBeUndefined();
      expect(actions()).toContain('AUTH_RECOVERY_SMS_FAILED');
      expect(db.recoveries[0].status).toBe('REQUESTED');
      expect(db.users[0].passwordHash).toBe('existing-hash');
    });

    it('does not create a request for an unknown organization', async () => {
      await service.requestRecovery({ orgCode: 'NOPE', mobile: MOBILE }, {});
      expect(db.recoveries).toHaveLength(0);
      expect(sentMessages).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('verifyOtp', () => {
    const verify = (otp: string) =>
      service.verifyOtp({ orgCode: ORG_CODE, mobile: MOBILE, otp }, {});

    it('mints a reset token for a correct code', async () => {
      await request();
      const { resetToken } = await verify(deliveredOtp());

      expect(resetToken).toBeTruthy();
      expect(db.recoveries[0].status).toBe('VERIFIED');
      expect(actions()).toContain('AUTH_RECOVERY_OTP_VERIFIED');
    });

    // Scenario 25: the reset token is stored only as a hash.
    it('never persists the reset token in plaintext', async () => {
      await request();
      const { resetToken } = await verify(deliveredOtp());
      expect(db.recoveries[0].resetTokenHash).not.toBe(resetToken);
    });

    it('rejects an incorrect code and counts the attempt', async () => {
      await request();
      await expect(verify('000000')).rejects.toThrow(UnauthorizedException);
      expect(db.recoveries[0].attemptCount).toBe(1);
      expect(actions()).toContain('AUTH_RECOVERY_OTP_FAILED');
    });

    // Scenario 41: attempts are capped, then the request is burned.
    it('retires the request once the attempt cap is reached', async () => {
      await request();
      for (let i = 0; i < 5; i += 1) {
        await expect(verify('000000')).rejects.toThrow(UnauthorizedException);
      }

      expect(db.recoveries[0].status).toBe('FAILED');
      // Even the correct code no longer works.
      await expect(verify(deliveredOtp())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    // Scenario 17
    it('rejects an expired code', async () => {
      await request();
      const otp = deliveredOtp();
      db.recoveries[0].expiresAt = new Date(Date.now() - 1000);

      await expect(verify(otp)).rejects.toThrow(UnauthorizedException);
      expect(db.recoveries[0].status).toBe('EXPIRED');
      expect(actions()).toContain('AUTH_RECOVERY_EXPIRED');
    });

    // Scenario 16: verification never itself changes the password.
    it('leaves the password unchanged on success', async () => {
      await request();
      await verify(deliveredOtp());
      expect(db.users[0].passwordHash).toBe('existing-hash');
    });

    // Scenarios 9, 10, 26: the failure is generic and reveals nothing.
    it('reports the same error for an unknown account as for a wrong code', async () => {
      await request();

      await expect(verify('000000')).rejects.toThrow(
        'Invalid or expired verification code',
      );
      await expect(
        service.verifyOtp(
          { orgCode: ORG_CODE, mobile: '9111111111', otp: '000000' },
          {},
        ),
      ).rejects.toThrow('Invalid or expired verification code');
    });
  });

  // ---------------------------------------------------------------------------
  describe('resetPassword', () => {
    async function verifiedToken(): Promise<string> {
      await request();
      const { resetToken } = await service.verifyOtp(
        { orgCode: ORG_CODE, mobile: MOBILE, otp: deliveredOtp() },
        {},
      );
      return resetToken;
    }

    const reset = (resetToken: string, password = COMPLIANT_PASSWORD) =>
      service.resetPassword({ resetToken, password }, {});

    it('sets the new password and consumes the authorization', async () => {
      const token = await verifiedToken();
      await reset(token);

      expect(db.users[0].passwordHash).not.toBe('existing-hash');
      expect(db.users[0].passwordChangedAt).toBeInstanceOf(Date);
      expect(db.recoveries[0].status).toBe('COMPLETED');
      expect(db.recoveries[0].consumedAt).toBeInstanceOf(Date);
      expect(actions()).toContain('AUTH_PASSWORD_RESET_COMPLETED');
    });

    // Rule 20: the new password is stored hashed, never in plaintext.
    it('stores the new password as an argon2 hash', async () => {
      await reset(await verifiedToken());
      const stored = db.users[0].passwordHash!;

      expect(stored).not.toBe(COMPLIANT_PASSWORD);
      expect(stored.startsWith('$argon2id$')).toBe(true);
      await expect(passwords.verify(stored, COMPLIANT_PASSWORD)).resolves.toBe(
        true,
      );
    });

    // Scenarios 18, 34, 42: a consumed authorization cannot be replayed.
    it('rejects a reused reset token', async () => {
      const token = await verifiedToken();
      await reset(token);

      await expect(reset(token)).rejects.toThrow(UnauthorizedException);
      expect(actions()).toContain('AUTH_RECOVERY_REPLAY_DENIED');
    });

    // Scenario 16: an unverified request cannot reach Reset Password.
    it('rejects a token belonging to an unverified request', async () => {
      await request();
      // A token that was never minted cannot resolve at all.
      await expect(reset('never-issued-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(db.users[0].passwordHash).toBe('existing-hash');
    });

    // Scenario 17
    it('rejects an expired reset token', async () => {
      const token = await verifiedToken();
      db.recoveries[0].tokenExpiresAt = new Date(Date.now() - 1000);

      await expect(reset(token)).rejects.toThrow(UnauthorizedException);
      expect(db.users[0].passwordHash).toBe('existing-hash');
      expect(db.recoveries[0].status).toBe('EXPIRED');
      expect(actions()).toContain('AUTH_RECOVERY_EXPIRED');
    });

    /**
     * Scenario 34: a replay must be attributable. A consumed token therefore
     * still resolves to its row — if it were unfindable the rejection would be
     * correct but anonymous, and the audit trail would lose the account it was
     * aimed at.
     */
    it('attributes a replayed token to the account it targeted', async () => {
      const token = await verifiedToken();
      await reset(token);
      db.audits.length = 0;

      await expect(reset(token)).rejects.toThrow(UnauthorizedException);

      const replay = db.audits.find(
        (a) => a.action === 'AUTH_RECOVERY_REPLAY_DENIED',
      );
      expect(replay?.metadata).toMatchObject({
        recoveryRef: db.recoveries[0].requestId,
      });
    });

    // Scenario 19
    it('rejects an authorization that matches no request', async () => {
      await expect(reset('bogus')).rejects.toThrow(UnauthorizedException);
      expect(db.users[0].passwordHash).toBe('existing-hash');
    });

    // Q-REC-18 / Scenario 28: a credential change invalidates every session.
    it('revokes all sessions for the user', async () => {
      await reset(await verifiedToken());
      expect(revokeAllForUser).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        'PASSWORD_RESET',
      );
    });

    /**
     * Scenarios 12 and 13: recovery restores access to an account, it never
     * upgrades one. Status, lock state, attempt counter and branch scope must
     * all survive the reset untouched.
     */
    it('does not unlock a LOCKED account or alter its scope', async () => {
      const lockedUntil = new Date(Date.now() + 900_000);
      db.reset({
        status: 'LOCKED',
        lockedUntil,
        failedLoginAttempts: 5,
        branchId: 'branch-1',
      });

      await reset(await verifiedToken());

      expect(db.users[0].passwordHash).not.toBe('existing-hash');
      expect(db.users[0].status).toBe('LOCKED');
      expect(db.users[0].lockedUntil).toBe(lockedUntil);
      expect(db.users[0].failedLoginAttempts).toBe(5);
      expect(db.users[0].branchId).toBe('branch-1');
    });

    // Scenario 24: no audit record may carry the password or a usable secret.
    it('records no password or recovery secret in audit metadata', async () => {
      await reset(await verifiedToken());
      const serialized = JSON.stringify(db.audits);

      expect(serialized).not.toContain(COMPLIANT_PASSWORD);
      expect(serialized).not.toContain('$argon2id$');
    });

    // -------------------------------------------------------------------------
    // Password policy (Reset Password Scenarios 10-13)
    // -------------------------------------------------------------------------

    describe('password policy', () => {
      /**
       * The rule that ties Scenarios 10-13 together: a rejected password is a
       * correctable mistake, not a failed authorization. The reset token must
       * survive so the user can simply try again.
       */
      async function expectRejectedButRetryable(password: string) {
        const token = await verifiedToken();

        await expect(reset(token, password)).rejects.toThrow(
          BadRequestException,
        );

        expect(db.users[0].passwordHash).toBe('existing-hash');
        expect(db.recoveries[0].status).toBe('VERIFIED');
        expect(db.recoveries[0].consumedAt).toBeNull();
        expect(actions()).toContain('AUTH_PASSWORD_RESET_FAILED');

        // And the very same token still works for a compliant password.
        await reset(token);
        expect(db.users[0].passwordHash).not.toBe('existing-hash');
        expect(db.recoveries[0].status).toBe('COMPLETED');
      }

      // Scenario 10
      it('rejects a password below the minimum length', async () => {
        await expectRejectedButRetryable('Ab1!efg');
      });

      // Scenario 11
      it('rejects a password with too few character classes', async () => {
        await expectRejectedButRetryable('abcdefghijklmnop');
      });

      // Scenario 13
      it("rejects a password containing the user's mobile number", async () => {
        await expectRejectedButRetryable(`Vault${MOBILE}x`);
      });

      it("rejects a password containing the user's name", async () => {
        await expectRejectedButRetryable('Sharma7Vaulted');
      });

      // Scenario 12
      it('rejects the password the account already uses', async () => {
        await reset(await verifiedToken());
        await expectPreviousPasswordRejected(COMPLIANT_PASSWORD);
      });

      // Scenario 12, across the retained history rather than just the current one.
      it('rejects a password used earlier in the history window', async () => {
        const earlier = 'Marigold4Ledger';
        await reset(await verifiedToken(), earlier);
        await reset(await verifiedToken(), COMPLIANT_PASSWORD);

        await expectPreviousPasswordRejected(earlier);
      });

      /**
       * The history window is finite: once a password has aged past the
       * configured depth it becomes usable again, which is what makes the
       * table bounded rather than growing forever.
       */
      it('allows a password that has aged out of the history window', async () => {
        const oldest = 'Marigold4Ledger';
        await reset(await verifiedToken(), oldest);

        // Depth is 5, so five later passwords push `oldest` out of the window.
        for (const password of [
          'Juniper8Harbor',
          'Cobalt3Meadow',
          'Lantern6Prairie',
          'Quarry9Thicket',
          'Beacon2Willow',
        ]) {
          await reset(await verifiedToken(), password);
        }

        await reset(await verifiedToken(), oldest);
        await expect(
          passwords.verify(db.users[0].passwordHash, oldest),
        ).resolves.toBe(true);
      });

      it('trims history to the configured depth', async () => {
        for (const password of [
          'Juniper8Harbor',
          'Cobalt3Meadow',
          'Lantern6Prairie',
          'Quarry9Thicket',
          'Beacon2Willow',
          'Kestrel7Vault',
          'Marigold4Ledger',
        ]) {
          await reset(await verifiedToken(), password);
        }

        expect(db.passwordHistory).toHaveLength(5);
      });

      it('stores history as hashes, never as plaintext', async () => {
        await reset(await verifiedToken());

        expect(db.passwordHistory).toHaveLength(1);
        expect(db.passwordHistory[0].passwordHash).not.toBe(COMPLIANT_PASSWORD);
        expect(
          db.passwordHistory[0].passwordHash.startsWith('$argon2id$'),
        ).toBe(true);
      });

      // Scenario 33: the failure is audited, the password is not.
      it('records no password in the failure audit metadata', async () => {
        const weak = 'abcdefghijklmnop';
        await expect(reset(await verifiedToken(), weak)).rejects.toThrow();

        const serialized = JSON.stringify(db.audits);
        expect(serialized).toContain('AUTH_PASSWORD_RESET_FAILED');
        expect(serialized).not.toContain(weak);
      });

      /**
       * A policy rejection is a 400, not a 401. The distinction is what tells
       * the client to keep the reset token and let the user correct the
       * password, rather than sending them back to the start of recovery.
       */
      it('reports a policy failure distinctly from an invalid authorization', async () => {
        await expect(
          reset(await verifiedToken(), 'abcdefghijklmnop'),
        ).rejects.not.toThrow(UnauthorizedException);
      });

      /** Shared by the two reuse tests: rejected, and the token survives. */
      async function expectPreviousPasswordRejected(password: string) {
        const token = await verifiedToken();
        const currentHash = db.users[0].passwordHash;

        await expect(reset(token, password)).rejects.toThrow(
          BadRequestException,
        );

        expect(db.users[0].passwordHash).toBe(currentHash);
        expect(db.recoveries.at(-1)?.consumedAt).toBeNull();

        const failure = db.audits.find(
          (a) => a.action === 'AUTH_PASSWORD_RESET_FAILED',
        );
        expect(failure?.metadata).toMatchObject({ reason: 'HISTORY' });
      }
    });
  });
});
