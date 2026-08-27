import { AuthorizationService } from './authorization.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * AuthorizationService — the one definition of "what may this user do right now".
 *
 * Three things carry the weight.
 *
 * **The ACTIVE-role filter is in the query, not in JavaScript.** An inactive role
 * must contribute nothing (Rule 24, Scenario 31), and doing that filtering in SQL
 * means an inactive role's grants are never even fetched. The stand-in below
 * therefore asserts on the `where` it is handed: if someone moves that filter into
 * a `.filter()` after the fact, these tests fail rather than quietly passing while
 * the database does more work than it should.
 *
 * **The permission set is a union.** A user may hold several roles (Q-RBAC-33). An
 * intersection would mean adding a role could take access away, and taking the
 * first role's grants would make the result depend on row order.
 *
 * **One query.** This runs on every authenticated request, so a regression from
 * one round trip to three is a real cost. The call count is asserted.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const BRANCH_ID = '33333333-3333-3333-3333-333333333333';
const ROLE_ID = '44444444-4444-4444-4444-444444444444';

interface UserRow {
  status: string;
  branchId: string | null;
  userRoles: Array<{
    role: {
      code: string;
      status: string;
      rolePermissions: Array<{ permission: { code: string } }>;
    };
  }>;
}

/**
 * A Prisma stand-in that refuses anything it does not model.
 *
 * Deliberately strict, in keeping with branch.service.spec.ts: a query that
 * widened its `where` — dropping the org filter, say — would otherwise keep
 * passing these tests while reading another tenant's rows in production.
 */
function buildDb(row: UserRow | null) {
  const findUnique = jest.fn(
    (args: { where: Record<string, unknown>; select?: unknown }) => {
      const key = args.where.orgId_userId as
        { orgId: string; userId: string } | undefined;
      if (!key) {
        throw new Error(
          `user.findUnique must be keyed by orgId_userId, got ${JSON.stringify(args.where)}`,
        );
      }
      if (key.orgId !== ORG_ID) return Promise.resolve(null);
      if (key.userId !== USER_ID) return Promise.resolve(null);

      if (!row) return Promise.resolve(null);

      // Honour the nested ACTIVE filter the service is expected to send, so the
      // test proves the filter is in the query rather than assuming it.
      const select = args.select as
        { userRoles?: { where?: { role?: { status?: string } } } } | undefined;
      const wanted = select?.userRoles?.where?.role?.status;
      if (wanted === undefined) {
        throw new Error(
          'userRoles must be filtered by role status in the query, not afterwards',
        );
      }

      return Promise.resolve({
        ...row,
        userRoles: row.userRoles.filter((a) => a.role.status === wanted),
      });
    },
  );

  const rolePermissionFindMany = jest.fn(
    (args: { where: Record<string, unknown> }) => {
      if (args.where.orgId !== ORG_ID) {
        throw new Error('rolePermission.findMany must be tenant-filtered');
      }
      return Promise.resolve([
        { permission: { code: 'branches.view' } },
        { permission: { code: 'branches.view' } },
        { permission: { code: 'users.view' } },
      ]);
    },
  );

  return {
    findUnique,
    rolePermissionFindMany,
    client: () =>
      ({
        user: { findUnique },
        rolePermission: { findMany: rolePermissionFindMany },
      }) as unknown as PrismaService,
  };
}

function roleWith(
  code: string,
  status: string,
  permissions: string[],
): UserRow['userRoles'][number] {
  return {
    role: {
      code,
      status,
      rolePermissions: permissions.map((permission) => ({
        permission: { code: permission },
      })),
    },
  };
}

