import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import type { RequestMeta } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { GpsCheckInService } from './gps-check-in.service';
import type { ReportFailureDto } from './dto/report-failure.dto';
import type { SubmitCheckInDto } from './dto/submit-check-in.dto';

/**
 * GPS check-in — persistence, scoping and audit.
 *
 * The verification rules themselves are covered by `gps-verification.spec.ts`;
 * what matters here is everything around them. The scope tests carry the most
 * weight: they are the ones that fail loudly if a `where` clause is ever
 * relaxed, or if `branchId` is ever read from the request instead of the
 * session.
 *
 * The Prisma stand-in implements only the query shapes this service actually
 * issues, and treats an unrecognized `where` key as NON-matching, so a widened
 * query cannot silently keep passing. Real transactions, constraints and
 * concurrent writes are deferred to the e2e suite.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '77777777-7777-7777-7777-777777777777';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_SESSION_ID = '44444444-4444-4444-4444-444444444444';
const BRANCH_A = '55555555-5555-5555-5555-555555555555';
const BRANCH_B = '66666666-6666-6666-6666-666666666666';
const ATTEMPT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_ATTEMPT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

const CONFIG_VALUES: Record<string, unknown> = {
  'field.gpsMaxAccuracyMeters': 100,
  'field.gpsMaxLocationAgeSeconds': 120,
  'field.gpsMaxClockSkewSeconds': 60,
  'field.checkInValidityHours': 12,
};

function fieldEmployeeContext(
  overrides: Partial<AuthContext> = {},
): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: SESSION_ID,
    branchId: BRANCH_A,
    roles: ['FIELD_EMPLOYEE'],
    permissions: ['field.checkin'],
    ...overrides,
  };
}

/** A Branch Admin may review history, but is confined to their own branch. */
function branchAdminContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return fieldEmployeeContext({
    roles: ['BRANCH_ADMIN'],
    permissions: ['field.checkin.view'],
    ...overrides,
  });
}

/** A Super Admin is organization-wide: no branch, so no branch confinement. */
function superAdminContext(): AuthContext {
  return branchAdminContext({ branchId: null, roles: ['SUPER_ADMIN'] });
}

/** A position that verifies cleanly; each test spoils exactly one thing. */
function validDto(overrides: Partial<SubmitCheckInDto> = {}): SubmitCheckInDto {
  return {
    clientAttemptId: ATTEMPT_ID,
    latitude: 13.0827,
    longitude: 80.2707,
    accuracyMeters: 12.5,
    locationTimestamp: new Date().toISOString(),
    permissionStatus: 'GRANTED',
    networkStatus: 'ONLINE',
    ...overrides,
  };
}

interface CheckInRecord {
  orgId: string;
  checkInId: string;
  userId: string;
  branchId: string;
  sessionId: string;
  clientAttemptId: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  locationTimestamp: Date | null;
  verificationStatus: string;
  permissionStatus: string;
  networkStatus: string;
  failureReason: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

interface UserRecord {
  orgId: string;
  userId: string;
  branchId: string | null;
}

describe('GpsCheckInService', () => {
  let checkIns: CheckInRecord[];
  let users: UserRecord[];
  let record: jest.Mock;
  let service: GpsCheckInService;
  let nextId: number;
  /** Set to make the next create() throw, for the persistence-failure path. */
  let createFails: boolean;

  /**
   * Matches a row against a `where` clause.
   *
   * Unknown keys throw rather than being ignored: a query this stand-in does
   * not model must fail the test, not quietly match everything.
   */
  function matches(
    row: CheckInRecord,
    where: Record<string, unknown>,
  ): boolean {
    return Object.entries(where).every(([key, expected]) => {
      switch (key) {
        case 'orgId':
          return row.orgId === expected;
        case 'userId':
          return row.userId === expected;
        case 'sessionId':
          return row.sessionId === expected;
        case 'verificationStatus':
          return row.verificationStatus === expected;
        case 'verifiedAt': {
          const bound = (expected as { gte?: Date }).gte;
          if (!bound) throw new Error('unsupported verifiedAt filter');
          return (
            row.verifiedAt !== null &&
            row.verifiedAt.getTime() >= bound.getTime()
          );
        }
        default:
          throw new Error(`unmodelled where key: ${key}`);
      }
    });
  }

  beforeEach(() => {
    checkIns = [];
    users = [
      { orgId: ORG_ID, userId: USER_ID, branchId: BRANCH_A },
      { orgId: ORG_ID, userId: OTHER_USER_ID, branchId: BRANCH_A },
    ];
    record = jest.fn().mockResolvedValue(undefined);
    nextId = 0;
    createFails = false;

    const gpsCheckIn = {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: {
            orgId_clientAttemptId: { orgId: string; clientAttemptId: string };
          };
        }) => {
          const key = where.orgId_clientAttemptId;
          return Promise.resolve(
            checkIns.find(
              (row) =>
                row.orgId === key.orgId &&
                row.clientAttemptId === key.clientAttemptId,
            ) ?? null,
          );
        },
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = checkIns
          .filter((row) => matches(row, where))
          .sort(
            (a, b) =>
              (b.verifiedAt?.getTime() ?? 0) - (a.verifiedAt?.getTime() ?? 0),
          );
        return Promise.resolve(found[0] ?? null);
      }),
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          checkIns
            .filter((row) => matches(row, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (createFails) return Promise.reject(new Error('db unavailable'));

        nextId += 1;
        const row: CheckInRecord = {
          checkInId: `checkin-${nextId}`,
          createdAt: new Date(),
          ...(data as unknown as Omit<
            CheckInRecord,
            'checkInId' | 'createdAt'
          >),
        };
        checkIns.push(row);
        return Promise.resolve(row);
      }),
    };

