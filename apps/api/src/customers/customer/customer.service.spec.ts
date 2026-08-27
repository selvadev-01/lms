import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { BranchService } from '../../organizations/branch.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { CUSTOMER_DEPENDENCIES } from './customer-dependencies';
import { CustomerService } from './customer.service';

/**
 * Customer registration, search, profile and lifecycle (Module 04).
 *
 * Four things carry the weight here, and none of them is the CRUD.
 *
 * **Scope confinement.** A Branch Admin's widest query must still return only
 * their branch, and a customer in another tenant must be unreachable even to a
 * Super Admin who carries no branch filter at all (Scenarios 21, 30). The
 * Prisma stand-in throws on any query missing its `orgId`, so a widened `where`
 * fails here rather than silently reading another organization's rows.
 *
 * **The activation invariants.** A LOCAL customer cannot go ACTIVE without a
 * verified mobile, and a KYC customer cannot without an approval (Rules 6, 12;
 * Scenario 14). These are the two rules the module exists to enforce, so both
 * directions are asserted.
 *
 * **Duplicate handling.** Scenario 5 asks that the system neither block a
 * legitimate shared household number nor silently create a second active
 * customer. That is a refusal followed by an explicit override, and both halves
 * are tested.
 *
 * **The identity of a refusal.** Out-of-branch, out-of-tenant and absent must
 * be indistinguishable to the caller, or a 404 becomes an enumeration oracle.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const BRANCH_A = '33333333-3333-3333-3333-333333333333';
const BRANCH_B = '44444444-4444-4444-4444-444444444444';

const KYC_ACTIVE_ID = '55555555-5555-5555-5555-555555555555';
const KYC_PENDING_ID = '66666666-6666-6666-6666-666666666666';
const LOCAL_VERIFIED_ID = '77777777-7777-7777-7777-777777777777';
const LOCAL_UNVERIFIED_ID = '88888888-8888-8888-8888-888888888888';
const OTHER_BRANCH_ID = '99999999-9999-9999-9999-999999999999';
const UNKNOWN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const META: RequestMeta = {
  requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  ipAddress: '203.0.113.11',
  userAgent: 'jest',
};

const VERSION = new Date('2026-08-02T00:00:00.000Z').toISOString();

function superAdmin(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: ACTOR_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['customers.view', 'customers.create'],
    ...overrides,
  };
}

function branchAdmin(overrides: Partial<AuthContext> = {}): AuthContext {
  return superAdmin({
    branchId: BRANCH_A,
    roles: ['BRANCH_ADMIN'],
    ...overrides,
  });
}

interface CustomerFixture {
  customerId: string;
  customerCode: string;
  customerType: 'KYC' | 'LOCAL';
  fullName: string;
  mobile: string;
  mobileVerifiedAt: Date | null;
  branchId: string;
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  kycStatus: string | null;
}

const FIXTURES: CustomerFixture[] = [
  {
    customerId: KYC_ACTIVE_ID,
    customerCode: 'CUST001',
    customerType: 'KYC',
    fullName: 'Anitha Raman',
    mobile: '9100000001',
    mobileVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    branchId: BRANCH_A,
    status: 'ACTIVE',
    kycStatus: 'APPROVED',
  },
  {
    customerId: KYC_PENDING_ID,
    customerCode: 'CUST003',
    customerType: 'KYC',
    fullName: 'Chitra Devi',
    mobile: '9100000003',
    mobileVerifiedAt: null,
    branchId: BRANCH_A,
    status: 'PENDING',
    kycStatus: 'SUBMITTED',
  },
  {
    customerId: LOCAL_VERIFIED_ID,
    customerCode: 'CUST005',
    customerType: 'LOCAL',
    fullName: 'Eswari Selvam',
    mobile: '9100000005',
    mobileVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    branchId: BRANCH_A,
    status: 'PENDING',
    kycStatus: null,
  },
  {
    customerId: LOCAL_UNVERIFIED_ID,
    customerCode: 'CUST006',
    customerType: 'LOCAL',
    fullName: 'Farhan Basha',
    mobile: '9100000006',
    mobileVerifiedAt: null,
    branchId: BRANCH_A,
    status: 'PENDING',
    kycStatus: null,
  },
  {
    customerId: OTHER_BRANCH_ID,
    customerCode: 'CUST002',
    customerType: 'KYC',
    fullName: 'Bhaskar Nair',
    mobile: '9100000002',
    mobileVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    branchId: BRANCH_B,
    status: 'ACTIVE',
    kycStatus: 'APPROVED',
  },
];

/**
 * `expect.objectContaining` and `expect.stringContaining` are typed `any`,
 * which trips `no-unsafe-assignment` as soon as either is nested inside an
 * object literal. Narrowing them once here keeps the assertions below both
 * readable and type-safe — the same helper `branch.service.spec.ts` introduced
 * for Module 02.
 */