describe('AuthorizationService.resolve', () => {
  it('returns the current status, branch, roles and permissions', async () => {
    const db = buildDb({
      status: 'ACTIVE',
      branchId: BRANCH_ID,
      userRoles: [roleWith('BRANCH_ADMIN', 'ACTIVE', ['branches.view'])],
    });

    const result = await new AuthorizationService(db.client()).resolve(
      ORG_ID,
      USER_ID,
    );

    expect(result).toEqual({
      status: 'ACTIVE',
      branchId: BRANCH_ID,
      roles: ['BRANCH_ADMIN'],
      permissions: ['branches.view'],
    });
  });

  it('issues exactly one query — this runs on every request', async () => {
    const db = buildDb({
      status: 'ACTIVE',
      branchId: null,
      userRoles: [roleWith('SUPER_ADMIN', 'ACTIVE', ['users.view'])],
    });

    await new AuthorizationService(db.client()).resolve(ORG_ID, USER_ID);

    expect(db.findUnique).toHaveBeenCalledTimes(1);
    expect(db.rolePermissionFindMany).not.toHaveBeenCalled();
  });

  it('excludes an INACTIVE role, which must grant nothing', async () => {
    const db = buildDb({
      status: 'ACTIVE',
      branchId: BRANCH_ID,
      userRoles: [
        roleWith('BRANCH_ADMIN', 'ACTIVE', ['branches.view']),
        roleWith('RBAC_INACTIVE_ROLE', 'INACTIVE', ['loans.approve']),
      ],
    });

    const result = await new AuthorizationService(db.client()).resolve(
      ORG_ID,
      USER_ID,
    );

    expect(result?.permissions).toEqual(['branches.view']);
    expect(result?.roles).toEqual(['BRANCH_ADMIN']);
  });

  it('excludes a DRAFT role, which is not yet authorization', async () => {
    const db = buildDb({
      status: 'ACTIVE',
      branchId: BRANCH_ID,
      userRoles: [roleWith('RBAC_DRAFT_ROLE', 'DRAFT', ['loans.approve'])],
    });

    const result = await new AuthorizationService(db.client()).resolve(
      ORG_ID,
      USER_ID,
    );

    expect(result?.permissions).toEqual([]);
    expect(result?.roles).toEqual([]);
  });

  it('unions the permissions of several active roles, deduplicated', async () => {
    const db = buildDb({
      status: 'ACTIVE',
      branchId: BRANCH_ID,
      userRoles: [
        roleWith('BRANCH_ADMIN', 'ACTIVE', ['branches.view', 'users.view']),
        roleWith('AUDITOR', 'ACTIVE', ['users.view', 'reports.view']),
      ],
    });

    const result = await new AuthorizationService(db.client()).resolve(
      ORG_ID,
      USER_ID,
    );

    expect(result?.permissions.sort()).toEqual([
      'branches.view',
      'reports.view',
      'users.view',
    ]);
  });

  it('reports a non-ACTIVE status rather than hiding it behind an empty set', async () => {
    // The guard has to be able to tell "deactivated" from "granted nothing".
    const db = buildDb({
      status: 'INACTIVE',
      branchId: BRANCH_ID,
      userRoles: [roleWith('BRANCH_ADMIN', 'ACTIVE', ['branches.view'])],
    });

    const result = await new AuthorizationService(db.client()).resolve(
      ORG_ID,
      USER_ID,
    );

    expect(result?.status).toBe('INACTIVE');
    expect(result?.permissions).toEqual(['branches.view']);
  });

  it('returns null when the user row is gone', async () => {
    const db = buildDb(null);

    const result = await new AuthorizationService(db.client()).resolve(
      ORG_ID,
      USER_ID,
    );

    expect(result).toBeNull();
  });

  it('returns null for a user in another organization', async () => {
    const db = buildDb({
      status: 'ACTIVE',
      branchId: null,
      userRoles: [],
    });

    const result = await new AuthorizationService(db.client()).resolve(
      '99999999-9999-9999-9999-999999999999',
      USER_ID,
    );

    expect(result).toBeNull();
  });

  it('does not catch a database failure — the caller must fail closed', async () => {
    const findUnique = jest.fn().mockRejectedValue(new Error('conn refused'));
    const client = { user: { findUnique } } as unknown as PrismaService;

    // Returning an empty permission set here would read as "allowed nothing" in
    // the guard but as a successful resolution everywhere else.
    await expect(
      new AuthorizationService(client).resolve(ORG_ID, USER_ID),
    ).rejects.toThrow('conn refused');
  });

  it('reads through a supplied transaction client', async () => {
    const db = buildDb({
      status: 'ACTIVE',
      branchId: null,
      userRoles: [roleWith('SUPER_ADMIN', 'ACTIVE', ['users.view'])],
    });
    const outer = buildDb(null);

    const result = await new AuthorizationService(outer.client()).resolve(
      ORG_ID,
      USER_ID,
      db.client(),
    );

    // The transaction client answered, not the service's own.
    expect(result?.roles).toEqual(['SUPER_ADMIN']);
    expect(outer.findUnique).not.toHaveBeenCalled();
  });
});

describe('AuthorizationService.permissionsForRole', () => {
  it('deduplicates and is tenant-filtered', async () => {
    const db = buildDb(null);

    const result = await new AuthorizationService(
      db.client(),
    ).permissionsForRole(ORG_ID, ROLE_ID);

    expect(result.sort()).toEqual(['branches.view', 'users.view']);
  });
});

/**
 * The delegation subset rule (Rule 27, Scenario 37), stated as a truth table.
 *
 * Pure and static precisely so it can be tested this way: the rule is what stops
 * an administrator minting a role more privileged than themselves, and it should
 * be verifiable without a database in the picture.
 */
describe('AuthorizationService.isSubset', () => {
  it.each([
    { requested: [], held: [], expected: true },
    { requested: [], held: ['a'], expected: true },
    { requested: ['a'], held: ['a'], expected: true },
    { requested: ['a'], held: ['a', 'b'], expected: true },
    { requested: ['a', 'b'], held: ['b', 'a'], expected: true },
    { requested: ['a'], held: [], expected: false },
    { requested: ['a'], held: ['b'], expected: false },
    { requested: ['a', 'b'], held: ['a'], expected: false },
  ])(
    'requested $requested against held $held is $expected',
    ({ requested, held, expected }) => {
      expect(AuthorizationService.isSubset(requested, held)).toBe(expected);
    },
  );

  it('treats duplicates in the request as one', () => {
    expect(AuthorizationService.isSubset(['a', 'a'], ['a'])).toBe(true);
  });
});

describe('AuthorizationService.excessPermissions', () => {
  it('names what was refused, so the denial can say which permission', () => {
    expect(
      AuthorizationService.excessPermissions(
        ['users.view', 'loans.approve', 'branches.delete'],
        ['users.view'],
      ),
    ).toEqual(['loans.approve', 'branches.delete']);
  });

  it('is empty when everything requested is held', () => {
    expect(
      AuthorizationService.excessPermissions(['users.view'], ['users.view']),
    ).toEqual([]);
  });
});