    const user = {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { orgId_userId: { orgId: string; userId: string } };
        }) => {
          const key = where.orgId_userId;
          return Promise.resolve(
            users.find(
              (row) => row.orgId === key.orgId && row.userId === key.userId,
            ) ?? null,
          );
        },
      ),
    };

    const prisma = {
      gpsCheckIn,
      user,
      // No rollback semantics: the callback runs against the same stand-in, so
      // a thrown error propagates but written rows are not undone. Real
      // transactional behaviour belongs to the e2e suite.
      $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ gpsCheckIn, user }),
    } as unknown as PrismaService;

    const audit = { record } as unknown as AuditService;
    const config = {
      get: (key: string, fallback?: unknown) => CONFIG_VALUES[key] ?? fallback,
    } as unknown as ConfigService;

    service = new GpsCheckInService(prisma, audit, config);
  });

  function auditedActions(): string[] {
    const calls = record.mock.calls as Array<[{ action: string }]>;
    return calls.map(([input]) => input.action);
  }

  function auditMetadata(action: string): Record<string, unknown> | undefined {
    const calls = record.mock.calls as Array<
      [{ action: string; metadata?: Record<string, unknown> }]
    >;
    return calls.find(([input]) => input.action === action)?.[0].metadata;
  }

  describe('Scenario 4: GPS location is successfully acquired and verified', () => {
    it('records a VERIFIED check-in with a server-set verification time', async () => {
      const before = Date.now();
      const result = await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto(),
        META,
      );
      const after = Date.now();

      expect(result.verified).toBe(true);
      expect(result.duplicate).toBe(false);
      expect(result.checkIn.verificationStatus).toBe('VERIFIED');
      expect(result.checkIn.failureReason).toBeNull();

      // The server clock, not the device's — a device timestamp is evidence,
      // never the authority.
      const verifiedAt = Date.parse(result.checkIn.verifiedAt as string);
      expect(verifiedAt).toBeGreaterThanOrEqual(before);
      expect(verifiedAt).toBeLessThanOrEqual(after);
    });

    it('associates the check-in with the authenticated user and session', async () => {
      await service.submitCheckIn(fieldEmployeeContext(), validDto(), META);

      expect(checkIns[0].userId).toBe(USER_ID);
      expect(checkIns[0].sessionId).toBe(SESSION_ID);
      expect(checkIns[0].orgId).toBe(ORG_ID);
    });

    it('returns coordinates as plain numbers', async () => {
      const result = await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto(),
        META,
      );

      expect(typeof result.checkIn.latitude).toBe('number');
      expect(result.checkIn.latitude).toBeCloseTo(13.0827);
    });
  });

  describe('Scenarios 23, 24, 26: GPS cannot change role, branch or organization', () => {
    it('takes branchId from the session, ignoring any value in the request', async () => {
      // The DTO has no branchId field, but a caller could still send one; this
      // proves the written scope comes from the AuthContext regardless.
      const hostileDto = {
        ...validDto(),
        branchId: BRANCH_B,
        orgId: OTHER_ORG_ID,
        userId: OTHER_USER_ID,
      } as SubmitCheckInDto;

      await service.submitCheckIn(fieldEmployeeContext(), hostileDto, META);

      expect(checkIns[0].branchId).toBe(BRANCH_A);
      expect(checkIns[0].orgId).toBe(ORG_ID);
      expect(checkIns[0].userId).toBe(USER_ID);
    });

    it('records the branch from a caller assigned to Branch B under Branch B', async () => {
      await service.submitCheckIn(
        fieldEmployeeContext({ branchId: BRANCH_B }),
        validDto(),
        META,
      );

      expect(checkIns[0].branchId).toBe(BRANCH_B);
    });

    it('refuses a caller with no branch scope and audits the denial', async () => {
      await expect(
        service.submitCheckIn(
          fieldEmployeeContext({ branchId: null }),
          validDto(),
          META,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(checkIns).toHaveLength(0);
      expect(auditedActions()).toContain(AuditAction.CHECKIN_DENIED_NO_BRANCH);
    });
  });

  describe('Scenarios 6-12: failed attempts are recorded, never verified', () => {
    it.each([
      [
        'permission denied',
        { permissionStatus: 'DENIED' as const },
        'PERMISSION_DENIED',
      ],
      ['offline', { networkStatus: 'OFFLINE' as const }, 'NETWORK_LOST'],
      [
        'no coordinates',
        { latitude: undefined, longitude: undefined },
        'INVALID_COORDINATES',
      ],
      ['poor accuracy', { accuracyMeters: 5000 }, 'ACCURACY_REJECTED'],
    ])(
      'records %s as FAILED with reason %s',
      async (_label, overrides, reason) => {
        const result = await service.submitCheckIn(
          fieldEmployeeContext(),
          validDto(overrides),
          META,
        );

        expect(result.verified).toBe(false);
        expect(result.checkIn.verificationStatus).toBe('FAILED');
        expect(result.checkIn.failureReason).toBe(reason);
        expect(result.checkIn.verifiedAt).toBeNull();
        expect(auditedActions()).toContain(AuditAction.CHECKIN_FAILED);
      },
    );

    it('rejects a stale device timestamp', async () => {
      const result = await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto({
          locationTimestamp: new Date(
            Date.now() - 10 * 60 * 1000,
          ).toISOString(),
        }),
        META,
      );

      expect(result.checkIn.failureReason).toBe('STALE_LOCATION');
    });

    it('still persists a failed attempt, so the failure is not lost', async () => {
      await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto({ permissionStatus: 'DENIED' }),
        META,
      );

      expect(checkIns).toHaveLength(1);
      expect(checkIns[0].verificationStatus).toBe('FAILED');
    });
  });

  describe('Scenarios 13, 15: retry does not rewrite an earlier failure', () => {
    it('keeps the failed attempt intact when a later attempt succeeds', async () => {
      await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto({ clientAttemptId: ATTEMPT_ID, permissionStatus: 'DENIED' }),
        META,
      );

      const retry = await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto({ clientAttemptId: OTHER_ATTEMPT_ID }),
        META,
      );

      expect(retry.verified).toBe(true);
      expect(checkIns).toHaveLength(2);
      // The first row is untouched — a failure stays a failure.
      expect(checkIns[0].verificationStatus).toBe('FAILED');
      expect(checkIns[0].verifiedAt).toBeNull();
      expect(checkIns[1].verificationStatus).toBe('VERIFIED');
    });

    it('records each repeated failure separately', async () => {
      for (const id of [ATTEMPT_ID, OTHER_ATTEMPT_ID]) {
        await service.submitCheckIn(
          fieldEmployeeContext(),
          validDto({ clientAttemptId: id, permissionStatus: 'DENIED' }),
          META,
        );
      }

      expect(checkIns).toHaveLength(2);
      expect(checkIns.every((row) => row.verificationStatus === 'FAILED')).toBe(
        true,
      );
    });
  });

  describe('Scenario 37: duplicate submissions are idempotent', () => {
    it('returns the original outcome without writing a second row', async () => {
      const first = await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto(),
        META,
      );
      const second = await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto(),
        META,
      );

      expect(checkIns).toHaveLength(1);
      expect(second.duplicate).toBe(true);
      expect(second.checkIn.checkInId).toBe(first.checkIn.checkInId);
      expect(auditedActions()).toContain(AuditAction.CHECKIN_DUPLICATE_IGNORED);
    });

    it('does not promote a failed attempt on replay', async () => {
      await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto({ permissionStatus: 'DENIED' }),
        META,
      );

      // A replay carrying a now-valid permission must not upgrade the recorded
      // outcome: the attempt already happened and its result is a fact.
      const replay = await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto({ permissionStatus: 'GRANTED' }),
        META,
      );

      expect(replay.verified).toBe(false);
      expect(replay.duplicate).toBe(true);
      expect(checkIns).toHaveLength(1);
    });
  });

  describe('Scenario 35: persistence failure is not reported as success', () => {
    it('propagates the error and audits the failure', async () => {
      createFails = true;

      await expect(
        service.submitCheckIn(fieldEmployeeContext(), validDto(), META),
      ).rejects.toThrow('db unavailable');

      expect(auditedActions()).toContain(
        AuditAction.CHECKIN_PERSISTENCE_FAILED,
      );
    });

    it('still throws when the audit write also fails', async () => {
      createFails = true;
      record.mockRejectedValue(new Error('audit store down'));

      // The caller must see the original database error, not a masking one.
      await expect(
        service.submitCheckIn(fieldEmployeeContext(), validDto(), META),
      ).rejects.toThrow('db unavailable');
    });
  });

  describe('reportFailure: device-reported failures', () => {
    const failureDto: ReportFailureDto = {
      clientAttemptId: ATTEMPT_ID,
      permissionStatus: 'DENIED',
      networkStatus: 'ONLINE',
      failureReason: 'PERMISSION_DENIED',
    };

    it('records a FAILED row with no coordinates', async () => {
      const result = await service.reportFailure(
        fieldEmployeeContext(),
        failureDto,
        META,
      );

      expect(result.verified).toBe(false);
      expect(result.checkIn.verificationStatus).toBe('FAILED');
      expect(result.checkIn.latitude).toBeNull();
      expect(result.checkIn.longitude).toBeNull();
      expect(auditedActions()).toContain(AuditAction.CHECKIN_FAILED);
    });

    it('is idempotent on the same attempt id', async () => {
      await service.reportFailure(fieldEmployeeContext(), failureDto, META);
      const second = await service.reportFailure(
        fieldEmployeeContext(),
        failureDto,
        META,
      );

      expect(checkIns).toHaveLength(1);
      expect(second.duplicate).toBe(true);
    });

    it('refuses a caller with no branch scope', async () => {
      await expect(
        service.reportFailure(
          fieldEmployeeContext({ branchId: null }),
          failureDto,
          META,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('Scenario 5: verified status gates the field flow', () => {
    it('reports verified after a successful check-in', async () => {
      await service.submitCheckIn(fieldEmployeeContext(), validDto(), META);

      const status = await service.getCurrentStatus(fieldEmployeeContext());

      expect(status.verified).toBe(true);
      expect(status.checkIn?.verificationStatus).toBe('VERIFIED');
      expect(status.validityHours).toBe(12);
    });

    it('reports unverified when nothing has been checked in', async () => {
      const status = await service.getCurrentStatus(fieldEmployeeContext());

      expect(status.verified).toBe(false);
      expect(status.checkIn).toBeNull();
    });

    it('does not treat a failed attempt as verification', async () => {
      await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto({ permissionStatus: 'DENIED' }),
        META,
      );

      const status = await service.getCurrentStatus(fieldEmployeeContext());

      expect(status.verified).toBe(false);
    });

    it('does not carry verification across sessions', async () => {
      // A verified location proves where someone was on a device; a different
      // device is a different claim and needs its own check-in.
      await service.submitCheckIn(fieldEmployeeContext(), validDto(), META);

      const status = await service.getCurrentStatus(
        fieldEmployeeContext({ sessionId: OTHER_SESSION_ID }),
      );

      expect(status.verified).toBe(false);
    });

    it('does not carry verification across users', async () => {
      await service.submitCheckIn(fieldEmployeeContext(), validDto(), META);

      const status = await service.getCurrentStatus(
        fieldEmployeeContext({ userId: OTHER_USER_ID }),
      );

      expect(status.verified).toBe(false);
    });

    it('ignores a check-in older than the validity window', async () => {
      await service.submitCheckIn(fieldEmployeeContext(), validDto(), META);
      // 13 hours ago, one hour past the 12-hour window.
      checkIns[0].verifiedAt = new Date(Date.now() - 13 * 60 * 60 * 1000);

      const status = await service.getCurrentStatus(fieldEmployeeContext());

      expect(status.verified).toBe(false);
    });
  });

  describe('Scenarios 25, 26: history is scoped by permission and branch', () => {
    beforeEach(async () => {
      await service.submitCheckIn(fieldEmployeeContext(), validDto(), META);
    });

    it('lets a caller read their own history without the view permission', async () => {
      const history = await service.listHistory(
        fieldEmployeeContext(),
        undefined,
        META,
      );

      expect(history).toHaveLength(1);
      expect(auditedActions()).toContain(AuditAction.CHECKIN_HISTORY_VIEWED);
    });

    it('treats an explicit self id as own history', async () => {
      const history = await service.listHistory(
        fieldEmployeeContext(),
        USER_ID,
        META,
      );

      expect(history).toHaveLength(1);
    });

    it('refuses another user’s history without the view permission', async () => {
      await expect(
        service.listHistory(fieldEmployeeContext(), OTHER_USER_ID, META),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(auditedActions()).toContain(AuditAction.CHECKIN_HISTORY_DENIED);
      expect(auditMetadata(AuditAction.CHECKIN_HISTORY_DENIED)).toMatchObject({
        reason: 'MISSING_PERMISSION',
      });
    });

    it('lets a Branch Admin read a colleague in their own branch', async () => {
      const history = await service.listHistory(
        branchAdminContext(),
        OTHER_USER_ID,
        META,
      );

      expect(history).toEqual([]);
      expect(auditedActions()).toContain(AuditAction.CHECKIN_HISTORY_VIEWED);
    });

    it('refuses a Branch Admin reading another branch', async () => {
      users = [{ orgId: ORG_ID, userId: OTHER_USER_ID, branchId: BRANCH_B }];

      await expect(
        service.listHistory(branchAdminContext(), OTHER_USER_ID, META),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(auditMetadata(AuditAction.CHECKIN_HISTORY_DENIED)).toMatchObject({
        reason: 'BRANCH_SCOPE',
      });
    });

    it('lets a Super Admin read across branches', async () => {
      users = [{ orgId: ORG_ID, userId: OTHER_USER_ID, branchId: BRANCH_B }];

      await expect(
        service.listHistory(superAdminContext(), OTHER_USER_ID, META),
      ).resolves.toEqual([]);
    });

    it('refuses an unknown user the same way as an out-of-branch one', async () => {
      // Identical response, so the endpoint cannot be used to discover which
      // user ids are real.
      users = [];

      await expect(
        service.listHistory(superAdminContext(), OTHER_USER_ID, META),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(auditMetadata(AuditAction.CHECKIN_HISTORY_DENIED)).toMatchObject({
        reason: 'NOT_FOUND_OR_OUT_OF_SCOPE',
      });
    });

    it('never returns another organization’s rows', async () => {
      checkIns.push({
        ...checkIns[0],
        checkInId: 'foreign',
        orgId: OTHER_ORG_ID,
      });

      const history = await service.listHistory(
        fieldEmployeeContext(),
        undefined,
        META,
      );

      expect(history).toHaveLength(1);
      expect(history[0].checkInId).not.toBe('foreign');
    });
  });

  describe('Scenarios 33, 34: audit content', () => {
    it('records the branch and outcome without coordinates', async () => {
      await service.submitCheckIn(fieldEmployeeContext(), validDto(), META);

      const metadata = auditMetadata(AuditAction.CHECKIN_VERIFIED);

      expect(metadata).toMatchObject({
        branchId: BRANCH_A,
        permissionStatus: 'GRANTED',
        networkStatus: 'ONLINE',
        failureReason: null,
      });
      // Location data lives on the row, not in a second store with a different
      // retention story.
      expect(metadata).not.toHaveProperty('latitude');
      expect(metadata).not.toHaveProperty('longitude');
    });

    it('records the failure reason on a failed attempt', async () => {
      await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto({ permissionStatus: 'DENIED' }),
        META,
      );

      expect(auditMetadata(AuditAction.CHECKIN_FAILED)).toMatchObject({
        failureReason: 'PERMISSION_DENIED',
      });
    });

    it('never records a success action for a failed attempt', async () => {
      await service.submitCheckIn(
        fieldEmployeeContext(),
        validDto({ permissionStatus: 'DENIED' }),
        META,
      );

      expect(auditedActions()).not.toContain(AuditAction.CHECKIN_VERIFIED);
    });

    it('attributes every audit entry to the acting user and request', async () => {
      await service.submitCheckIn(fieldEmployeeContext(), validDto(), META);

      const [input] = record.mock.calls[0] as [
        {
          actorUserId: string;
          orgId: string;
          requestId?: string;
          entityType: string;
        },
      ];

      expect(input).toMatchObject({
        actorUserId: USER_ID,
        orgId: ORG_ID,
        requestId: META.requestId,
        entityType: 'GPS_CHECK_IN',
      });
    });
  });
});