function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function build(dependencyCounts: Record<string, number> = {}) {
  const state = new Map(FIXTURES.map((c) => [c.customerId, { ...c }]));
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const row = (c: CustomerFixture) => ({
    orgId: ORG_ID,
    customerId: c.customerId,
    branchId: c.branchId,
    customerCode: c.customerCode,
    customerType: c.customerType,
    fullName: c.fullName,
    mobile: c.mobile,
    mobileVerifiedAt: c.mobileVerifiedAt,
    email: null,
    dateOfBirth: null,
    gender: null,
    addressLine1: '12 Gandhi Street',
    addressLine2: null,
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600001',
    status: c.status,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    branch: { name: c.branchId === BRANCH_A ? 'Chennai Main' : 'Coimbatore' },
    kycRecords: c.kycStatus ? [{ status: c.kycStatus }] : [],
  });

  /**
   * The stand-in refuses any query that is not tenant-filtered.
   *
   * This is the test that a missing `orgId` cannot pass: without it, a widened
   * `where` would quietly return another organization's customers and every
   * assertion below would still be green.
   */
  function assertTenant(where: Record<string, unknown>, what: string): void {
    const key = where.orgId_customerId as { orgId: string } | undefined;
    const orgId = key ? key.orgId : where.orgId;
    if (orgId !== ORG_ID) {
      throw new Error(`${what} must be tenant-filtered, got ${String(orgId)}`);
    }
  }

  /**
   * One countable delegate per dependency, built from the dependency table
   * itself rather than through a Proxy.
   *
   * A Proxy cannot be used here: the delegates are spread into the client object
   * below, and spreading copies own enumerable keys — a Proxy whose `get` trap
   * synthesizes them has none, so every delegate would silently vanish.
   *
   * Driving it off `CUSTOMER_DEPENDENCIES` means adding a blocking relation to
   * that table without a matching Prisma model fails here rather than in
   * production.
   */
  const counts = Object.fromEntries(
    CUSTOMER_DEPENDENCIES.map((dependency) => [
      dependency.entity,
      {
        count: jest.fn((args: { where: Record<string, unknown> }) => {
          assertTenant(args.where, `${dependency.entity}.count`);
          return Promise.resolve(dependencyCounts[dependency.entity] ?? 0);
        }),
      },
    ]),
  ) as Record<string, { count: jest.Mock }>;

  const client = {
    customer: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'customer.findMany');
        const branchFilter = args.where.branchId as string | undefined;
        const typeFilter = args.where.customerType as string | undefined;
        const statusFilter = args.where.status as string | undefined;
        const or = args.where.OR as
          Array<Record<string, Record<string, string> | string>> | undefined;
        const mobileEquals = args.where.mobile as string | undefined;

        return Promise.resolve(
          [...state.values()]
            .filter((c) => !branchFilter || c.branchId === branchFilter)
            .filter((c) => !typeFilter || c.customerType === typeFilter)
            .filter((c) => !statusFilter || c.status === statusFilter)
            .filter((c) => !mobileEquals || c.mobile === mobileEquals)
            .filter((c) => {
              if (!or) return true;
              return or.some((clause) => {
                const name = clause.fullName as
                  { contains?: string } | undefined;
                const code = clause.customerCode as
                  { equals?: string } | undefined;
                const mobile = clause.mobile as
                  { startsWith?: string } | undefined;

                if (name?.contains) {
                  return c.fullName
                    .toLowerCase()
                    .includes(name.contains.toLowerCase());
                }
                if (code?.equals) {
                  return (
                    c.customerCode.toLowerCase() === code.equals.toLowerCase()
                  );
                }
                if (mobile?.startsWith) {
                  return c.mobile.startsWith(mobile.startsWith);
                }
                return false;
              });
            })
            .map(row),
        );
      }),
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'customer.findFirst');
        const branchFilter = args.where.branchId as string | undefined;
        const wantedId = args.where.customerId as string | undefined;

        const found = [...state.values()]
          .filter((c) => !branchFilter || c.branchId === branchFilter)
          .find((c) => !wantedId || c.customerId === wantedId);

        return Promise.resolve(found ? row(found) : null);
      }),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        if (args.data.orgId !== ORG_ID) {
          throw new Error('customer.create must carry the caller orgId');
        }
        const created: CustomerFixture = {
          customerId: UNKNOWN_ID,
          customerCode: args.data.customerCode as string,
          customerType: args.data.customerType as 'KYC' | 'LOCAL',
          fullName: args.data.fullName as string,
          mobile: args.data.mobile as string,
          mobileVerifiedAt: null,
          branchId: args.data.branchId as string,
          status: args.data.status as CustomerFixture['status'],
          kycStatus: null,
        };
        state.set(created.customerId, created);
        return Promise.resolve(row(created));
      }),
      update: jest.fn(
        (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          assertTenant(args.where, 'customer.update');
          const key = args.where.orgId_customerId as { customerId: string };
          const found = state.get(key.customerId);
          if (!found) throw new Error('customer.update on a missing customer');

          if (args.data.status !== undefined) {
            found.status = args.data.status as CustomerFixture['status'];
          }
          if (args.data.customerType !== undefined) {
            found.customerType = args.data.customerType as 'KYC' | 'LOCAL';
          }
          if (args.data.mobile !== undefined) {
            found.mobile = args.data.mobile as string;
          }
          if (args.data.fullName !== undefined) {
            found.fullName = args.data.fullName as string;
          }
          if ('mobileVerifiedAt' in args.data) {
            found.mobileVerifiedAt = args.data.mobileVerifiedAt as Date | null;
          }
          return Promise.resolve(row(found));
        },
      ),
      delete: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'customer.delete');
        const key = args.where.orgId_customerId as { customerId: string };
        state.delete(key.customerId);
        return Promise.resolve({});
      }),
      findUnique: jest.fn(() => Promise.resolve(null)),
    },
    customerKyc: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        if (args.data.orgId !== ORG_ID) {
          throw new Error('customerKyc.create must carry the caller orgId');
        }
        return Promise.resolve({ kycId: UNKNOWN_ID, ...args.data });
      }),
    },
    branch: {
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'branch.findFirst');
        const wanted = args.where.branchId as string;
        return Promise.resolve(
          wanted === BRANCH_A || wanted === BRANCH_B
            ? { branchId: wanted }
            : null,
        );
      }),
    },
    ...counts,
  };

  const prisma = {
    ...client,
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn(client),
    ),
  } as unknown as PrismaService;

  const branchesMocks = {
    assertBranchOperational: jest.fn().mockResolvedValue(undefined),
  };
  const branches = branchesMocks as unknown as BranchService;

  const service = new CustomerService(
    prisma,
    audit as unknown as AuditService,
    branches,
  );

  return { service, prisma, audit, branchesMocks, state, client };
}

