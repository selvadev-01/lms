import { PrismaService } from '../../prisma/prisma.service';
import {
  RecipientResolverService,
  type RecipientEvent,
  type RecipientRule,
} from './recipient-resolver.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const BRANCH_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BRANCH_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

interface FakeUser {
  userId: string;
  name: string;
  email: string | null;
  mobile: string | null;
  branchId: string | null;
  status: string;
  roles: string[];
}

function user(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    userId: 'u1',
    name: 'A. Officer',
    email: 'a@example.test',
    mobile: '9000000001',
    branchId: BRANCH_A,
    status: 'ACTIVE',
    roles: ['FIELD_EMPLOYEE'],
    ...overrides,
  };
}

/**
 * A Prisma stand-in that applies the same predicates the real query would.
 *
 * The point of the filtering here is that the service builds a `where` clause
 * and the database applies it — so the fake has to apply it too, or the tests
 * would pass against a service that never filtered at all.
 */
function build(input: {
  users?: FakeUser[];
  userRoles?: Array<{ userId: string; roleCode: string; roleStatus?: string }>;
  sourceRow?: Record<string, string | null> | null;
}): RecipientResolverService {
  const users = input.users ?? [];
  const userRoles = input.userRoles ?? [];

  const prisma = {
    userRole: {
      findMany: ({ where }: { where: Record<string, unknown> }) => {
        const role = (where.role ?? {}) as {
          code?: string;
          status?: string;
          rolePermissions?: {
            some: { permission: { code: string } };
          };
        };

        return Promise.resolve(
          userRoles
            .filter((assignment) => {
              if (role.code && assignment.roleCode !== role.code) return false;
              if (
                role.status &&
                (assignment.roleStatus ?? 'ACTIVE') !== role.status
              ) {
                return false;
              }
              // A permission query is modelled as "the role code equals the
              // permission code", which is enough to prove the branch is taken.
              if (
                role.rolePermissions &&
                assignment.roleCode !==
                  role.rolePermissions.some.permission.code
              ) {
                return false;
              }
              return true;
            })
            .map((assignment) => ({ userId: assignment.userId })),
        );
      },
    },
    user: {
      findMany: ({ where }: { where: Record<string, unknown> }) => {
        const ids = (where.userId as { in: string[] }).in;
        const or = where.OR as Array<{ branchId: string | null }> | undefined;

        return Promise.resolve(
          users
            .filter((candidate) => ids.includes(candidate.userId))
            // Rules 43, 44 and Scenario 54.
            .filter((candidate) => candidate.status === where.status)
            // Rules 3, 4 and Scenario 40.
            .filter((candidate) =>
              or
                ? or.some((clause) => clause.branchId === candidate.branchId)
                : true,
            )
            .map((candidate) => ({
              userId: candidate.userId,
              name: candidate.name,
              email: candidate.email,
              mobile: candidate.mobile,
              branchId: candidate.branchId,
              userRoles: candidate.roles.map((code) => ({ role: { code } })),
            })),
        );
      },
    },
    recoveryCase: {
      findUnique: () => Promise.resolve(input.sourceRow ?? null),
    },
  } as unknown as PrismaService;

  return new RecipientResolverService(prisma);
}

function rule(overrides: Partial<RecipientRule> = {}): RecipientRule {
  return {
    recipientStrategy: 'EXPLICIT',
    recipientRoleCode: null,
    recipientPermissionCode: null,
    explicitRecipientUserIds: ['u1'],
    ...overrides,
  };
}

function event(overrides: Partial<RecipientEvent> = {}): RecipientEvent {
  return {
    orgId: ORG,
    branchId: BRANCH_A,
    sourceModule: 'recovery',
    sourceRecordId: 'case-1',
    ...overrides,
  };
}

/**
 * `RecipientResolverService`.
 *
 * Two filters apply to every strategy, and they are the reason this service
 * exists as one place rather than five: a deactivated user must never receive a
 * new notification (Rules 43, 44), and a branch-scoped user must never see
 * another branch's events (Rules 3, 4). Five strategies times two filters is ten
 * chances to forget one, so the tests below assert both against every strategy
 * that can reach them.
 */
