import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { PrismaService } from '../../prisma/prisma.service';
import { RoleService } from './role.service';

/**
 * Role & Permission Management.
 *
 * What carries the weight here is the two rules that stop role management from
 * being an escalation path, because neither is visible in the happy path:
 *
 * **Delegation.** Without it, `roles.create` is silently equivalent to every
 * permission in the system — mint a role containing `loans.approve`, assign it,
 * done. The tests below check both that it refuses and that it refuses on the
 * *added* permissions only, because requiring the actor to hold everything
 * already on a role would make them unable to remove a permission from a role
 * more privileged than themselves.
 *
 * **System-role protection.** Nothing else stops an organization deactivating
 * SUPER_ADMIN and locking every administrator out permanently. Note the
 * asymmetry asserted below: a system role may *gain* permissions but never lose
 * them. The protection is against losing access, not against gaining it.
 *
 * The Prisma stand-in refuses any query it does not model, in keeping with
 * branch.service.spec.ts — a query that dropped its `orgId` filter would
 * otherwise keep passing while reading another tenant's roles.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '22222222-2222-2222-2222-222222222222';
const ACTOR_ID = '33333333-3333-3333-3333-333333333333';
const ROLE_ID = '44444444-4444-4444-4444-444444444444';
const SYSTEM_ROLE_ID = '55555555-5555-5555-5555-555555555555';
const UNKNOWN_ROLE_ID = '66666666-6666-6666-6666-666666666666';

const META: RequestMeta = {
  requestId: '77777777-7777-7777-7777-777777777777',
  ipAddress: '203.0.113.10',
  userAgent: 'jest',
};

function superAdmin(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: ACTOR_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: '88888888-8888-8888-8888-888888888888',
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: [
      'roles.view',
      'roles.create',
      'roles.update',
      'roles.delete',
      'roles.activate',
      'roles.assign_permissions',
      'users.view',
      'branches.view',
    ],
    ...overrides,
  };
}

interface RoleFixture {
  roleId: string;
  code: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  isSystem: boolean;
  permissions: string[];
  assignedUsers: number;
}

function buildDb(roles: RoleFixture[]) {
  const state = new Map(roles.map((role) => [role.roleId, { ...role }]));
  const created: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  let permissionWrites: string[][] = [];

  const row = (fixture: RoleFixture) => ({
    orgId: ORG_ID,
    roleId: fixture.roleId,
    code: fixture.code,
    name: fixture.name,
    description: fixture.description,
    status: fixture.status,
    isSystem: fixture.isSystem,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    _count: {
      rolePermissions: fixture.permissions.length,
      userRoles: fixture.assignedUsers,
    },
  });

  function assertTenant(where: Record<string, unknown>, what: string): void {
    const key = where.orgId_roleId as { orgId: string } | undefined;
    const orgId = key ? key.orgId : where.orgId;
    if (orgId !== ORG_ID) {
      throw new Error(
        `${what} must be filtered by the caller's orgId, got ${String(orgId)}`,
      );
    }
  }

  const client = {
    role: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'role.findMany');
        const wantedStatus = args.where.status as string | undefined;
        return Promise.resolve(
          [...state.values()]
            .filter((r) => !wantedStatus || r.status === wantedStatus)
            .map(row),
        );
      }),
      findUnique: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'role.findUnique');
        const key = args.where.orgId_roleId as { roleId: string };
        const found = state.get(key.roleId);
        return Promise.resolve(found ? row(found) : null);
      }),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        if (args.data.orgId !== ORG_ID) {
          throw new Error('role.create must carry the caller orgId');
        }
        created.push(args.data);
        const fixture: RoleFixture = {
          roleId: ROLE_ID,
          code: args.data.code as string,
          name: args.data.name as string,
          description: (args.data.description as string | null) ?? null,
          status: args.data.status as 'DRAFT',
          isSystem: args.data.isSystem as boolean,
          permissions: [],
          assignedUsers: 0,
        };
        state.set(fixture.roleId, fixture);
        return Promise.resolve(row(fixture));
      }),
      update: jest.fn(
        (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          assertTenant(args.where, 'role.update');
          const key = args.where.orgId_roleId as { roleId: string };
          const found = state.get(key.roleId);
          if (!found) throw new Error('role.update on a missing role');
          Object.assign(found, args.data);
          return Promise.resolve(row(found));
        },
      ),
      delete: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'role.delete');
        const key = args.where.orgId_roleId as { roleId: string };
        deleted.push(key.roleId);
        state.delete(key.roleId);
        return Promise.resolve({});
      }),
    },
    rolePermission: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'rolePermission.findMany');
        const found = state.get(args.where.roleId as string);
        return Promise.resolve(
          (found?.permissions ?? []).map((code) => ({ permission: { code } })),
        );
      }),
      deleteMany: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'rolePermission.deleteMany');
        const found = state.get(args.where.roleId as string);
        if (found) found.permissions = [];
        return Promise.resolve({ count: 0 });
      }),
      createMany: jest.fn(
        (args: { data: Array<{ roleId: string; permissionId: string }> }) => {
          permissionWrites.push(args.data.map((d) => d.permissionId));
          const target = args.data[0]?.roleId;
          const found = target ? state.get(target) : undefined;
          if (found) found.permissions = args.data.map((d) => d.permissionId);
          return Promise.resolve({ count: args.data.length });
        },
      ),
    },
    permission: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'permission.findMany');
        const codes = (args.where.code as { in: string[] }).in;
        // Every catalog code resolves to itself as its id, which keeps the
        // fixture readable; unknown codes simply do not come back.
        const known = new Set([
          'roles.view',
          'roles.create',
          'users.view',
          'branches.view',
          'loans.approve',
          'field.checkin',
        ]);
        return Promise.resolve(
          codes
            .filter((code) => known.has(code))
            .map((code) => ({ permissionId: code, code })),
        );
      }),
    },
    userRole: {
      count: jest.fn((args: { where: Record<string, unknown> }) => {
        assertTenant(args.where, 'userRole.count');
        const found = state.get(args.where.roleId as string);
        return Promise.resolve(found?.assignedUsers ?? 0);
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(client),
    ),
  };

  return {
    created,
    deleted,
    get permissionWrites() {
      return permissionWrites;
    },
    resetWrites: () => {
      permissionWrites = [];
    },
    state,
    client: () => client as unknown as PrismaService,
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

const DRAFT_ROLE: RoleFixture = {
  roleId: ROLE_ID,
  code: 'AUDITOR',
  name: 'Auditor',
  description: null,
  status: 'DRAFT',
  isSystem: false,
  permissions: ['users.view'],
  assignedUsers: 0,
};

const SYSTEM_ROLE: RoleFixture = {
  roleId: SYSTEM_ROLE_ID,
  code: 'SUPER_ADMIN',
  name: 'Super Admin',
  description: null,
  status: 'ACTIVE',
  isSystem: true,
  permissions: ['users.view', 'roles.view'],
  assignedUsers: 2,
};

describe('RoleService.create', () => {
  it('creates a role DRAFT, whatever the caller intended', async () => {
    const db = buildDb([]);
    const audit = buildAudit();

    const result = await new RoleService(db.client(), audit.service()).create(
      superAdmin(),
      { code: 'AUDITOR', name: 'Auditor', permissions: ['users.view'] },
      META,
    );

    // Scenario 27: a new role must not grant anything until Save & Activate.
    expect(result.status).toBe('DRAFT');
    expect(audit.actions()).toContain(AuditAction.ROLE_CREATED);
  });

  it('never lets a caller mint a system role', async () => {
    const db = buildDb([]);

    await new RoleService(db.client(), buildAudit().service()).create(
      superAdmin(),
      { code: 'AUDITOR', name: 'Auditor', permissions: [] },
      META,
    );

    expect(db.created[0].isSystem).toBe(false);
  });

  it('refuses a permission the actor does not hold', async () => {
    const db = buildDb([]);
    const audit = buildAudit();

    await expect(
      new RoleService(db.client(), audit.service()).create(
        superAdmin(),
        { code: 'AUDITOR', name: 'Auditor', permissions: ['loans.approve'] },
        META,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(audit.actions()).toContain(AuditAction.ROLE_PERMISSIONS_DENIED);
    // Nothing was written: the check precedes the transaction.
    expect(db.created).toHaveLength(0);
  });

  it('names the refused permissions in the audit metadata', async () => {
    const audit = buildAudit();

    await expect(
      new RoleService(buildDb([]).client(), audit.service()).create(
        superAdmin(),
        { code: 'AUDITOR', name: 'Auditor', permissions: ['loans.approve'] },
        META,
      ),
    ).rejects.toThrow(ForbiddenException);

    const denial = audit.events.find(
      (e) => e.action === AuditAction.ROLE_PERMISSIONS_DENIED,
    );
    expect(denial?.metadata?.excessPermissions).toEqual(['loans.approve']);
  });

  it('reports an unknown permission code as a conflict, not a delegation refusal', async () => {
    // Ordering matters: the other way round, a typo reads as "you cannot grant
    // this", which sends the administrator looking at their own permissions.
    await expect(
      new RoleService(buildDb([]).client(), buildAudit().service()).create(
        superAdmin(),
        { code: 'AUDITOR', name: 'Auditor', permissions: ['does.not.exist'] },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('translates a duplicate code into a conflict', async () => {
    const db = buildDb([]);
    db.client().role.create = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));

    await expect(
      new RoleService(db.client(), buildAudit().service()).create(
        superAdmin(),
        { code: 'AUDITOR', name: 'Auditor', permissions: [] },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('RoleService.setPermissions', () => {
  it('replaces the whole set', async () => {
    const db = buildDb([{ ...DRAFT_ROLE }]);
    const audit = buildAudit();

    const result = await new RoleService(
      db.client(),
      audit.service(),
    ).setPermissions(
      superAdmin(),
      ROLE_ID,
      { permissions: ['branches.view'] },
      META,
    );

    expect(result.permissions).toEqual(['branches.view']);
    expect(audit.actions()).toContain(AuditAction.ROLE_PERMISSIONS_UPDATED);
  });

  it('records both sets, so an auditor sees what changed', async () => {
    const db = buildDb([{ ...DRAFT_ROLE }]);
    const audit = buildAudit();

    await new RoleService(db.client(), audit.service()).setPermissions(
      superAdmin(),
      ROLE_ID,
      { permissions: ['branches.view'] },
      META,
    );

    const event = audit.events.find(
      (e) => e.action === AuditAction.ROLE_PERMISSIONS_UPDATED,
    );
    expect(event?.metadata?.added).toEqual(['branches.view']);
    expect(event?.metadata?.removed).toEqual(['users.view']);
  });

  it('accepts an empty set as revoke-all', async () => {
    const db = buildDb([{ ...DRAFT_ROLE }]);

    const result = await new RoleService(
      db.client(),
      buildAudit().service(),
    ).setPermissions(superAdmin(), ROLE_ID, { permissions: [] }, META);

    expect(result.permissions).toEqual([]);
  });

  it('refuses to add a permission the actor does not hold', async () => {
    const db = buildDb([{ ...DRAFT_ROLE }]);

    await expect(
      new RoleService(db.client(), buildAudit().service()).setPermissions(
        superAdmin(),
        ROLE_ID,
        { permissions: ['users.view', 'loans.approve'] },
        META,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows removing a permission the actor does not hold', async () => {
    // Delegation bounds what you can *grant*. An administrator cleaning up an
    // over-privileged role must not be blocked by the very permission they are
    // taking away.
    const db = buildDb([
      { ...DRAFT_ROLE, permissions: ['users.view', 'loans.approve'] },
    ]);

    const result = await new RoleService(
      db.client(),
      buildAudit().service(),
    ).setPermissions(
      superAdmin(),
      ROLE_ID,
      { permissions: ['users.view'] },
      META,
    );

    expect(result.permissions).toEqual(['users.view']);
  });

  it('lets a system role gain a permission', async () => {
    const db = buildDb([{ ...SYSTEM_ROLE }]);

    const result = await new RoleService(
      db.client(),
      buildAudit().service(),
    ).setPermissions(
      superAdmin(),
      SYSTEM_ROLE_ID,
      { permissions: ['users.view', 'roles.view', 'branches.view'] },
      META,
    );

    expect(result.permissions).toContain('branches.view');
  });

  it('refuses to take a permission away from a system role', async () => {
    const db = buildDb([{ ...SYSTEM_ROLE }]);
    const audit = buildAudit();

    await expect(
      new RoleService(db.client(), audit.service()).setPermissions(
        superAdmin(),
        SYSTEM_ROLE_ID,
        { permissions: ['users.view'] },
        META,
      ),
    ).rejects.toThrow(ConflictException);

    expect(audit.actions()).toContain(AuditAction.ROLE_SYSTEM_PROTECTED);
  });
});

describe('RoleService.setStatus', () => {
  it('activates a DRAFT role — Save & Activate', async () => {
    const db = buildDb([{ ...DRAFT_ROLE }]);
    const audit = buildAudit();

    const result = await new RoleService(
      db.client(),
      audit.service(),
    ).setStatus(superAdmin(), ROLE_ID, { status: 'ACTIVE' }, META);

    expect(result.status).toBe('ACTIVE');
    expect(audit.actions()).toContain(AuditAction.ROLE_ACTIVATED);
  });

  it('refuses to activate a role that grants nothing', async () => {
    // An ACTIVE role with no permissions is indistinguishable from a
    // misconfiguration, and the source sequence assigns permissions first.
    const db = buildDb([{ ...DRAFT_ROLE, permissions: [] }]);

    await expect(
      new RoleService(db.client(), buildAudit().service()).setStatus(
        superAdmin(),
        ROLE_ID,
        { status: 'ACTIVE' },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses a no-op status change', async () => {
    const db = buildDb([{ ...DRAFT_ROLE, status: 'ACTIVE' }]);

    await expect(
      new RoleService(db.client(), buildAudit().service()).setStatus(
        superAdmin(),
        ROLE_ID,
        { status: 'ACTIVE' },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses to deactivate a system role', async () => {
    const db = buildDb([{ ...SYSTEM_ROLE }]);
    const audit = buildAudit();

    await expect(
      new RoleService(db.client(), audit.service()).setStatus(
        superAdmin(),
        SYSTEM_ROLE_ID,
        { status: 'INACTIVE' },
        META,
      ),
    ).rejects.toThrow(ConflictException);

    expect(audit.actions()).toContain(AuditAction.ROLE_SYSTEM_PROTECTED);
    expect(db.state.get(SYSTEM_ROLE_ID)?.status).toBe('ACTIVE');
  });
});

describe('RoleService.update', () => {
  it('renames an ordinary role', async () => {
    const db = buildDb([{ ...DRAFT_ROLE }]);

    const result = await new RoleService(
      db.client(),
      buildAudit().service(),
    ).update(superAdmin(), ROLE_ID, { name: 'Internal Auditor' }, META);

    expect(result.name).toBe('Internal Auditor');
  });

  it('refuses to rename a system role', async () => {
    const db = buildDb([{ ...SYSTEM_ROLE }]);

    await expect(
      new RoleService(db.client(), buildAudit().service()).update(
        superAdmin(),
        SYSTEM_ROLE_ID,
        { name: 'Hijacked' },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('RoleService.remove', () => {
  it('deletes a role nobody holds', async () => {
    const db = buildDb([{ ...DRAFT_ROLE }]);
    const audit = buildAudit();

    const result = await new RoleService(db.client(), audit.service()).remove(
      superAdmin(),
      ROLE_ID,
      META,
    );

    expect(result).toEqual({ roleId: ROLE_ID, deleted: true });
    expect(db.deleted).toEqual([ROLE_ID]);
    expect(audit.actions()).toContain(AuditAction.ROLE_DELETED);
  });

  it('refuses while users hold it, and says what is in the way', async () => {
    const db = buildDb([{ ...DRAFT_ROLE, assignedUsers: 4 }]);
    const audit = buildAudit();

    await expect(
      new RoleService(db.client(), audit.service()).remove(
        superAdmin(),
        ROLE_ID,
        META,
      ),
    ).rejects.toMatchObject({
      response: {
        blockedBy: [{ entity: 'userRole', label: 'Assigned users', count: 4 }],
      },
    });

    expect(db.deleted).toHaveLength(0);
    // Recorded outside the rolled-back transaction, so the refusal survives.
    expect(audit.actions()).toContain(AuditAction.ROLE_DELETE_BLOCKED);
  });

  it('refuses to delete a system role', async () => {
    const db = buildDb([{ ...SYSTEM_ROLE, assignedUsers: 0 }]);

    await expect(
      new RoleService(db.client(), buildAudit().service()).remove(
        superAdmin(),
        SYSTEM_ROLE_ID,
        META,
      ),
    ).rejects.toThrow(ConflictException);

    expect(db.deleted).toHaveLength(0);
  });
});

describe('RoleService scope', () => {
  it('refuses a role id that does not exist', async () => {
    const db = buildDb([{ ...DRAFT_ROLE }]);
    const audit = buildAudit();

    await expect(
      new RoleService(db.client(), audit.service()).getById(
        superAdmin(),
        UNKNOWN_ROLE_ID,
        META,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(audit.actions()).toContain(AuditAction.ROLE_SCOPE_DENIED);
  });

  it('uses one opaque message, so ids cannot be enumerated', async () => {
    const db = buildDb([{ ...DRAFT_ROLE }]);

    await expect(
      new RoleService(db.client(), buildAudit().service()).getById(
        superAdmin(),
        UNKNOWN_ROLE_ID,
        META,
      ),
    ).rejects.toThrow('Role not found');
  });

  it('reads only within the caller tenant', async () => {
    const db = buildDb([{ ...DRAFT_ROLE }]);

    // The stand-in throws on a mismatched orgId, so a widened query fails here
    // rather than silently returning another tenant's role.
    await expect(
      new RoleService(db.client(), buildAudit().service()).getById(
        superAdmin({ orgId: OTHER_ORG_ID }),
        ROLE_ID,
        META,
      ),
    ).rejects.toThrow();
  });

  it('lists only ACTIVE roles when asked', async () => {
    const db = buildDb([{ ...DRAFT_ROLE }, { ...SYSTEM_ROLE }]);

    const result = await new RoleService(
      db.client(),
      buildAudit().service(),
    ).list(superAdmin(), { activeOnly: true }, META);

    expect(result.map((r) => r.code)).toEqual(['SUPER_ADMIN']);
  });

  it('reports permission and holder counts for the list', async () => {
    const db = buildDb([{ ...SYSTEM_ROLE }]);

    const [role] = await new RoleService(
      db.client(),
      buildAudit().service(),
    ).list(superAdmin(), {}, META);

    expect(role.permissionCount).toBe(2);
    expect(role.assignedUserCount).toBe(2);
    expect(role.isSystem).toBe(true);
  });
});