const NEW_CUSTOMER = {
  customerType: 'KYC' as const,
  fullName: 'New Customer',
  mobile: '9199999999',
  addressLine1: '5 New Street',
};

describe('CustomerService.list', () => {
  it('returns every customer in the organization for an org-wide caller', async () => {
    const { service } = build();
    const rows = await service.list(superAdmin(), {}, META);

    expect(rows).toHaveLength(FIXTURES.length);
  });

  // Scenario 21 — a Branch Admin's widest possible query is still their branch.
  it('confines a branch-scoped caller to their own branch', async () => {
    const { service } = build();
    const rows = await service.list(branchAdmin(), {}, META);

    expect(rows.map((r) => r.customerCode).sort()).toEqual([
      'CUST001',
      'CUST003',
      'CUST005',
      'CUST006',
    ]);
    expect(rows.map((r) => r.customerCode)).not.toContain('CUST002');
  });

  // Q-CUST-21 — a search screen must not double as a bulk PII export.
  it('masks the mobile number in list results', async () => {
    const { service } = build();
    const rows = await service.list(superAdmin(), {}, META);

    // `maskMobile` keeps the first and last two digits: 9100000001 -> 91XXXXXX01.
    expect(rows.every((r) => r.mobile.includes('X'))).toBe(true);
    expect(rows.map((r) => r.mobile)).not.toContain('9100000001');
  });

  // Scenario 18.
  it('finds a customer by partial, case-insensitive name', async () => {
    const { service } = build();
    const rows = await service.list(superAdmin(), { search: 'anitha' }, META);

    expect(rows.map((r) => r.customerCode)).toEqual(['CUST001']);
  });

  // Scenario 19.
  it('finds a customer by exact customer code', async () => {
    const { service } = build();
    const rows = await service.list(superAdmin(), { search: 'CUST003' }, META);

    expect(rows.map((r) => r.customerCode)).toEqual(['CUST003']);
  });

  // Scenario 20.
  it('finds a customer by mobile prefix', async () => {
    const { service } = build();
    const rows = await service.list(
      superAdmin(),
      { search: '910000000' },
      META,
    );

    expect(jest.mocked(rows).length).toBeGreaterThan(1);
  });

  // Scenario 21 again, through search rather than the plain list: a term that
  // matches an out-of-branch customer must still return nothing.
  it('will not surface an out-of-branch customer through search', async () => {
    const { service } = build();
    const rows = await service.list(branchAdmin(), { search: 'Bhaskar' }, META);

    expect(rows).toEqual([]);
  });

  it('filters by customer type', async () => {
    const { service } = build();
    const rows = await service.list(
      superAdmin(),
      { customerType: 'LOCAL' },
      META,
    );

    expect(rows.every((r) => r.customerType === 'LOCAL')).toBe(true);
  });

  it('reports the KYC status of a KYC customer and none for a LOCAL one', async () => {
    const { service } = build();
    const rows = await service.list(superAdmin(), {}, META);

    expect(rows.find((r) => r.customerCode === 'CUST001')?.kycStatus).toBe(
      'APPROVED',
    );
    expect(
      rows.find((r) => r.customerCode === 'CUST005')?.kycStatus,
    ).toBeUndefined();
  });

  it('audits the search including whether the caller was branch-confined', async () => {
    const { service, audit } = build();
    await service.list(branchAdmin(), { search: 'anitha' }, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_LISTED,
        metadata: containing({
          search: 'anitha',
          branchConfined: true,
        }),
      }),
    );
  });
});

