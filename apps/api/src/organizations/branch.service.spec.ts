import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { BRANCH_DEPENDENCIES } from './branch-dependencies';
import { BranchService } from './branch.service';
import type { CreateBranchDto } from './dto/create-branch.dto';
import type { UpdateBranchDto } from './dto/update-branch.dto';

/**
 * Branch Management — scoping, lifecycle and the delete guard.
 *
 * The scope tests carry the most weight. They are the ones that fail loudly if
 * a `where` clause is ever relaxed or if `orgId`/`branchId` is ever read from a
 * request instead of the session, which is the difference between branch scope
 * being an authorization boundary and being a UI filter (Rule 26).
 *
 * The Prisma stand-in implements only the query shapes this service issues and
 * throws on an unmodelled `where` key, so a widened query cannot silently keep
 * passing. Real constraints, transactions and concurrent writes are deferred to
 * the e2e suite.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const BRANCH_A = '55555555-5555-5555-5555-555555555555';
const BRANCH_B = '66666666-6666-6666-6666-666666666666';
const BRANCH_EMPTY = '77777777-7777-7777-7777-777777777777';
const UNKNOWN_BRANCH = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

/**
 * `expect.objectContaining` is typed `any`, which trips `no-unsafe-assignment`
 * as soon as it is nested inside an object literal. Narrowing it once here
 * keeps the assertions below both readable and type-safe.
 */
function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function superAdminContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: SESSION_ID,
    // Organization-wide: no branch, so no branch confinement.
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: [
      'branches.view',
      'branches.create',
      'branches.update',
      'branches.delete',
      'branches.activate',
    ],
    ...overrides,
  };
}

/** Confined to Branch A by their own branchId, not by their permissions. */
function branchAdminContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return superAdminContext({
    branchId: BRANCH_A,
    roles: ['BRANCH_ADMIN'],
    permissions: ['branches.view'],
    ...overrides,
  });
}