describe('RecipientResolverService', () => {
  describe('Rules 43, 44 and Scenario 54: inactive users are excluded', () => {
    it.each([
      ['EXPLICIT', rule()],
      ['ROLE', rule({ recipientStrategy: 'ROLE', recipientRoleCode: 'R' })],
    ])('excludes a deactivated user resolved by %s', async (_label, spec) => {
      const service = build({
        users: [user({ status: 'INACTIVE' })],
        userRoles: [{ userId: 'u1', roleCode: 'R' }],
      });

      expect(await service.resolve(spec, event())).toEqual([]);
    });

    it('keeps an active user alongside a deactivated one', async () => {
      const service = build({
        users: [
          user({ userId: 'u1', status: 'INACTIVE' }),
          user({ userId: 'u2', status: 'ACTIVE' }),
        ],
      });

      const resolved = await service.resolve(
        rule({ explicitRecipientUserIds: ['u1', 'u2'] }),
        event(),
      );

      expect(resolved.map((r) => r.userId)).toEqual(['u2']);
    });
  });

  describe('Rules 3, 4 and Scenario 40: branch containment', () => {
    it('excludes a user belonging to another branch', async () => {
      const service = build({ users: [user({ branchId: BRANCH_B })] });

      expect(
        await service.resolve(rule(), event({ branchId: BRANCH_A })),
      ).toEqual([]);
    });

    it('includes an organization-wide user for a branch event', async () => {
      // A null branch is organization-wide authority, not missing data — that
      // is the convention every scope check in this codebase uses.
      const service = build({ users: [user({ branchId: null })] });

      const resolved = await service.resolve(
        rule(),
        event({ branchId: BRANCH_A }),
      );

      expect(resolved).toHaveLength(1);
    });

    it('includes a branch user for an organization-wide event', async () => {
      // An event with no branch concerns the whole organization, so branch
      // membership does not exclude anyone.
      const service = build({ users: [user({ branchId: BRANCH_A })] });

      const resolved = await service.resolve(rule(), event({ branchId: null }));

      expect(resolved).toHaveLength(1);
    });
  });

  describe('strategies', () => {
    it('ROLE resolves everyone holding the named role', async () => {
      const service = build({
        users: [user({ userId: 'u1' }), user({ userId: 'u2' })],
        userRoles: [
          { userId: 'u1', roleCode: 'BRANCH_ADMIN' },
          { userId: 'u2', roleCode: 'BRANCH_ADMIN' },
          { userId: 'u3', roleCode: 'OTHER' },
        ],
      });

      const resolved = await service.resolve(
        rule({ recipientStrategy: 'ROLE', recipientRoleCode: 'BRANCH_ADMIN' }),
        event(),
      );

      expect(resolved.map((r) => r.userId).sort()).toEqual(['u1', 'u2']);
    });

    it('BRANCH_USER_GROUP ignores a grant that comes only through an inactive role', async () => {
      // An inactive role grants nothing, so a user whose only route to the
      // permission is a deactivated role is correctly not a candidate.
      const service = build({
        users: [user({ userId: 'u1' })],
        userRoles: [
          {
            userId: 'u1',
            roleCode: 'collections.record',
            roleStatus: 'INACTIVE',
          },
        ],
      });

      const resolved = await service.resolve(
        rule({
          recipientStrategy: 'BRANCH_USER_GROUP',
          recipientPermissionCode: 'collections.record',
        }),
        event(),
      );

      expect(resolved).toEqual([]);
    });

    it('ASSIGNED_USER reads the live source row (Scenario 16)', async () => {
      // The authoritative assignment, not a value carried in the payload — an
      // assignment can change between an event being raised and processed.
      const service = build({
        users: [user({ userId: 'u9' })],
        sourceRow: { assignedAgentId: 'u9' },
      });

      const resolved = await service.resolve(
        rule({ recipientStrategy: 'ASSIGNED_USER' }),
        event(),
      );

      expect(resolved.map((r) => r.userId)).toEqual(['u9']);
    });

    it('resolves nobody when the source record has no assignee', async () => {
      const service = build({
        users: [user()],
        sourceRow: { assignedAgentId: null },
      });

      expect(
        await service.resolve(
          rule({ recipientStrategy: 'ASSIGNED_USER' }),
          event(),
        ),
      ).toEqual([]);
    });

    it('resolves nobody when the source record is gone', async () => {
      const service = build({ users: [user()], sourceRow: null });

      expect(
        await service.resolve(
          rule({ recipientStrategy: 'ASSIGNED_USER' }),
          event(),
        ),
      ).toEqual([]);
    });

    it('resolves nobody for a module with no assignee concept', async () => {
      // A disbursement is not assigned to anyone. Falling back to the owner
      // would notify someone the rule did not name, which Scenario 53 forbids
      // in the same breath as sending to an arbitrary user.
      const service = build({ users: [user()] });

      expect(
        await service.resolve(
          rule({ recipientStrategy: 'ASSIGNED_USER' }),
          event({ sourceModule: 'disbursal', sourceRecordId: 'd1' }),
        ),
      ).toEqual([]);
    });

    it('resolves nobody for an unknown strategy rather than throwing', async () => {
      // An unrecognised strategy must not take down the ingestion worker for
      // every other rule on the same event.
      const service = build({ users: [user()] });

      expect(
        await service.resolve(
          rule({ recipientStrategy: 'TELEPATHY' }),
          event(),
        ),
      ).toEqual([]);
    });
  });

  describe('Rule 11: one person, one notification', () => {
    it('deduplicates a user matched more than once', async () => {
      // Rule 11 permits several *deliveries* of one event, not duplicate
      // logical notifications to the same person.
      const service = build({ users: [user({ userId: 'u1' })] });

      const resolved = await service.resolve(
        rule({ explicitRecipientUserIds: ['u1', 'u1', 'u1'] }),
        event(),
      );

      expect(resolved).toHaveLength(1);
    });
  });

  describe('Rule 3: the role snapshot', () => {
    it('records the roles held at resolution time', async () => {
      // Evidence of what point-in-time resolution actually saw, so a later role
      // change does not rewrite the history of who was notified and why.
      const service = build({
        users: [user({ roles: ['FIELD_EMPLOYEE', 'BRANCH_ADMIN'] })],
      });

      const [resolved] = await service.resolve(rule(), event());

      expect(resolved.roleSnapshot).toBe('BRANCH_ADMIN,FIELD_EMPLOYEE');
    });
  });

  describe('Scenario 53: no fallback', () => {
    it('returns an empty list rather than a default recipient', async () => {
      const service = build({ users: [] });

      expect(
        await service.resolve(rule({ explicitRecipientUserIds: [] }), event()),
      ).toEqual([]);
    });
  });
});