describe('CustomerService.getById', () => {
  it('returns the unmasked mobile on the detail view', async () => {
    const { service } = build();
    const detail = await service.getById(superAdmin(), KYC_ACTIVE_ID, META);

    expect(jest.mocked(detail).mobile).toBe('9100000001');
  });

  it('carries a version handle for the next write', async () => {
    const { service } = build();
    const detail = await service.getById(superAdmin(), KYC_ACTIVE_ID, META);

    expect(jest.mocked(detail).version).toBe(VERSION);
  });

  // Scenario 21 — and the message must not distinguish this from "absent".
  it('refuses an out-of-branch customer with the generic not-found', async () => {
    const { service } = build();

    await expect(
      service.getById(branchAdmin(), OTHER_BRANCH_ID, META),
    ).rejects.toThrow(NotFoundException);
  });

  it('gives the same message for an unknown id as for an out-of-scope one', async () => {
    const { service } = build();

    const outOfScope = await service
      .getById(branchAdmin(), OTHER_BRANCH_ID, META)
      .catch((e: Error) => e.message);
    const unknown = await service
      .getById(branchAdmin(), UNKNOWN_ID, META)
      .catch((e: Error) => e.message);

    // If these ever differ, a 404 becomes an oracle for which ids exist.
    expect(outOfScope).toBe(unknown);
  });

  // Scenario 30 — the tenant boundary binds even a caller with no branch filter.
  it('refuses a customer in another organization', async () => {
    const { service } = build();

    await expect(
      service.getById(superAdmin({ orgId: OTHER_ORG_ID }), KYC_ACTIVE_ID, META),
    ).rejects.toThrow();
  });

  it('audits a refusal so the denial is visible even though the caller is not told', async () => {
    const { service, audit } = build();

    await service.getById(branchAdmin(), OTHER_BRANCH_ID, META).catch(() => {});

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.CUSTOMER_SCOPE_DENIED }),
    );
  });
});