interface BranchRecord {
  orgId: string;
  branchId: string;
  code: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pincode: string;
  phone: string | null;
  contactEmail: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  deactivatedAt: Date | null;
  deactivationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface OrgRecord {
  orgId: string;
  status: 'ACTIVE' | 'INACTIVE';
}

function branchRecord(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    orgId: ORG_ID,
    branchId: BRANCH_A,
    code: 'BR001',
    name: 'Chennai Main Branch',
    addressLine1: '12 Anna Salai',
    addressLine2: null,
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600002',
    phone: null,
    contactEmail: null,
    status: 'ACTIVE',
    deactivatedAt: null,
    deactivationReason: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function validCreateDto(
  overrides: Partial<CreateBranchDto> = {},
): CreateBranchDto {
  return {
    code: 'BR009',
    name: 'Salem Branch',
    addressLine1: '4 Omalur Road',
    city: 'Salem',
    state: 'Tamil Nadu',
    pincode: '636001',
    status: 'ACTIVE',
    ...overrides,
  };
}

function validUpdateDto(
  overrides: Partial<UpdateBranchDto> = {},
): UpdateBranchDto {
  return {
    name: 'Chennai Central Branch',
    addressLine1: '99 Mount Road',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600002',
    ...overrides,
  };
}

describe('BranchService', () => {
  let service: BranchService;
  let audit: { record: jest.Mock };
  let branches: BranchRecord[];
  let organizations: OrgRecord[];
  /** Per-entity row counts the delete guard will read. */
  let dependencyCounts: Record<string, Record<string, number>>;
  /**
   * The mock client the service was handed, kept in scope so a test can ask
   * which delegates were actually consulted rather than inferring it from a
   * hardcoded list length.
   */
  let client: Record<string, unknown>;

  /**
   * Matches a row against a `where`, throwing on any key this stand-in does not
   * model. A silently-ignored key would let a test pass against a query that
   * fetches more than it should.
   */
  function branchMatches(
    row: BranchRecord,
    where: Record<string, unknown>,
  ): boolean {
    for (const [key, value] of Object.entries(where)) {
      switch (key) {
        case 'orgId':
          if (row.orgId !== value) return false;
          break;
        case 'branchId':
          if (row.branchId !== value) return false;
          break;
        case 'status':
          if (row.status !== value) return false;
          break;
        case 'code':
          if (row.code !== value) return false;
          break;
        case 'orgId_branchId': {
          const composite = value as { orgId: string; branchId: string };
          if (row.orgId !== composite.orgId) return false;
          if (row.branchId !== composite.branchId) return false;
          break;
        }
        case 'orgId_code': {
          const composite = value as { orgId: string; code: string };
          if (row.orgId !== composite.orgId) return false;
          if (row.code !== composite.code) return false;
          break;
        }
        default:
          throw new Error(`unmodelled where key: ${key}`);
      }
    }
    return true;
  }

  function makeClient(): Record<string, unknown> {
    const branchDelegate = {
      // Reads return copies, as a real client does. Handing back the live
      // object would let a later `update` retroactively change what an earlier
      // read saw — which would silently defeat the before/after audit tests.
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          branches
            .filter((row) => branchMatches(row, where))
            .map((row) => ({ ...row })),
        ),
      ),
      findUnique: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const row = branches.find((candidate) =>
          branchMatches(candidate, where),
        );
        return Promise.resolve(row ? { ...row } : null);
      }),
      create: jest.fn(({ data }: { data: Partial<BranchRecord> }) => {
        const row = branchRecord({
          ...data,
          branchId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        });
        branches.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<BranchRecord>;
        }) => {
          const row = branches.find((candidate) =>
            branchMatches(candidate, where),
          );
          if (!row) throw new Error('branch not found');
          Object.assign(row, data);
          return Promise.resolve({ ...row });
        },
      ),
      delete: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const index = branches.findIndex((row) => branchMatches(row, where));
        if (index === -1) throw new Error('branch not found');
        const [removed] = branches.splice(index, 1);
        return Promise.resolve(removed);
      }),
      count: jest.fn(() => Promise.resolve(0)),
    };

    const client: Record<string, unknown> = {
      branch: branchDelegate,
      organization: {
        findUnique: jest.fn(({ where }: { where: { orgId: string } }) =>
          Promise.resolve(
            organizations.find((row) => row.orgId === where.orgId) ?? null,
          ),
        ),
      },
    };

    // One count() per branch-scoped model, reading the fixture counts.
    for (const dependency of BRANCH_DEPENDENCIES) {
      client[dependency.entity] = {
        count: jest.fn(
          ({ where }: { where: { orgId: string; branchId: string } }) =>
            Promise.resolve(
              dependencyCounts[where.branchId]?.[dependency.entity] ?? 0,
            ),
        ),
      };
    }

    return client;
  }

  beforeEach(() => {
    organizations = [{ orgId: ORG_ID, status: 'ACTIVE' }];
    branches = [
      branchRecord(),
      branchRecord({
        branchId: BRANCH_B,
        code: 'BR002',
        name: 'Coimbatore Branch',
      }),
      branchRecord({
        branchId: BRANCH_EMPTY,
        code: 'BR003',
        name: 'Madurai Branch',
      }),
    ];
    dependencyCounts = {
      // Branch A has traded; Branch B has one user; BRANCH_EMPTY has nothing.
      [BRANCH_A]: { user: 2, loan: 5, collection: 11 },
      [BRANCH_B]: { user: 1 },
    };

    client = makeClient();
    const prisma = {
      ...client,
      $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback(client),
      ),
    } as unknown as PrismaService;

    audit = { record: jest.fn().mockResolvedValue(undefined) };

    service = new BranchService(prisma, audit as unknown as AuditService);
  });

  describe('list', () => {
    it('returns every branch in the organization for a Super Admin', async () => {
      const result = await service.list(superAdminContext(), {}, META);

      expect(result.map((b) => b.code).sort()).toEqual([
        'BR001',
        'BR002',
        'BR003',
      ]);
    });

    it('returns only the caller’s own branch for a Branch Admin', async () => {
      // Scenario 15: Branch B's records are not returned.
      const result = await service.list(branchAdminContext(), {}, META);

      expect(result).toHaveLength(1);
      expect(result[0].branchId).toBe(BRANCH_A);
    });

    it('excludes inactive branches when activeOnly is set', async () => {
      // Scenario 50: an inactive branch is not offered for new operational work.
      branches[1].status = 'INACTIVE';

      const result = await service.list(
        superAdminContext(),
        { activeOnly: true },
        META,
      );

      expect(result.map((b) => b.code)).not.toContain('BR002');
    });

    it('still confines a Branch Admin when activeOnly is set', async () => {
      const result = await service.list(
        branchAdminContext(),
        { activeOnly: true },
        META,
      );

      expect(result).toHaveLength(1);
      expect(result[0].branchId).toBe(BRANCH_A);
    });

    it('audits the access', async () => {
      // Scenario 13: the access is audit logged.
      await service.list(superAdminContext(), {}, META);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.BRANCH_LISTED }),
      );
    });
  });

  describe('getById', () => {
    it('returns the branch for a Super Admin', async () => {
      const result = await service.getById(superAdminContext(), BRANCH_B, META);

      expect(result.code).toBe('BR002');
    });

    it('refuses another branch to a Branch Admin', async () => {
      // Scenario 16/35: Branch B is not reachable from Branch A.
      await expect(
        service.getById(branchAdminContext(), BRANCH_B, META),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('gives an unknown branch and an out-of-scope branch the same message', async () => {
      // The endpoint must not become an enumeration oracle: a Branch Admin
      // must not be able to tell a real branch id from a fabricated one.
      const outOfScope = await service
        .getById(branchAdminContext(), BRANCH_B, META)
        .catch((error: Error) => error.message);
      const unknown = await service
        .getById(branchAdminContext(), UNKNOWN_BRANCH, META)
        .catch((error: Error) => error.message);

      expect(outOfScope).toBe(unknown);
    });

    it('records the real cause in the audit metadata even though the message is uniform', async () => {
      await service
        .getById(branchAdminContext(), BRANCH_B, META)
        .catch(() => undefined);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.BRANCH_SCOPE_DENIED,
          metadata: containing({ reason: 'BRANCH_SCOPE' }),
        }),
      );
    });

    it('refuses a branch belonging to another organization', async () => {
      // Scenario 37: the row exists, but not in this tenant.
      branches.push(
        branchRecord({
          orgId: '99999999-9999-9999-9999-999999999999',
          branchId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          code: 'OTHER',
        }),
      );

      await expect(
        service.getById(
          superAdminContext(),
          'cccccccc-cccc-cccc-cccc-cccccccccccc',
          META,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a branch under the caller’s organization', async () => {
      const result = await service.create(
        superAdminContext(),
        validCreateDto(),
        META,
      );

      expect(result.code).toBe('BR009');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.BRANCH_CREATED }),
        expect.anything(),
      );
    });

    it('rejects a duplicate branch code within the organization', async () => {
      // Scenario 19.
      await expect(
        service.create(
          superAdminContext(),
          validCreateDto({ code: 'BR001' }),
          META,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('leaves the existing branch unchanged on a duplicate', async () => {
      const before = structuredClone(branches[0]);

      await service
        .create(superAdminContext(), validCreateDto({ code: 'BR001' }), META)
        .catch(() => undefined);

      expect(branches[0]).toEqual(before);
    });

    it('audits a duplicate attempt', async () => {
      await service
        .create(superAdminContext(), validCreateDto({ code: 'BR001' }), META)
        .catch(() => undefined);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.BRANCH_CREATE_REJECTED,
          metadata: containing({ reason: 'DUPLICATE_CODE' }),
        }),
      );
    });

    it('refuses to create a branch under an inactive organization', async () => {
      // Scenario 18.
      organizations[0].status = 'INACTIVE';

      await expect(
        service.create(superAdminContext(), validCreateDto(), META),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates nothing when the organization is inactive', async () => {
      organizations[0].status = 'INACTIVE';
      const countBefore = branches.length;

      await service
        .create(superAdminContext(), validCreateDto(), META)
        .catch(() => undefined);

      expect(branches).toHaveLength(countBefore);
    });

    it('stamps deactivatedAt when created directly as INACTIVE', async () => {
      const result = await service.create(
        superAdminContext(),
        validCreateDto({ status: 'INACTIVE' }),
        META,
      );

      expect(result.status).toBe('INACTIVE');
      expect(result.deactivatedAt).toBeDefined();
    });
  });

  describe('update', () => {
    it('saves the change and audits before/after', async () => {
      // Scenarios 20, 52.
      const result = await service.update(
        superAdminContext(),
        BRANCH_A,
        validUpdateDto(),
        META,
      );

      expect(result.name).toBe('Chennai Central Branch');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.BRANCH_UPDATED,
          oldData: containing({ name: 'Chennai Main Branch' }),
          newData: containing({ name: 'Chennai Central Branch' }),
        }),
        expect.anything(),
      );
    });

    it('leaves the branch identifier and code stable', async () => {
      // Scenario 20: the identifier remains stable. Code is not in the DTO at
      // all, so it cannot drift even if a caller sends one.
      const result = await service.update(
        superAdminContext(),
        BRANCH_A,
        validUpdateDto(),
        META,
      );

      expect(result.branchId).toBe(BRANCH_A);
      expect(result.code).toBe('BR001');
    });

    it('refuses a Branch Admin editing another branch', async () => {
      // Scenario 35.
      await expect(
        service.update(branchAdminContext(), BRANCH_B, validUpdateDto(), META),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('leaves the target unchanged when the edit is refused', async () => {
      const before = structuredClone(branches[1]);

      await service
        .update(branchAdminContext(), BRANCH_B, validUpdateDto(), META)
        .catch(() => undefined);

      expect(branches[1]).toEqual(before);
    });
  });

  describe('setStatus', () => {
    it('deactivates an active branch and records the reason', async () => {
      // Scenarios 27, 53.
      const result = await service.setStatus(
        superAdminContext(),
        BRANCH_A,
        { status: 'INACTIVE', reason: 'Premises closed' },
        META,
      );

      expect(result.status).toBe('INACTIVE');
      expect(result.deactivationReason).toBe('Premises closed');
      expect(result.deactivatedAt).toBeDefined();
    });

    it('reactivates an inactive branch and clears the deactivation fields', async () => {
      // Scenario 28. A stale reason on an active branch would describe a state
      // it is no longer in.
      branches[0].status = 'INACTIVE';
      branches[0].deactivatedAt = new Date();
      branches[0].deactivationReason = 'Premises closed';

      const result = await service.setStatus(
        superAdminContext(),
        BRANCH_A,
        { status: 'ACTIVE' },
        META,
      );

      expect(result.status).toBe('ACTIVE');
      expect(result.deactivatedAt).toBeUndefined();
      expect(result.deactivationReason).toBeUndefined();
    });

    it('refuses to activate a branch while its organization is inactive', async () => {
      // Rule 49: an active branch under a dead tenant would be a route to the
      // very transactions the organization's status is meant to stop.
      branches[0].status = 'INACTIVE';
      organizations[0].status = 'INACTIVE';

      await expect(
        service.setStatus(
          superAdminContext(),
          BRANCH_A,
          { status: 'ACTIVE' },
          META,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a no-op transition', async () => {
      // Recording ACTIVE -> ACTIVE would put a second activation in the log for
      // an event that did not happen.
      await expect(
        service.setStatus(
          superAdminContext(),
          BRANCH_A,
          { status: 'ACTIVE' },
          META,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('audits deactivation and activation under distinct actions', async () => {
      await service.setStatus(
        superAdminContext(),
        BRANCH_A,
        { status: 'INACTIVE' },
        META,
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.BRANCH_DEACTIVATED }),
        expect.anything(),
      );
    });

    it('refuses a Branch Admin changing another branch’s status', async () => {
      await expect(
        service.setStatus(
          branchAdminContext(),
          BRANCH_B,
          { status: 'INACTIVE' },
          META,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('deletes a branch nothing references', async () => {
      // Scenario 29.
      const result = await service.remove(
        superAdminContext(),
        BRANCH_EMPTY,
        META,
      );

      expect(result).toEqual({ branchId: BRANCH_EMPTY, deleted: true });
      expect(branches.find((b) => b.branchId === BRANCH_EMPTY)).toBeUndefined();
    });

    it('audits a successful deletion', async () => {
      await service.remove(superAdminContext(), BRANCH_EMPTY, META);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.BRANCH_DELETED }),
        expect.anything(),
      );
    });

    it('blocks deletion when records reference the branch', async () => {
      // Scenario 30.
      await expect(
        service.remove(superAdminContext(), BRANCH_A, META),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('deletes nothing when blocked', async () => {
      await service
        .remove(superAdminContext(), BRANCH_A, META)
        .catch(() => undefined);

      expect(branches.find((b) => b.branchId === BRANCH_A)).toBeDefined();
    });

    it('names what is blocking, so the caller can act on the advice', async () => {
      // Scenario 30 requires telling the user to deactivate instead. That is
      // only actionable if they can see why deletion was refused.
      const error = await service
        .remove(superAdminContext(), BRANCH_A, META)
        .catch((caught: ConflictException) => caught);

      const response = (error as ConflictException).getResponse() as {
        blockedBy: { entity: string; count: number }[];
      };

      expect(response.blockedBy).toEqual([
        { entity: 'user', label: 'Users', count: 2 },
        { entity: 'loan', label: 'Loans', count: 5 },
        { entity: 'collection', label: 'Collections', count: 11 },
      ]);
    });

    it('audits the blocked attempt', async () => {
      // Scenario 54.
      await service
        .remove(superAdminContext(), BRANCH_A, META)
        .catch(() => undefined);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.BRANCH_DELETE_BLOCKED,
        }),
      );
    });

    it('blocks on a single reference from any one dependency', async () => {
      // Branch B has exactly one user and nothing else.
      await expect(
        service.remove(superAdminContext(), BRANCH_B, META),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a Branch Admin deleting another branch', async () => {
      await expect(
        service.remove(branchAdminContext(), BRANCH_B, META),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('counts every branch-scoped dependency, not a subset', async () => {
      // The guard is only as good as its coverage: if a future model is added
      // to BRANCH_DEPENDENCIES but the loop stops early, this catches it.
      await service.remove(superAdminContext(), BRANCH_EMPTY, META);

      // Asserted against the list rather than a hardcoded length. A literal
      // count only proves someone remembered to edit this line; asking each
      // delegate whether it was actually consulted is the claim the test name
      // makes, and it keeps holding as the list grows.
      const delegates = client as Record<string, { count: jest.Mock }>;
      const uncounted = BRANCH_DEPENDENCIES.filter(
        (dependency) =>
          !delegates[dependency.entity].count.mock.calls.some(
            ([args]: [{ where: { branchId: string } }]) =>
              args.where.branchId === BRANCH_EMPTY,
          ),
      ).map((dependency) => dependency.entity);

      expect(uncounted).toEqual([]);
      expect(BRANCH_DEPENDENCIES.length).toBeGreaterThanOrEqual(14);
    });
  });

  describe('assertBranchOperational', () => {
    it('permits an active branch under an active organization', async () => {
      const prisma = makeClient() as unknown as Pick<
        PrismaService,
        'branch' | 'organization'
      >;

      await expect(
        service.assertBranchOperational(prisma, ORG_ID, BRANCH_A),
      ).resolves.toBeUndefined();
    });

    it('refuses an inactive branch', async () => {
      // Rules 47, 50 — the seam customers/loans/collections will call.
      branches[0].status = 'INACTIVE';
      const prisma = makeClient() as unknown as Pick<
        PrismaService,
        'branch' | 'organization'
      >;

      await expect(
        service.assertBranchOperational(prisma, ORG_ID, BRANCH_A),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses any branch under an inactive organization', async () => {
      // Scenario 10 / Rule 49: deactivating the organization must not leave its
      // branches independently usable.
      organizations[0].status = 'INACTIVE';
      const prisma = makeClient() as unknown as Pick<
        PrismaService,
        'branch' | 'organization'
      >;

      await expect(
        service.assertBranchOperational(prisma, ORG_ID, BRANCH_A),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses an unknown branch', async () => {
      const prisma = makeClient() as unknown as Pick<
        PrismaService,
        'branch' | 'organization'
      >;

      await expect(
        service.assertBranchOperational(prisma, ORG_ID, UNKNOWN_BRANCH),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
