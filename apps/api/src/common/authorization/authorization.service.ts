import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import type { UserStatus } from '../../generated/prisma/client';

/**
 * A user's authorization state as the database currently holds it.
 *
 * "Currently" is the whole point. Before this service existed, roles and
 * permissions were resolved once at sign-in and stamped into the access token,
 * so revoking a permission, deactivating a role, or deactivating the user had no
 * effect until they signed in again. Module 03 Rules 24, 26, 45, 49 and 57 and
 * Scenarios 31, 32, 45, 46 and 47 all require the opposite: an authorization
 * decision must reflect the *current* permission state, and a stale client — or a
 * stale token — must not be able to reach anything.
 */
export interface EffectiveAuthorization {
  /** Only ACTIVE may proceed; every other value is a refusal. */
  status: UserStatus;
  /** `null` means organization-wide. Non-null confines to exactly that branch. */
  branchId: string | null;
  /** Codes of the user's ACTIVE roles. An inactive role contributes nothing. */
  roles: string[];
  /** Union of the permissions granted by those ACTIVE roles, deduplicated. */
  permissions: string[];
}

/** The subset of PrismaService this service needs, so a transaction can be passed. */
type UserReader = Pick<PrismaService, 'user'>;

/**
 * Resolves what a user is currently allowed to do.
 *
 * Deliberately the only place in the codebase that answers that question.
 * `JwtAuthGuard` calls it on every protected request, and `AuthService` calls it
 * at sign-in and for `GET /auth/me`, so there is one definition of "effective
 * permissions" rather than three that can drift.
 *
 * Nothing here catches its own errors. A caller that cannot resolve authorization
 * must fail closed (Rule 55, Scenario 61), and a service that swallowed a
 * database error would return an empty permission set — which reads as "this user
 * is allowed nothing" in the guard but as "this role grants nothing" anywhere
 * else. Letting it throw keeps the two distinguishable.
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The user's current status, branch and effective permissions.
   *
   * Returns `null` when no such user row exists — a user deleted while holding a
   * live session. The guard treats that as a denial rather than as an empty
   * permission set, because the two mean different things.
   *
   * One query, not three. The nested `where` on `userRoles` filters inactive
   * roles in SQL rather than in JavaScript, so an inactive role's grants are
   * never even fetched. Both relation hops ride existing primary-key prefixes —
   * `user_roles` on `(org_id, user_id)` and `role_permissions` on
   * `(org_id, role_id)` — so this needs no new index.
   *
   * @param tx pass the transaction client when the read must see uncommitted
   *   writes from the same transaction, as sign-in does.
   */
  async resolve(
    orgId: string,
    userId: string,
    tx?: UserReader,
  ): Promise<EffectiveAuthorization | null> {
    const client = tx ?? this.prisma;

    const row = await client.user.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: {
        status: true,
        branchId: true,
        userRoles: {
          where: { role: { status: 'ACTIVE' } },
          select: {
            role: {
              select: {
                code: true,
                rolePermissions: {
                  select: { permission: { select: { code: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!row) return null;

    // A user may hold several roles and two roles may grant the same permission,
    // so the effective set is the union (Q-RBAC-33) — not the first role's grants
    // and not their intersection, which would make adding a role remove access.
    const permissions = new Set<string>();
    for (const assignment of row.userRoles) {
      for (const grant of assignment.role.rolePermissions) {
        permissions.add(grant.permission.code);
      }
    }

    return {
      status: row.status,
      branchId: row.branchId,
      roles: row.userRoles.map((assignment) => assignment.role.code),
      permissions: [...permissions],
    };
  }

  /**
   * The permission codes one role grants, regardless of the role's status.
   *
   * Status-blind on purpose: this answers "what would this role give someone",
   * which is the question the delegation check asks before an assignment. Whether
   * the role is currently active is a separate check the caller makes explicitly,
   * so that an inactive role cannot be used to smuggle a grant past the subset
   * rule and then be activated later.
   */
  async permissionsForRole(orgId: string, roleId: string): Promise<string[]> {
    const grants = await this.prisma.rolePermission.findMany({
      where: { orgId, roleId },
      select: { permission: { select: { code: true } } },
    });

    return [...new Set(grants.map((grant) => grant.permission.code))];
  }

  /**
   * Whether every requested permission is one the actor already holds.
   *
   * The delegation subset rule (Rule 27, Scenario 37): an administrator cannot
   * grant what they do not have, so no one can escalate by minting a role more
   * privileged than themselves and assigning it.
   *
   * Static and pure because it is the rule itself, separable from any database
   * state — which makes it exhaustively testable without a Prisma stand-in.
   */
  static isSubset(
    requested: readonly string[],
    actorPermissions: readonly string[],
  ): boolean {
    return (
      AuthorizationService.excessPermissions(requested, actorPermissions)
        .length === 0
    );
  }

  /**
   * The requested permissions the actor does not hold.
   *
   * Returned rather than just counted so a denial can name what was refused in
   * the audit metadata — "you cannot grant this" is far more actionable when the
   * log says which permission it was.
   */
  static excessPermissions(
    requested: readonly string[],
    actorPermissions: readonly string[],
  ): string[] {
    const held = new Set(actorPermissions);
    return requested.filter((code) => !held.has(code));
  }
}