/**
 * Customer code allocation (Q-CUST-1).
 *
 * A production bug lives behind these. The generator used to take the first row
 * of `orderBy: { customerCode: 'desc' }` and parse its suffix, which is string
 * order: `CUSTZZ04` sorts above `CUST007` because `Z` > `0`,
 * `parseInt('ZZ04')` is `NaN`, and the `NaN` fallback re-proposed `CUST001` — a
 * code that already existed. Every customer creation then failed on the unique
 * index, and because nothing translated the violation it surfaced as a 503
 * telling the branch to try again later for a request that could never succeed.
 *
 * Codes with non-numeric suffixes are not hypothetical: the e2e suite mints
 * `CUSTZZ*` fixtures, and a branch may supply its own code at creation.
 */
describe('CustomerService — code allocation', () => {
  it('allocates the next code after the highest numeric one', async () => {
    const { service, client } = build();
    await service.create(branchAdmin(), NEW_CUSTOMER, META);

    // CUST006 is the highest numeric fixture.
    expect(client.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerCode: 'CUST007',
        }) as unknown,
      }),
    );
  });

  // The regression itself: a non-numeric suffix must not capture the maximum.
  it('ignores codes whose suffix is not numeric', async () => {
    const { service, client, state } = build();
    state.set('scratch-row', {
      customerId: 'scratch-row',
      customerCode: 'CUSTZZ04',
      customerType: 'KYC',
      fullName: 'Scratch Fixture',
      mobile: '9100009999',
      mobileVerifiedAt: null,
      branchId: BRANCH_A,
      status: 'PENDING',
      kycStatus: null,
    });

    await service.create(branchAdmin(), NEW_CUSTOMER, META);

    // Still CUST007 — not CUST001, which the old NaN fallback produced.
    expect(client.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerCode: 'CUST007',
        }) as unknown,
      }),
    );
  });

  /**
   * The second half of the failure. A duplicate code is a conflict the caller
   * can act on, not a server fault — rendering it as a 503 tells them to wait
   * for a request that will fail identically forever.
   */
  it('reports a duplicate code as a conflict rather than an outage', async () => {
    const { service, client } = build();
    jest
      .mocked(client.customer.create)
      .mockRejectedValueOnce(
        Object.assign(new Error('dup'), { code: 'P2002' }),
      );

    await expect(
      service.create(branchAdmin(), NEW_CUSTOMER, META),
    ).rejects.toThrow(ConflictException);
  });

  it('names the code the caller chose when it is already taken', async () => {
    const { service, client } = build();
    jest
      .mocked(client.customer.create)
      .mockRejectedValueOnce(
        Object.assign(new Error('dup'), { code: 'P2002' }),
      );

    await expect(
      service.create(
        branchAdmin(),
        { ...NEW_CUSTOMER, customerCode: 'CUST001' },
        META,
      ),
    ).rejects.toThrow(/CUST001/);
  });
});

