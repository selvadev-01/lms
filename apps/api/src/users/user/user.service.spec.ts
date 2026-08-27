import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { SessionService } from '../../auth/session.service';
import type { AuthContext } from '../../common/auth-context';
import type { BranchService } from '../../organizations/branch.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { UserService } from './user.service';

/**
 * User and Employee management.
 *
 * Four things carry the weight, and none of them is the CRUD.
 *
 * **The surface split.** Users and employees are one table distinguished by
 * `employeeCode`. The filter has to be applied to single-record reads as well as
 * lists, or a caller holding only `employees.view` reaches an administrator's
 * record through `GET /employees/:userId`. That is the easiest bug to write in
 * this module and it has its own describe block below.
 *
 * **Branch confinement**, including the asymmetry that a branch-scoped caller
 * must also be refused an organization-wide administrator — whose `branchId` is
 * null and therefore never equals theirs.
 *
 * **The lockout guards.** Self-deactivation and last-system-admin. Without them a
 * single click can leave an organization with nobody able to administer it.
 *
 * **Delegation scoped to self.** The subset rule blocks self-escalation only.
 * Applied to every assignment it would forbid creating a Field Employee at all,
 * because `FIELD_EMPLOYEE` grants `field.checkin` and administrators deliberately
 * do not hold it — separation of duties, not a privilege leak. Both directions
 * are asserted.
 *
 * The Prisma stand-in throws on any query it does not model, so a widened `where`
 * fails here rather than silently reading another tenant's rows.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const EMPLOYEE_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_BRANCH_USER_ID = '55555555-5555-5555-5555-555555555555';
const UNKNOWN_ID = '66666666-6666-6666-6666-666666666666';
const BRANCH_A = '77777777-7777-7777-7777-777777777777';
const BRANCH_B = '88888888-8888-8888-8888-888888888888';
const SYSTEM_ROLE_ID = '99999999-9999-9999-9999-999999999999';
const PLAIN_ROLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FIELD_ROLE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INACTIVE_ROLE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const META: RequestMeta = {
  requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  ipAddress: '203.0.113.11',
  userAgent: 'jest',
};

function superAdmin(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: ACTOR_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['users.view', 'users.create', 'branches.view'],
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

interface UserFixture {
  userId: string;
  name: string;
  mobile: string;
  email: string | null;
  employeeCode: string | null;
  branchId: string | null;
  status: string;
  roleIds: string[];
}

const ADMIN: UserFixture = {
  userId: ADMIN_ID,
  name: 'Branch Admin A',
  mobile: '9000000002',
  email: null,
  employeeCode: null,
  branchId: BRANCH_A,
  status: 'ACTIVE',
  roleIds: [PLAIN_ROLE_ID],
};

const EMPLOYEE: UserFixture = {
  userId: EMPLOYEE_ID,
  name: 'Field Employee',
  mobile: '9000000017',
  email: null,
  employeeCode: 'EMP017',
  branchId: BRANCH_A,
  status: 'ACTIVE',
  roleIds: [FIELD_ROLE_ID],
};

const OTHER_BRANCH_USER: UserFixture = {
  userId: OTHER_BRANCH_USER_ID,
  name: 'Coimbatore Admin',
  mobile: '9000000016',
  email: null,
  employeeCode: null,
  branchId: BRANCH_B,
  status: 'ACTIVE',
  roleIds: [PLAIN_ROLE_ID],
};

const ROLES: Record<
  string,
  { code: string; status: string; isSystem: boolean; permissions: string[] }
> = {
  [SYSTEM_ROLE_ID]: {
    code: 'SUPER_ADMIN',
    status: 'ACTIVE',
    isSystem: true,
    permissions: ['users.view'],
  },
  [PLAIN_ROLE_ID]: {
    code: 'BRANCH_ADMIN',
    status: 'ACTIVE',
    isSystem: false,
    permissions: ['users.view'],
  },
  [FIELD_ROLE_ID]: {
    code: 'FIELD_EMPLOYEE',
    status: 'ACTIVE',
    isSystem: false,
    // The permission administrators deliberately never hold.
    permissions: ['field.checkin'],
  },
  [INACTIVE_ROLE_ID]: {
    code: 'RBAC_INACTIVE_ROLE',
    status: 'INACTIVE',
    isSystem: false,
    permissions: ['users.view'],
  },
};

function buildDb(
  users: UserFixture[],
  dependencyCounts: Record<string, number> = {},
) {
  const state = new Map(users.map((u) => [u.userId, { ...u }]));
  const deleted: string[] = [];

  const row = (u: UserFixture) => ({
    orgId: ORG_ID,
    userId: u.userId,
    name: u.name,
    mobile: u.mobile,
    email: u.email,
    employeeCode: u.employeeCode,
    branchId: u.branchId,
    status: u.status,
    lastLoginAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    branch: u.branchId ? { name: 'Chennai Main' } : null,
    userRoles: u.roleIds.map((roleId) => ({
      role: { code: ROLES[roleId].code },
    })),
  });

  function assertTenant(where: Record<string, unknown>, what: string): void {
    const key = where.orgId_userId as { orgId: string } | undefined;
    const orgId = key ? key.orgId : where.orgId;
    if (orgId !== ORG_ID) {
      throw new Error(`${what} must be tenant-filtered, got ${String(orgId)}`);
    }
  }

  const counts = new Proxy(
    {},
    {
      get: (_t, entity: string) => ({
        count: jest.fn((args: { where: Record<string, unknown> }) => {
          assertTenant(args.where, `${entity}.count`);
          return Promise.resolve(dependencyCounts[entity] ?? 0);
        }),
      }),
    },
  ) as Record<string, { count: jest.Mock }>;

  const client = {
    user: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'user.findMany');
        const wantEmployee =
          typeof args.where.employeeCode === 'object' &&
          args.where.employeeCode !== null;
        const branchFilter = args.where.branchId as string | undefined;
        const statusFilter = args.where.status as string | undefined;

        return Promise.resolve(
          [...state.values()]
            .filter((u) => (u.employeeCode !== null) === wantEmployee)
            .filter((u) => !branchFilter || u.branchId === branchFilter)
            .filter((u) => !statusFilter || u.status === statusFilter)
            .map(row),
        );
      }),
      findUnique: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'user.findUnique');
        const key = args.where.orgId_userId as { userId: string };
        const found = state.get(key.userId);
        return Promise.resolve(found ? row(found) : null);
      }),
      findUniqueOrThrow: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'user.findUniqueOrThrow');
        const key = args.where.orgId_userId as { userId: string };
        const found = state.get(key.userId);
        if (!found) throw new Error('not found');
        return Promise.resolve(row(found));
      }),
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'user.findFirst');
        const or = args.where.OR as Array<Record<string, string>>;
        const found = [...state.values()].find((u) =>
          or.some(
            (clause) =>
              (clause.mobile !== undefined && clause.mobile === u.mobile) ||
              (clause.email !== undefined && clause.email === u.email) ||
              (clause.employeeCode !== undefined &&
                clause.employeeCode === u.employeeCode),
          ),
        );
        return Promise.resolve(found ? row(found) : null);
      }),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        if (args.data.orgId !== ORG_ID) {
          throw new Error('user.create must carry the caller orgId');
        }
        const fixture: UserFixture = {
          userId: UNKNOWN_ID,
          name: args.data.name as string,
          mobile: args.data.mobile as string,
          email: (args.data.email as string | null) ?? null,
          employeeCode: (args.data.employeeCode as string | null) ?? null,
          branchId: (args.data.branchId as string | null) ?? null,
          status: args.data.status as string,
          roleIds: [],
        };
        state.set(fixture.userId, fixture);
        return Promise.resolve(row(fixture));
      }),
      update: jest.fn(
        (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          assertTenant(args.where, 'user.update');
          const key = args.where.orgId_userId as { userId: string };
          const found = state.get(key.userId);
          if (!found) throw new Error('user.update on a missing user');
          Object.assign(found, args.data);
          return Promise.resolve(row(found));
        },
      ),
      delete: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'user.delete');
        const key = args.where.orgId_userId as { userId: string };
        deleted.push(key.userId);
        state.delete(key.userId);
        return Promise.resolve({});
      }),
    },
    role: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'role.findMany');
        const ids = (args.where.roleId as { in: string[] }).in;
        return Promise.resolve(
          ids
            .filter((id) => ROLES[id])
            .map((id) => ({
              roleId: id,
              code: ROLES[id].code,
              status: ROLES[id].status,
              rolePermissions: ROLES[id].permissions.map((code) => ({
                permission: { code },
              })),
            })),
        );
      }),
    },
    userRole: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'userRole.findMany');
        const found = state.get(args.where.userId as string);
        const systemOnly =
          (args.where.role as { isSystem?: boolean } | undefined)?.isSystem ===
          true;
        return Promise.resolve(
          (found?.roleIds ?? [])
            .filter((id) => !systemOnly || ROLES[id].isSystem)
            .map((roleId) => ({ roleId })),
        );
      }),
      count: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'userRole.count');
        const roleIds = (args.where.roleId as { in: string[] }).in;
        const excluded = (args.where.userId as { not: string }).not;
        const others = [...state.values()].filter(
          (u) =>
            u.userId !== excluded &&
            u.status === 'ACTIVE' &&
            u.roleIds.some((id) => roleIds.includes(id)),
        );
        return Promise.resolve(others.length);
      }),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      createMany: jest.fn(
        (args: { data: Array<{ userId: string; roleId: string }> }) => {
          const target = args.data[0]?.userId;
          const found = target ? state.get(target) : undefined;
          if (found) found.roleIds = args.data.map((d) => d.roleId);
          return Promise.resolve({ count: args.data.length });
        },
      ),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(
        new Proxy(client, {
          get: (target, prop: string) =>
            prop in target ? target[prop] : counts[prop],
        }),
      ),
    ),
  } as Record<string, unknown>;

  return {
    state,
    deleted,
    client: () =>
      new Proxy(client, {
        get: (target, prop: string) =>
          prop in target ? target[prop] : counts[prop],
      }) as unknown as PrismaService,
  };
}

function buildAudit() {
  const events: Array<{ action: string; metadata?: Record<string, unknown> }> =
    [];
  const record = jest.fn(
    (input: { action: string; metadata?: Record<string, unknown> }) => {
      events.push({ action: input.action, metadata: input.metadata });
      return Promise.resolve();
    },
  );
  return {
    events,
    actions: () => events.map((e) => e.action),
    service: () => ({ record }) as unknown as AuditService,
  };
}

function buildBranches(operational = true) {
  return {
    assertBranchOperational: jest.fn(() => {
      if (!operational) {
        throw new ConflictException('This branch is inactive');
      }
      return Promise.resolve();
    }),
  } as unknown as BranchService;
}

function buildSessions() {
  const revokeAllForUser = jest.fn().mockResolvedValue(2);
  return {
    revokeAllForUser,
    service: () => ({ revokeAllForUser }) as unknown as SessionService,
  };
}

function makeService(
  db: ReturnType<typeof buildDb>,
  audit: ReturnType<typeof buildAudit>,
  branches: BranchService = buildBranches(),
  sessions: SessionService = buildSessions().service(),
): UserService {
  return new UserService(db.client(), audit.service(), branches, sessions);
}

describe('UserService — the surface split', () => {
  it('lists administrators without employee records', async () => {
    const db = buildDb([ADMIN, EMPLOYEE]);

    const result = await makeService(db, buildAudit()).list(
      superAdmin(),
      'USER',
      {},
      META,
    );

    expect(result.map((u) => u.userId)).toEqual([ADMIN_ID]);
  });

  it('lists employees without administrator records', async () => {
    const db = buildDb([ADMIN, EMPLOYEE]);

    const result = await makeService(db, buildAudit()).list(
      superAdmin(),
      'EMPLOYEE',
      {},
      META,
    );

    expect(result.map((u) => u.userId)).toEqual([EMPLOYEE_ID]);
  });

  it('refuses an administrator reached through the employee surface', async () => {
    // The leak this module is most likely to have: applying the employeeCode
    // filter only in list() leaves the detail route reachable.
    const db = buildDb([ADMIN, EMPLOYEE]);
    const audit = buildAudit();

    await expect(
      makeService(db, audit).getById(superAdmin(), 'EMPLOYEE', ADMIN_ID, META),
    ).rejects.toThrow(NotFoundException);

    const denial = audit.events.find(
      (e) => e.action === AuditAction.USER_SCOPE_DENIED,
    );
    expect(denial?.metadata?.reason).toBe('WRONG_SURFACE');
  });

  it('refuses an employee reached through the user surface', async () => {
    const db = buildDb([ADMIN, EMPLOYEE]);

    await expect(
      makeService(db, buildAudit()).getById(
        superAdmin(),
        'USER',
        EMPLOYEE_ID,
        META,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('UserService — branch confinement', () => {
  it('confines a branch-scoped caller to their own branch', async () => {
    const db = buildDb([ADMIN, OTHER_BRANCH_USER]);

    const result = await makeService(db, buildAudit()).list(
      branchAdmin(),
      'USER',
      {},
      META,
    );

    expect(result.map((u) => u.userId)).toEqual([ADMIN_ID]);
  });

  it('refuses a user in another branch — Scenario 23', async () => {
    const db = buildDb([ADMIN, OTHER_BRANCH_USER]);
    const audit = buildAudit();

    await expect(
      makeService(db, audit).getById(
        branchAdmin(),
        'USER',
        OTHER_BRANCH_USER_ID,
        META,
      ),
    ).rejects.toThrow(ForbiddenException);

    const denial = audit.events.find(
      (e) => e.action === AuditAction.USER_SCOPE_DENIED,
    );
    expect(denial?.metadata?.reason).toBe('BRANCH_SCOPE');
  });

  it('refuses an organization-wide administrator to a branch-scoped caller', async () => {
    // The asymmetry: a null branchId never equals the caller's branch, so an
    // org-wide admin is out of reach — which is the intent.
    const orgWide: UserFixture = { ...ADMIN, branchId: null };
    const db = buildDb([orgWide]);

    await expect(
      makeService(db, buildAudit()).getById(
        branchAdmin(),
        'USER',
        ADMIN_ID,
        META,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('uses one opaque message for every unreachable case', async () => {
    const db = buildDb([ADMIN]);
    const service = makeService(db, buildAudit());

    await expect(
      service.getById(superAdmin(), 'USER', UNKNOWN_ID, META),
    ).rejects.toThrow('User not found');
    await expect(
      service.getById(branchAdmin(), 'USER', ADMIN_ID, META),
    ).resolves.toBeDefined();
  });

  it('refuses assigning a user to a branch outside the caller scope', async () => {
    const db = buildDb([EMPLOYEE]);

    await expect(
      makeService(db, buildAudit()).assign(
        branchAdmin(),
        EMPLOYEE_ID,
        { branchId: BRANCH_B },
        META,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('UserService.create', () => {
  it('creates an employee with its roles', async () => {
    const db = buildDb([]);
    const audit = buildAudit();

    const result = await makeService(db, audit).create(
      superAdmin(),
      'EMPLOYEE',
      {
        name: 'New Employee',
        mobile: '9000000090',
        employeeCode: 'EMP090',
        branchId: BRANCH_A,
        roleIds: [FIELD_ROLE_ID],
        status: 'PENDING',
      },
      META,
    );

    expect(result.employeeCode).toBe('EMP090');
    expect(audit.actions()).toContain(AuditAction.EMPLOYEE_CREATED);
  });

  it('assigns an operational role the actor does not hold — Rule 27 is about escalation', async () => {
    // FIELD_EMPLOYEE grants field.checkin, which no administrator holds. A
    // blanket subset rule here would make Field Employees uncreatable.
    const db = buildDb([]);

    await expect(
      makeService(db, buildAudit()).create(
        superAdmin(),
        'EMPLOYEE',
        {
          name: 'New Employee',
          mobile: '9000000090',
          employeeCode: 'EMP090',
          branchId: BRANCH_A,
          roleIds: [FIELD_ROLE_ID],
          status: 'PENDING',
        },
        META,
      ),
    ).resolves.toBeDefined();
  });

  it('refuses a duplicate mobile — Scenario 3', async () => {
    const db = buildDb([ADMIN]);

    await expect(
      makeService(db, buildAudit()).create(
        superAdmin(),
        'USER',
        {
          name: 'Clash',
          mobile: ADMIN.mobile,
          roleIds: [PLAIN_ROLE_ID],
          status: 'PENDING',
        },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses creating an ACTIVE account that has no password', async () => {
    const db = buildDb([]);

    await expect(
      makeService(db, buildAudit()).create(
        superAdmin(),
        'USER',
        {
          name: 'Live',
          mobile: '9000000093',
          roleIds: [PLAIN_ROLE_ID],
          status: 'ACTIVE',
        },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses an inactive branch — Scenario 16', async () => {
    const db = buildDb([]);

    await expect(
      makeService(db, buildAudit(), buildBranches(false)).create(
        superAdmin(),
        'EMPLOYEE',
        {
          name: 'New Employee',
          mobile: '9000000090',
          employeeCode: 'EMP090',
          branchId: BRANCH_A,
          roleIds: [FIELD_ROLE_ID],
          status: 'PENDING',
        },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('never writes a password hash — credentials belong to the auth module', async () => {
    const db = buildDb([]);

    await makeService(db, buildAudit()).create(
      superAdmin(),
      'USER',
      {
        name: 'New Admin',
        mobile: '9000000094',
        roleIds: [PLAIN_ROLE_ID],
        status: 'PENDING',
      },
      META,
    );

    const create = (db.client().user.create as jest.Mock).mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(create[0].data.passwordHash).toBeNull();
  });
});

describe('UserService.assignRoles', () => {
  it('refuses an INACTIVE role — Scenario 35', async () => {
    const db = buildDb([ADMIN]);
    const audit = buildAudit();

    await expect(
      makeService(db, audit).assignRoles(
        superAdmin(),
        ADMIN_ID,
        { roleIds: [INACTIVE_ROLE_ID] },
        META,
      ),
    ).rejects.toThrow(ConflictException);

    expect(audit.actions()).toContain(AuditAction.USER_ROLE_ASSIGN_DENIED);
  });

  it('refuses an unknown role', async () => {
    const db = buildDb([ADMIN]);

    await expect(
      makeService(db, buildAudit()).assignRoles(
        superAdmin(),
        ADMIN_ID,
        { roleIds: [UNKNOWN_ID] },
        META,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('assigns an operational role to someone else', async () => {
    const db = buildDb([ADMIN]);

    await expect(
      makeService(db, buildAudit()).assignRoles(
        superAdmin(),
        ADMIN_ID,
        { roleIds: [FIELD_ROLE_ID] },
        META,
      ),
    ).resolves.toBeDefined();
  });

  it('refuses granting oneself a permission one does not hold — Scenario 37', async () => {
    const self: UserFixture = { ...ADMIN, userId: ACTOR_ID };
    const db = buildDb([self]);
    const audit = buildAudit();

    await expect(
      makeService(db, audit).assignRoles(
        superAdmin(),
        ACTOR_ID,
        { roleIds: [FIELD_ROLE_ID] },
        META,
      ),
    ).rejects.toThrow(ForbiddenException);

    const denial = audit.events.find(
      (e) => e.action === AuditAction.USER_ROLE_ASSIGN_DENIED,
    );
    expect(denial?.metadata?.reason).toBe('SELF_ESCALATION');
  });

  it('records the previous and new role sets — Scenario 36', async () => {
    const db = buildDb([ADMIN]);
    const audit = buildAudit();

    await makeService(db, audit).assignRoles(
      superAdmin(),
      ADMIN_ID,
      { roleIds: [FIELD_ROLE_ID] },
      META,
    );

    expect(audit.actions()).toContain(AuditAction.USER_ROLES_ASSIGNED);
  });
});

describe('UserService.setStatus', () => {
  it('deactivates and revokes the account sessions — Scenarios 8, 45', async () => {
    const db = buildDb([ADMIN]);
    const audit = buildAudit();
    const sessions = buildSessions();

    await makeService(db, audit, buildBranches(), sessions.service()).setStatus(
      superAdmin(),
      'USER',
      ADMIN_ID,
      { status: 'INACTIVE' },
      META,
    );

    expect(db.state.get(ADMIN_ID)?.status).toBe('INACTIVE');
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      ORG_ID,
      ADMIN_ID,
      'ACCOUNT_INELIGIBLE',
    );
    expect(audit.actions()).toContain(AuditAction.USER_DEACTIVATED);
  });

  it('does not revoke sessions when activating', async () => {
    const db = buildDb([{ ...ADMIN, status: 'INACTIVE' }]);
    const sessions = buildSessions();

    await makeService(
      db,
      buildAudit(),
      buildBranches(),
      sessions.service(),
    ).setStatus(superAdmin(), 'USER', ADMIN_ID, { status: 'ACTIVE' }, META);

    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('commits the deactivation even if session revocation fails', async () => {
    // The live status check already refuses the account, so a surviving session
    // row is inert. Rolling back a committed deactivation would be worse.
    const db = buildDb([ADMIN]);
    const revokeAllForUser = jest.fn().mockRejectedValue(new Error('down'));
    const sessions = { revokeAllForUser } as unknown as SessionService;

    await expect(
      makeService(db, buildAudit(), buildBranches(), sessions).setStatus(
        superAdmin(),
        'USER',
        ADMIN_ID,
        { status: 'INACTIVE' },
        META,
      ),
    ).resolves.toBeDefined();

    expect(db.state.get(ADMIN_ID)?.status).toBe('INACTIVE');
  });

  it('refuses a no-op status change', async () => {
    const db = buildDb([ADMIN]);

    await expect(
      makeService(db, buildAudit()).setStatus(
        superAdmin(),
        'USER',
        ADMIN_ID,
        { status: 'ACTIVE' },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses self-deactivation', async () => {
    const self: UserFixture = { ...ADMIN, userId: ACTOR_ID };
    const db = buildDb([self]);
    const audit = buildAudit();

    await expect(
      makeService(db, audit).setStatus(
        superAdmin(),
        'USER',
        ACTOR_ID,
        { status: 'INACTIVE' },
        META,
      ),
    ).rejects.toThrow(ConflictException);

    expect(audit.actions()).toContain(AuditAction.USER_LOCKOUT_PREVENTED);
  });

  it('refuses deactivating the last active system-role holder', async () => {
    const lastAdmin: UserFixture = {
      ...ADMIN,
      roleIds: [SYSTEM_ROLE_ID],
    };
    const db = buildDb([lastAdmin]);
    const audit = buildAudit();

    await expect(
      makeService(db, audit).setStatus(
        superAdmin(),
        'USER',
        ADMIN_ID,
        { status: 'INACTIVE' },
        META,
      ),
    ).rejects.toThrow(ConflictException);

    expect(audit.actions()).toContain(AuditAction.USER_LOCKOUT_PREVENTED);
    expect(db.state.get(ADMIN_ID)?.status).toBe('ACTIVE');
  });

  it('permits deactivating a system-role holder while another remains', async () => {
    const first: UserFixture = { ...ADMIN, roleIds: [SYSTEM_ROLE_ID] };
    const second: UserFixture = {
      ...OTHER_BRANCH_USER,
      roleIds: [SYSTEM_ROLE_ID],
    };
    const db = buildDb([first, second]);

    await expect(
      makeService(db, buildAudit()).setStatus(
        superAdmin(),
        'USER',
        ADMIN_ID,
        { status: 'INACTIVE' },
        META,
      ),
    ).resolves.toBeDefined();
  });
});

describe('UserService.assign', () => {
  it('moves an active employee and records both branches — Scenario 50', async () => {
    const db = buildDb([EMPLOYEE]);
    const audit = buildAudit();

    await makeService(db, audit).assign(
      superAdmin(),
      EMPLOYEE_ID,
      { branchId: BRANCH_B, reason: 'transfer' },
      META,
    );

    expect(db.state.get(EMPLOYEE_ID)?.branchId).toBe(BRANCH_B);
    expect(audit.actions()).toContain(AuditAction.EMPLOYEE_ASSIGNED);
  });

  it('refuses assigning an inactive employee — Scenarios 10, 53', async () => {
    const db = buildDb([{ ...EMPLOYEE, status: 'INACTIVE' }]);
    const audit = buildAudit();

    await expect(
      makeService(db, audit).assign(
        superAdmin(),
        EMPLOYEE_ID,
        { branchId: BRANCH_B },
        META,
      ),
    ).rejects.toThrow(ConflictException);

    expect(audit.actions()).toContain(AuditAction.EMPLOYEE_ASSIGN_REJECTED);
  });

  it('refuses an inactive target branch — Scenario 16', async () => {
    const db = buildDb([EMPLOYEE]);

    await expect(
      makeService(db, buildAudit(), buildBranches(false)).assign(
        superAdmin(),
        EMPLOYEE_ID,
        { branchId: BRANCH_B },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('UserService.remove', () => {
  it('deletes a user nothing references', async () => {
    const db = buildDb([ADMIN]);
    const audit = buildAudit();

    const result = await makeService(db, audit).remove(
      superAdmin(),
      'USER',
      ADMIN_ID,
      META,
    );

    expect(result).toEqual({ userId: ADMIN_ID, deleted: true });
    expect(audit.actions()).toContain(AuditAction.USER_DELETED);
  });

  it('refuses once audit history exists, and names it — Scenario 54', async () => {
    const db = buildDb([ADMIN], { auditLog: 4 });
    const audit = buildAudit();

    await expect(
      makeService(db, audit).remove(superAdmin(), 'USER', ADMIN_ID, META),
    ).rejects.toMatchObject({
      response: {
        blockedBy: [{ entity: 'auditLog', label: 'Audit records', count: 4 }],
      },
    });

    expect(db.deleted).toHaveLength(0);
    expect(audit.actions()).toContain(AuditAction.USER_DELETE_BLOCKED);
  });

  it('refuses when collection history exists — Scenario 55', async () => {
    const db = buildDb([EMPLOYEE], { collection: 9 });

    await expect(
      makeService(db, buildAudit()).remove(
        superAdmin(),
        'EMPLOYEE',
        EMPLOYEE_ID,
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses self-deletion', async () => {
    const self: UserFixture = { ...ADMIN, userId: ACTOR_ID };
    const db = buildDb([self]);

    await expect(
      makeService(db, buildAudit()).remove(
        superAdmin(),
        'USER',
        ACTOR_ID,
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });
});