describe('CustomerService.create', () => {
  it('creates a KYC customer PENDING with a KYC record', async () => {
    const { service, client } = build();
    const created = await service.create(branchAdmin(), NEW_CUSTOMER, META);

    expect(jest.mocked(created).status).toBe('PENDING');
    expect(client.customerKyc.create).toHaveBeenCalled();
  });

  // Q-CUST-2 — absence is the representation, so a LOCAL customer must not get
  // a KYC row that would place them in a review queue.
  it('creates a LOCAL customer with no KYC record at all', async () => {
    const { service, client } = build();
    await service.create(
      branchAdmin(),
      { ...NEW_CUSTOMER, customerType: 'LOCAL' },
      META,
    );

    expect(client.customerKyc.create).not.toHaveBeenCalled();
  });

  // Rules 6 and 12 — neither type may be born active.
  it.each(['KYC', 'LOCAL'] as const)(
    'never creates a %s customer ACTIVE',
    async (customerType) => {
      const { service } = build();
      const created = await service.create(
        branchAdmin(),
        { ...NEW_CUSTOMER, customerType },
        META,
      );

      expect(jest.mocked(created).status).toBe('PENDING');
    },
  );

  // Scenario 31 — the client cannot place a customer in another branch.
  it('ignores a submitted branch and uses the caller own branch', async () => {
    const { service, client } = build();
    await service.create(
      branchAdmin(),
      { ...NEW_CUSTOMER, branchId: BRANCH_B },
      META,
    );

    expect(client.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ branchId: BRANCH_A }),
      }),
    );
  });

  it('requires an org-wide caller to name a branch', async () => {
    const { service } = build();

    await expect(
      service.create(superAdmin(), NEW_CUSTOMER, META),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses an org-wide caller a branch outside their tenant', async () => {
    const { service } = build();

    await expect(
      service.create(
        superAdmin(),
        { ...NEW_CUSTOMER, branchId: UNKNOWN_ID },
        META,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // Scenario 5 — flagged, not silently created.
  it('refuses a duplicate mobile and reports the matches', async () => {
    const { service } = build();

    await expect(
      service.create(
        branchAdmin(),
        { ...NEW_CUSTOMER, mobile: '9100000001' },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('proceeds on an explicit duplicate override', async () => {
    const { service, audit } = build();

    const created = await service.create(
      branchAdmin(),
      { ...NEW_CUSTOMER, mobile: '9100000001', force: true },
      META,
    );

    expect(jest.mocked(created).customerId).toBeDefined();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_DUPLICATE_OVERRIDDEN,
      }),
      expect.anything(),
    );
  });

  it('audits the flagged duplicate before refusing', async () => {
    const { service, audit } = build();

    await service
      .create(branchAdmin(), { ...NEW_CUSTOMER, mobile: '9100000001' }, META)
      .catch(() => {});

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_DUPLICATE_FLAGGED,
      }),
    );
  });

  // Rules 47/50 — an inactive branch takes no new customers.
  it('refuses when the branch is not operational', async () => {
    const { service, branchesMocks } = build();
    branchesMocks.assertBranchOperational.mockRejectedValueOnce(
      new ConflictException('This branch is inactive'),
    );

    await expect(
      service.create(branchAdmin(), NEW_CUSTOMER, META),
    ).rejects.toThrow(ConflictException);
  });

  // Scenario 33 — the audit names the type, branch and outcome.
  it('audits creation with the customer type and branch', async () => {
    const { service, audit } = build();
    await service.create(branchAdmin(), NEW_CUSTOMER, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_CREATED,
        metadata: containing({
          customerType: 'KYC',
          branchId: BRANCH_A,
        }),
      }),
      expect.anything(),
    );
  });

  // Scenario 38 — a failed persist leaves no customer and records the attempt.
  it('records a persistence failure and rethrows', async () => {
    const { service, prisma, audit } = build();
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(
      new Error('connection lost'),
    );

    await expect(
      service.create(branchAdmin(), NEW_CUSTOMER, META),
    ).rejects.toThrow('connection lost');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_PERSISTENCE_FAILED,
      }),
    );
  });
});

describe('CustomerService.update', () => {
  const edit = {
    fullName: 'Anitha Raman Updated',
    mobile: '9100000001',
    addressLine1: '12 Gandhi Street',
    expectedVersion: VERSION,
  };

  it('applies a profile edit', async () => {
    const { service } = build();
    const updated = await service.update(
      branchAdmin(),
      KYC_ACTIVE_ID,
      edit,
      META,
    );

    expect(jest.mocked(updated).fullName).toBe('Anitha Raman Updated');
  });

  // Scenario 41 — the losing edit is refused rather than silently overwriting.
  it('refuses an edit carrying a stale version', async () => {
    const { service } = build();

    await expect(
      service.update(
        branchAdmin(),
        KYC_ACTIVE_ID,
        { ...edit, expectedVersion: '2020-01-01T00:00:00.000Z' },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('audits a rejected concurrent edit', async () => {
    const { service, audit } = build();

    await service
      .update(
        branchAdmin(),
        KYC_ACTIVE_ID,
        { ...edit, expectedVersion: '2020-01-01T00:00:00.000Z' },
        META,
      )
      .catch(() => {});

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_CONCURRENT_EDIT_REJECTED,
      }),
    );
  });

  // Q-CUST-28 — the verification belongs to the number.
  it('clears mobile verification when the number changes', async () => {
    const { service, state } = build();
    await service.update(
      branchAdmin(),
      LOCAL_VERIFIED_ID,
      {
        fullName: 'Eswari Selvam',
        mobile: '9188888888',
        addressLine1: '12 Gandhi Street',
        expectedVersion: VERSION,
      },
      META,
    );

    expect(state.get(LOCAL_VERIFIED_ID)?.mobileVerifiedAt).toBeNull();
  });

  it('keeps verification intact when the number is unchanged', async () => {
    const { service, state } = build();
    await service.update(
      branchAdmin(),
      LOCAL_VERIFIED_ID,
      {
        fullName: 'Eswari S',
        mobile: '9100000005',
        addressLine1: '12 Gandhi Street',
        expectedVersion: VERSION,
      },
      META,
    );

    expect(state.get(LOCAL_VERIFIED_ID)?.mobileVerifiedAt).not.toBeNull();
  });

  it('refuses an edit to an out-of-branch customer', async () => {
    const { service } = build();

    await expect(
      service.update(branchAdmin(), OTHER_BRANCH_ID, edit, META),
    ).rejects.toThrow(NotFoundException);
  });

  // Scenario 36 — the audit carries before and after, so an edit against an
  // approved customer stays reviewable.
  it('audits the before and after values', async () => {
    const { service, audit } = build();
    await service.update(branchAdmin(), KYC_ACTIVE_ID, edit, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_UPDATED,
        oldData: containing({ fullName: 'Anitha Raman' }),
        newData: containing({ fullName: 'Anitha Raman Updated' }),
      }),
      expect.anything(),
    );
  });

  it('masks the mobile number in the audit snapshots', async () => {
    const { service, audit } = build();
    await service.update(branchAdmin(), KYC_ACTIVE_ID, edit, META);

    // Typed explicitly: `mock.calls` is `any[][]`, and reading the audit input
    // off it untyped is what the unsafe-access rules object to.
    const calls = audit.record.mock.calls as Array<
      [{ action: string; oldData?: { mobile?: string } }]
    >;
    const call = calls.find(
      ([input]) => input.action === AuditAction.CUSTOMER_UPDATED,
    );

    expect(call?.[0].oldData?.mobile).toContain('X');
  });
});

describe('CustomerService.setStatus', () => {
  // Scenario 14 — the LOCAL invariant.
  it('refuses to activate a LOCAL customer whose mobile is unverified', async () => {
    const { service } = build();

    await expect(
      service.setStatus(
        branchAdmin(),
        LOCAL_UNVERIFIED_ID,
        { status: 'ACTIVE' },
        META,
      ),
    ).rejects.toThrow(/Mobile number must be verified/);
  });

  it('activates a LOCAL customer whose mobile is verified', async () => {
    const { service } = build();
    const updated = await service.setStatus(
      branchAdmin(),
      LOCAL_VERIFIED_ID,
      { status: 'ACTIVE' },
      META,
    );

    expect(jest.mocked(updated).status).toBe('ACTIVE');
  });

  // Rule 6 — the KYC invariant.
  it('refuses to activate a KYC customer whose KYC is not approved', async () => {
    const { service } = build();

    await expect(
      service.setStatus(
        branchAdmin(),
        KYC_PENDING_ID,
        { status: 'ACTIVE' },
        META,
      ),
    ).rejects.toThrow(/KYC must be approved/);
  });

  it('audits a refused activation with the reason it was refused', async () => {
    const { service, audit } = build();

    await service
      .setStatus(branchAdmin(), LOCAL_UNVERIFIED_ID, { status: 'ACTIVE' }, META)
      .catch(() => {});

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_ACTIVATION_REJECTED,
        metadata: containing({ mobileVerified: false }),
      }),
    );
  });

  // Q-CUST-12 — deactivation is never blocked by an active loan.
  it('deactivates without checking KYC or verification', async () => {
    const { service } = build();
    const updated = await service.setStatus(
      branchAdmin(),
      KYC_PENDING_ID,
      { status: 'INACTIVE' },
      META,
    );

    expect(jest.mocked(updated).status).toBe('INACTIVE');
  });

  it('refuses a status change on an out-of-branch customer', async () => {
    const { service } = build();

    await expect(
      service.setStatus(
        branchAdmin(),
        OTHER_BRANCH_ID,
        { status: 'INACTIVE' },
        META,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('CustomerService.convertToKyc', () => {
  // Scenario 27.
  it('converts a LOCAL customer and retains the same record', async () => {
    const { service } = build();
    const converted = await service.convertToKyc(
      superAdmin(),
      LOCAL_VERIFIED_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(jest.mocked(converted).customerId).toBe(LOCAL_VERIFIED_ID);
    expect(jest.mocked(converted).customerType).toBe('KYC');
  });

  it('starts a fresh KYC cycle and returns the customer to PENDING', async () => {
    const { service, client } = build();
    const converted = await service.convertToKyc(
      superAdmin(),
      LOCAL_VERIFIED_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(jest.mocked(converted).status).toBe('PENDING');
    expect(client.customerKyc.create).toHaveBeenCalled();
  });

  // There is no KYC to LOCAL direction: it would discard a verification.
  it('refuses to convert a customer who is already KYC', async () => {
    const { service } = build();

    await expect(
      service.convertToKyc(
        superAdmin(),
        KYC_ACTIVE_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('audits a refused conversion', async () => {
    const { service, audit } = build();

    await service
      .convertToKyc(
        superAdmin(),
        KYC_ACTIVE_ID,
        { expectedVersion: VERSION },
        META,
      )
      .catch(() => {});

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_CONVERT_REJECTED,
      }),
    );
  });

  // Scenario 35 — both the previous and new type are retained.
  it('audits the previous and new customer type', async () => {
    const { service, audit } = build();
    await service.convertToKyc(
      superAdmin(),
      LOCAL_VERIFIED_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_TYPE_CONVERTED,
        oldData: containing({ customerType: 'LOCAL' }),
        newData: containing({ customerType: 'KYC' }),
      }),
      expect.anything(),
    );
  });

  it('refuses a conversion carrying a stale version', async () => {
    const { service } = build();

    await expect(
      service.convertToKyc(
        superAdmin(),
        LOCAL_VERIFIED_ID,
        { expectedVersion: '2020-01-01T00:00:00.000Z' },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('CustomerService.remove', () => {
  it('deletes a customer nothing references', async () => {
    const { service, state } = build();
    const outcome = await service.remove(branchAdmin(), KYC_ACTIVE_ID, META);

    expect(jest.mocked(outcome).deleted).toBe(true);
    expect(state.has(KYC_ACTIVE_ID)).toBe(false);
  });

  // Scenario 37, Rule 23 — financial history makes a customer permanent.
  it.each([
    ['loan', 'Loans'],
    ['collection', 'Collections'],
    ['loanApplication', 'Loan applications'],
  ])('refuses deletion when %s rows exist', async (entity, label) => {
    const { service, state } = build({ [entity]: 2 });
    const outcome = await service.remove(branchAdmin(), KYC_ACTIVE_ID, META);

    expect(jest.mocked(outcome).deleted).toBe(false);
    if (outcome.deleted) return;
    expect(jest.mocked(outcome).blockedBy).toEqual([
      expect.objectContaining({ label, count: 2 }),
    ]);
    // Rule 22 — the customer is still there, and so is their history.
    expect(state.has(KYC_ACTIVE_ID)).toBe(true);
  });

  it('audits a blocked delete with the blockers', async () => {
    const { service, audit } = build({ loan: 1 });
    await service.remove(branchAdmin(), KYC_ACTIVE_ID, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_DELETE_BLOCKED,
      }),
    );
  });

  it('audits the record before deleting it', async () => {
    const { service, audit } = build();
    await service.remove(branchAdmin(), KYC_ACTIVE_ID, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_DELETED,
        oldData: containing({ customerCode: 'CUST001' }),
      }),
      expect.anything(),
    );
  });

  it('refuses to delete an out-of-branch customer', async () => {
    const { service } = build();

    await expect(
      service.remove(branchAdmin(), OTHER_BRANCH_ID, META),
    ).rejects.toThrow(NotFoundException);
  });
});
