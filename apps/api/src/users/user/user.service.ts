import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  UserAccountStatus,
  UserDeleteBlocker,
  UserDetail,
  UserSummary,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import { PasswordService } from '../../auth/password.service';
import { PasswordPolicyService } from '../../auth/password-policy.service';
import { SessionService } from '../../auth/session.service';
import { SESSION_REVOKE_REASON } from '../../auth/session-state';
import type { AuthContext } from '../../common/auth-context';
import { AuthorizationService } from '../../common/authorization/authorization.service';
import { BranchService } from '../../organizations/branch.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignEmployeeDto } from './dto/assign-employee.dto';
import { AssignRolesDto } from '../rbac/dto/assign-roles.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { SetUserStatusDto } from './dto/set-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  USER_DEPENDENCIES,
  type UserDependencyEntity,
  summarizeUserBlockers,
} from './user-dependencies';

export const USERS_VIEW_PERMISSION = 'users.view';
export const USERS_CREATE_PERMISSION = 'users.create';
export const USERS_UPDATE_PERMISSION = 'users.update';
export const USERS_DELETE_PERMISSION = 'users.delete';
export const USERS_ACTIVATE_PERMISSION = 'users.activate';
export const USERS_ASSIGN_ROLE_PERMISSION = 'users.assign_role';

export const EMPLOYEES_VIEW_PERMISSION = 'employees.view';
export const EMPLOYEES_CREATE_PERMISSION = 'employees.create';
export const EMPLOYEES_UPDATE_PERMISSION = 'employees.update';
export const EMPLOYEES_ASSIGN_PERMISSION = 'employees.assign';
export const EMPLOYEES_ACTIVATE_PERMISSION = 'employees.activate';
export const EMPLOYEES_DELETE_PERMISSION = 'employees.delete';

/**
 * One message for every way a user can be unreachable.
 *
 * Non-existent, another tenant's, another branch's, and "an administrator seen
 * through the employees surface" all produce this. Distinguishing them would let
 * a Branch Admin enumerate the organization's users by watching which ids answer
 * differently. The real cause goes to the audit log.
 */
const NOT_REACHABLE = 'User not found';

/**
 * Which surface a request came through.
 *
 * Users and employees are one table distinguished by `employeeCode`, and this is
 * what keeps the two API surfaces from leaking into each other. It is applied to
 * single-record reads as well as lists — a filter applied only in `list` would
 * leave `GET /employees/:userId` able to reach an administrator's record for a
 * caller holding only `employees.view`, which is the easiest bug to write in
 * this module.
 */
export type UserSurface = 'USER' | 'EMPLOYEE';

/**
 * The delete-guard's view of a Prisma client: one countable delegate per entry in
 * `USER_DEPENDENCIES`, and nothing else.
 *
 * Keyed off the dependency list itself, so adding a blocking relation there
 * without a matching Prisma model becomes a compile error rather than a runtime
 * "cannot read property count of undefined".
 */
type CountableDelegates = Record<
  UserDependencyEntity,
  { count: (args: { where: Record<string, unknown> }) => Promise<number> }
>;

type UserRow = {
  orgId: string;
  userId: string;
  branchId: string | null;
  employeeCode: string | null;
  name: string;
  email: string | null;
  mobile: string | null;
  status: UserAccountStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  branch?: { name: string } | null;
  userRoles?: Array<{ role: { code: string } }>;
};

function toSummary(row: UserRow): UserSummary {
  return {
    userId: row.userId,
    name: row.name,
    mobile: row.mobile ?? undefined,
    email: row.email ?? undefined,
    employeeCode: row.employeeCode ?? undefined,
    branchId: row.branchId ?? undefined,
    branchName: row.branch?.name ?? undefined,
    status: row.status,
    roles: (row.userRoles ?? []).map((assignment) => assignment.role.code),
  };
}

function toDetail(row: UserRow): UserDetail {
  return {
    ...toSummary(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString(),
  };
}

/** What every read needs: the branch name and the role codes. */
const ROW_INCLUDE = {
  branch: { select: { name: true } },
  userRoles: { select: { role: { select: { code: true } } } },
} as const;

/**
 * User and Employee management.
 *
 * Both surfaces, one service, because they are one table: an employee is a user
 * carrying an `employeeCode`. What differs is the permission family the
 * controller applies and the `surface` passed in here, which decides whether a
 * record is visible at all.
 *
 * The governing idiom is Module 02's: the permission grants the action, the
 * service confines the reach. `PermissionsGuard` has established that the caller
 * may view users; only this service knows *which* users, because that depends on
 * the caller's own branch scope.
 *
 * Three guards run on the lifecycle operations, and each closes a way an
 * organization could lose control of itself:
 *
 * - **Self-deactivation** is refused, so an administrator cannot lock themselves
 *   out with one click.
 * - **The last active holder of a system role** cannot be deactivated or deleted,
 *   so the tenant cannot be left with no one able to administer it.
 * - **Delegation** bounds *self*-assignment: nobody may grant themselves a
 *   permission they do not already hold (Rule 27, Scenario 37). Scoped to self
 *   rather than to every assignment — see `assertRolesAssignable` for why the
 *   broader reading makes operational roles unassignable.
 */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branches: BranchService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly passwordPolicy: PasswordPolicyService,
  ) {}

  /** Scenarios 1, 4, 14, 20, 22, 53. */
  async list(
    actor: AuthContext,
    surface: UserSurface,
    query: ListUsersDto,
    meta: RequestMeta,
  ): Promise<UserSummary[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        orgId: actor.orgId,
        // The confinement. A branch-scoped caller sees their own branch only,
        // and no query parameter can widen it (Scenarios 22, 42).
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
        // The surface split. `employeeCode` is the discriminator.
        employeeCode: surface === 'EMPLOYEE' ? { not: null } : null,
        ...(query.activeOnly ? { status: 'ACTIVE' } : {}),
        ...(query.roleCode
          ? { userRoles: { some: { role: { code: query.roleCode } } } }
          : {}),
      },
      orderBy: [{ name: 'asc' }],
      include: ROW_INCLUDE,
    });

    await this.audit.record({
      orgId: actor.orgId,
      action:
        surface === 'EMPLOYEE'
          ? AuditAction.EMPLOYEE_LISTED
          : AuditAction.USER_LISTED,
      entityType: surface,
      entityId: null,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { count: rows.length, activeOnly: query.activeOnly ?? false },
    });

    return rows.map(toSummary);
  }

  /** Scenarios 5, 22, 23. */
  async getById(
    actor: AuthContext,
    surface: UserSurface,
    userId: string,
    meta: RequestMeta,
  ): Promise<UserDetail> {
    const row = await this.findInScope(actor, surface, userId, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action:
        surface === 'EMPLOYEE'
          ? AuditAction.EMPLOYEE_VIEWED
          : AuditAction.USER_VIEWED,
      entityType: surface,
      entityId: userId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toDetail(row);
  }

  /**
   * Create an administrator or an employee — Scenarios 2, 3, 4, 15, 16, 48, 58.
   *
   * Organization is never taken from the request, so Scenario 4 holds by
   * construction. The branch, if named, must be one the actor can reach and must
   * be operational (Scenario 16) — checked through `BranchService`, which already
   * owns that rule, rather than reimplemented here.
   */
  async create(
    actor: AuthContext,
    surface: UserSurface,
    dto: CreateUserDto | CreateEmployeeDto,
    meta: RequestMeta,
  ): Promise<UserDetail> {
    const employeeCode =
      'employeeCode' in dto ? (dto.employeeCode ?? null) : null;
    const branchId = dto.branchId ?? null;

    if (branchId) this.assertBranchInScope(actor, branchId);

    const password = 'password' in dto ? dto.password : undefined;

    // An account with no password cannot sign in, so calling it ACTIVE would
    // advertise access that does not exist. PENDING is the honest state — but
    // only while there is no password. Supplying one is precisely what makes
    // ACTIVE truthful, so the refusal is now about the credential rather than
    // about the status.
    if (dto.status === 'ACTIVE' && !password) {
      await this.recordRejection(actor, meta, null, surface, 'NO_CREDENTIAL');
      throw new ConflictException(
        'A new account cannot be created ACTIVE without a password. Set one, or create it as PENDING.',
      );
    }

    await this.assertRolesAssignable(actor, dto.roleIds, meta, null);
    await this.assertIdentifiersFree(actor, dto, employeeCode, meta, surface);

    /**
     * Hashed before the transaction opens, and only after the policy passes.
     *
     * argon2 costs ~19 MiB and a few hundred milliseconds of deliberate CPU;
     * holding a database transaction across it wastes a connection for no
     * reason. `assertNotReused` is deliberately not called — history is
     * per-user and there is no user yet.
     */
    let passwordHash: string | null = null;
    if (password) {
      this.passwordPolicy.assertMeetsPolicy(password, [
        dto.name,
        dto.mobile,
        actor.orgCode,
      ]);
      passwordHash = await this.passwords.hash(password);
    }

    /**
     * A password the administrator chose is known to two people. The account is
     * usable immediately — that is the point — but reaches nothing except
     * Change Password until it is replaced.
     */
    const mustChangePassword = passwordHash !== null;
    const status = passwordHash ? 'ACTIVE' : dto.status;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (branchId) {
          await this.branches.assertBranchOperational(
            tx,
            actor.orgId,
            branchId,
          );
        }

        const row = await tx.user.create({
          data: {
            orgId: actor.orgId,
            name: dto.name,
            mobile: dto.mobile,
            email: dto.email ?? null,
            branchId,
            employeeCode,
            status,
            // Rule 48 still holds: the hash was produced by PasswordService and
            // the policy by PasswordPolicyService. Null when no password was
            // supplied, which is what PENDING records.
            passwordHash,
            passwordChangedAt: passwordHash ? new Date() : null,
            mustChangePassword,
          },
        });

        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({
            orgId: actor.orgId,
            userId: row.userId,
            roleId,
          })),
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action:
              surface === 'EMPLOYEE'
                ? AuditAction.EMPLOYEE_CREATED
                : AuditAction.USER_CREATED,
            entityType: surface,
            entityId: row.userId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            // Enumerated rather than spread. A `{...row}` would carry
            // `passwordHash` into the audit input, and while `sanitizeMetadata`
            // strips it, relying on that would also silently drop legitimate
            // fields whose names happen to match — `passwordChangedAt` among them.
            newData: {
              name: row.name,
              mobile: row.mobile,
              email: row.email,
              branchId: row.branchId,
              employeeCode: row.employeeCode,
              status: row.status,
              roleIds: dto.roleIds,
              // Whether a credential was set, never what it was. That an
              // administrator chose someone else's first password is exactly
              // the kind of thing an audit trail exists to record.
              passwordSet: row.passwordHash !== null,
              mustChangePassword: row.mustChangePassword,
            },
          },
          tx,
        );

        return row;
      });

      return this.getRow(actor.orgId, created.userId);
    } catch (error) {
      await this.recordPersistenceFailure(actor, meta, error, 'create', null);
      throw this.translateUniqueViolation(error, dto.mobile);
    }
  }

  /**
   * Edit a name or email — Scenarios 5, 6, 7.
   *
   * Nothing downstream moves. Historical collections, assignments and audit rows
   * reference the user id, not the name, so Scenario 7 holds because this method
   * does not go near them.
   */
  async update(
    actor: AuthContext,
    surface: UserSurface,
    userId: string,
    dto: UpdateUserDto,
    meta: RequestMeta,
  ): Promise<UserDetail> {
    const before = await this.findInScope(actor, surface, userId, meta);

    try {
      await this.prisma.$transaction(async (tx) => {
        const row = await tx.user.update({
          where: { orgId_userId: { orgId: actor.orgId, userId } },
          data: { name: dto.name, email: dto.email ?? null },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action:
              surface === 'EMPLOYEE'
                ? AuditAction.EMPLOYEE_UPDATED
                : AuditAction.USER_UPDATED,
            entityType: surface,
            entityId: userId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: { name: before.name, email: before.email },
            newData: { name: row.name, email: row.email },
          },
          tx,
        );
      });

      return this.getRow(actor.orgId, userId);
    } catch (error) {
      await this.recordPersistenceFailure(actor, meta, error, 'update', userId);
      throw error;
    }
  }

  /**
   * Move an employee to another branch — Scenarios 17, 18, 19, 50, 60.
   *
   * Historical records keep the branch they were recorded under (Rule 50): this
   * writes one column, which is why the audit entry has to carry the old value
   * for the change to be reconstructable.
   */
  async assign(
    actor: AuthContext,
    userId: string,
    dto: AssignEmployeeDto,
    meta: RequestMeta,
  ): Promise<UserDetail> {
    const before = await this.findInScope(actor, 'EMPLOYEE', userId, meta);

    // A branch-confined actor cannot move anyone out of their own branch —
    // otherwise "assign" would be a way to push a record beyond their reach and
    // then be unable to get it back (Scenario 19).
    this.assertBranchInScope(actor, dto.branchId);

    if (before.status !== 'ACTIVE') {
      await this.recordAssignRejection(
        actor,
        meta,
        userId,
        'INACTIVE_EMPLOYEE',
      );
      throw new ConflictException(
        'This employee is inactive and cannot receive a new assignment',
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Scenario 16, applied to assignment as well as creation.
        await this.branches.assertBranchOperational(
          tx,
          actor.orgId,
          dto.branchId,
        );

        const row = await tx.user.update({
          where: { orgId_userId: { orgId: actor.orgId, userId } },
          data: { branchId: dto.branchId },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.EMPLOYEE_ASSIGNED,
            entityType: 'EMPLOYEE',
            entityId: userId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: { branchId: before.branchId },
            newData: { branchId: row.branchId },
            metadata: { reason: dto.reason ?? null },
          },
          tx,
        );
      });

      return this.getRow(actor.orgId, userId);
    } catch (error) {
      await this.recordPersistenceFailure(actor, meta, error, 'assign', userId);
      throw error;
    }
  }

  /**
   * Activate or deactivate — Scenarios 8, 10, 11, 12, 13, 20, 21, 49, 53.
   *
   * Deactivation revokes the user's sessions, which with the live status check in
   * `JwtAuthGuard` makes Scenario 45 true twice over: the session rows are gone,
   * and even a token whose session somehow survived would be refused on its next
   * request. Belt and braces, deliberately — this is the boundary the whole
   * module exists to enforce.
   *
   * Historical records are untouched (Scenarios 11, 21). This writes one column.
   */
  async setStatus(
    actor: AuthContext,
    surface: UserSurface,
    userId: string,
    dto: SetUserStatusDto,
    meta: RequestMeta,
  ): Promise<UserDetail> {
    const before = await this.findInScope(actor, surface, userId, meta);

    if (before.status === dto.status) {
      throw new ConflictException(`This account is already ${dto.status}`);
    }

    if (dto.status !== 'ACTIVE') {
      await this.assertNotSelf(actor, userId, meta, 'deactivate');
      await this.assertNotLastSystemAdmin(actor, userId, meta, 'deactivate');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const row = await tx.user.update({
          where: { orgId_userId: { orgId: actor.orgId, userId } },
          data: { status: dto.status },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: this.statusAction(surface, dto.status === 'ACTIVE'),
            entityType: surface,
            entityId: userId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: { status: before.status },
            newData: { status: row.status },
            metadata: { reason: dto.reason ?? null },
          },
          tx,
        );
      });

      if (dto.status !== 'ACTIVE') {
        // Outside the transaction: a session-revocation failure must not undo a
        // committed deactivation. The live status check already refuses the
        // account, so a surviving session row is inert rather than dangerous.
        await this.sessions
          .revokeAllForUser(
            actor.orgId,
            userId,
            SESSION_REVOKE_REASON.ACCOUNT_INELIGIBLE,
          )
          .catch((error: unknown) => {
            this.logger.error(
              `Deactivated ${userId} but failed to revoke sessions: ${
                error instanceof Error ? error.message : 'unknown error'
              }`,
            );
          });
      }

      return this.getRow(actor.orgId, userId);
    } catch (error) {
      await this.recordPersistenceFailure(
        actor,
        meta,
        error,
        'set_status',
        userId,
      );
      throw error;
    }
  }

  /**
   * Replace a user's roles — Scenarios 34, 35, 36, 37, 42.
   *
   * Historical records keep the role they were made under (Scenario 36): roles
   * are not stamped onto transactions, so changing them here affects future
   * authorization only. And because permissions are re-resolved per request, the
   * change takes effect on the user's very next call rather than at their next
   * sign-in.
   */
  async assignRoles(
    actor: AuthContext,
    userId: string,
    dto: AssignRolesDto,
    meta: RequestMeta,
  ): Promise<UserDetail> {
    const before = await this.findInScope(actor, 'USER', userId, meta);
    const previous = (before.userRoles ?? []).map((a) => a.role.code);

    await this.assertRolesAssignable(actor, dto.roleIds, meta, userId);

    // Stripping someone of a system role is the same lockout risk as
    // deactivating them, so it gets the same guard.
    await this.assertNotLastSystemAdminAfterRoles(
      actor,
      userId,
      dto.roleIds,
      meta,
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.userRole.deleteMany({ where: { orgId: actor.orgId, userId } });
        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({
            orgId: actor.orgId,
            userId,
            roleId,
          })),
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.USER_ROLES_ASSIGNED,
            entityType: 'USER',
            entityId: userId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: { roles: previous },
            newData: { roleIds: dto.roleIds },
          },
          tx,
        );
      });

      return this.getRow(actor.orgId, userId);
    } catch (error) {
      await this.recordPersistenceFailure(
        actor,
        meta,
        error,
        'assign_roles',
        userId,
      );
      throw error;
    }
  }

  /**
   * Physically delete a user — Scenarios 54, 55.
   *
   * Almost always refused, and that is the design. `AuditLog.actorUserId`
   * references `users`, so anyone who has ever signed in is permanently
   * undeletable (Rules 14, 43) and deactivation is the real lifecycle. This path
   * exists for the account that was provisioned and never used.
   */
  async remove(
    actor: AuthContext,
    surface: UserSurface,
    userId: string,
    meta: RequestMeta,
  ): Promise<{ userId: string; deleted: boolean }> {
    const row = await this.findInScope(actor, surface, userId, meta);
    await this.assertNotSelf(actor, userId, meta, 'delete');
    await this.assertNotLastSystemAdmin(actor, userId, meta, 'delete');

    let blockers: UserDeleteBlocker[] = [];

    try {
      await this.prisma.$transaction(async (tx) => {
        blockers = summarizeUserBlockers(
          await this.countDependencies(tx, actor.orgId, userId),
        );

        if (blockers.length > 0) {
          throw new ConflictException({
            message:
              'This user cannot be deleted because records reference them. Deactivate the account instead.',
            blockedBy: blockers,
          });
        }

        await tx.user.delete({
          where: { orgId_userId: { orgId: actor.orgId, userId } },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.USER_DELETED,
            entityType: surface,
            entityId: userId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: {
              name: row.name,
              mobile: row.mobile,
              employeeCode: row.employeeCode,
              status: row.status,
            },
          },
          tx,
        );
      });

      return { userId, deleted: true };
    } catch (error) {
      if (error instanceof ConflictException) {
        // Re-recorded outside the rolled-back transaction: the refusal is the
        // outcome worth keeping (Scenario 54).
        await this.audit
          .record({
            orgId: actor.orgId,
            action: AuditAction.USER_DELETE_BLOCKED,
            entityType: surface,
            entityId: userId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: { blockedBy: blockers },
          })
          .catch(() => {});

        throw error;
      }

      await this.recordPersistenceFailure(actor, meta, error, 'delete', userId);
      throw error;
    }
  }

  /**
   * Counts every non-cascading reference to the user.
   *
   * Each dependency names its own foreign-key column, because unlike branches
   * they are not uniformly `userId` — see `user-dependencies.ts`.
   */
  private async countDependencies(
    // Typed as the delegates it actually indexes rather than as PrismaService,
    // because a transaction client is a PrismaClient without the lifecycle hooks
    // — assignable here, but not to the service type.
    tx: CountableDelegates,
    orgId: string,
    userId: string,
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};

    for (const dependency of USER_DEPENDENCIES) {
      // `field` may name several columns: a model can reference a user more
      // than once (Module 12's handover has an agent and a receiver). Counting
      // one column would miss a user who appears only in the other.
      // The cast is on the narrow side: `field` is a const-tuple union, so
      // `Array.isArray` narrows to the intersection rather than to the tuple.
      const declared: string | readonly string[] = dependency.field;
      const columns: readonly string[] =
        typeof declared === 'string' ? [declared] : declared;

      counts[dependency.entity] = await tx[dependency.entity].count({
        where:
          columns.length === 1
            ? { orgId, [columns[0]]: userId }
            : { orgId, OR: columns.map((column) => ({ [column]: userId })) },
      });
    }

    return counts;
  }

  /**
   * Resolves a user the caller is entitled to reach, or refuses.
   *
   * Four ways to be unreachable, one message. The surface check is the subtle
   * one: without it, a caller holding `employees.view` alone could read an
   * administrator's record through `GET /employees/:userId`, because both live in
   * the same table.
   */
  private async findInScope(
    actor: AuthContext,
    surface: UserSurface,
    userId: string,
    meta: RequestMeta,
  ): Promise<UserRow> {
    const row = await this.prisma.user.findUnique({
      where: { orgId_userId: { orgId: actor.orgId, userId } },
      include: ROW_INCLUDE,
    });

    if (!row) {
      await this.recordScopeDenial(
        actor,
        surface,
        userId,
        meta,
        'NOT_FOUND_OR_OTHER_ORG',
      );
      throw new NotFoundException(NOT_REACHABLE);
    }

    const isEmployee = row.employeeCode !== null;
    if (isEmployee !== (surface === 'EMPLOYEE')) {
      await this.recordScopeDenial(
        actor,
        surface,
        userId,
        meta,
        'WRONG_SURFACE',
      );
      throw new NotFoundException(NOT_REACHABLE);
    }

    // A branch-confined actor reaches only their own branch — including being
    // refused an organization-wide administrator, whose null branchId can never
    // equal theirs.
    if (actor.branchId !== null && row.branchId !== actor.branchId) {
      await this.recordScopeDenial(
        actor,
        surface,
        userId,
        meta,
        'BRANCH_SCOPE',
      );
      throw new ForbiddenException(NOT_REACHABLE);
    }

    return row;
  }

  /** Re-reads a row for the response, after a write has changed it. */
  private async getRow(orgId: string, userId: string): Promise<UserDetail> {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { orgId_userId: { orgId, userId } },
      include: ROW_INCLUDE,
    });

    return toDetail(row);
  }

  /**
   * Refuses a branch the actor cannot themselves reach.
   *
   * Purely about the actor's scope; whether the branch is operational is
   * `BranchService`'s question and is asked separately inside the transaction.
   */
  private assertBranchInScope(actor: AuthContext, branchId: string): void {
    if (actor.branchId !== null && actor.branchId !== branchId) {
      throw new ForbiddenException(
        'You cannot assign a user to a branch outside your own',
      );
    }
  }

  /**
   * Every role must exist, be ACTIVE, and — when the target is the actor
   * themselves — grant nothing the actor does not already hold.
   *
   * The ACTIVE check is Scenario 35: an inactive role grants nothing, so
   * assigning one as live authorization is a request that cannot mean what it
   * says.
   *
   * The delegation check (Rule 27, Scenario 37) applies to **self-assignment
   * only**, and the reason is worth stating because the broader reading is the
   * obvious one and it is wrong. Rule 27 exists to stop *escalation* — an
   * administrator handing themselves powers they were not given. Applied to
   * every assignment it forbids something else entirely: `FIELD_EMPLOYEE` grants
   * `field.checkin`, which administrators deliberately never hold (only field
   * staff check in, per the GPS module), so a blanket subset rule would make it
   * impossible for anyone to ever create a Field Employee. Operational roles are
   * routinely more capable than their administrators in specific ways; that is
   * what separation of duties looks like, not a privilege leak.
   *
   * What still bounds assigning a *privileged* role to someone else is the
   * `users.assign_role` permission plus the fact that the role had to be created
   * in the first place — and `RoleService` applies the subset rule there, where
   * minting a role above yourself is the actual escalation.
   */
  private async assertRolesAssignable(
    actor: AuthContext,
    roleIds: readonly string[],
    meta: RequestMeta,
    userId: string | null,
  ): Promise<void> {
    const roles = await this.prisma.role.findMany({
      where: { orgId: actor.orgId, roleId: { in: [...roleIds] } },
      select: {
        roleId: true,
        code: true,
        status: true,
        rolePermissions: { select: { permission: { select: { code: true } } } },
      },
    });

    if (roles.length !== new Set(roleIds).size) {
      await this.recordRoleDenial(actor, meta, userId, 'UNKNOWN_ROLE');
      throw new NotFoundException('Role not found');
    }

    const inactive = roles.filter((role) => role.status !== 'ACTIVE');
    if (inactive.length > 0) {
      await this.recordRoleDenial(actor, meta, userId, 'INACTIVE_ROLE');
      throw new ConflictException(
        `This role is not active and cannot be assigned: ${inactive
          .map((role) => role.code)
          .join(', ')}`,
      );
    }

    // Self-assignment only: see the note above for why a blanket rule here would
    // make every operational role unassignable.
    if (userId !== actor.userId) return;

    const granted = [
      ...new Set(
        roles.flatMap((role) =>
          role.rolePermissions.map((grant) => grant.permission.code),
        ),
      ),
    ];
    const excess = AuthorizationService.excessPermissions(
      granted,
      actor.permissions,
    );

    if (excess.length > 0) {
      await this.recordRoleDenial(
        actor,
        meta,
        userId,
        'SELF_ESCALATION',
        excess,
      );
      throw new ForbiddenException(
        'You cannot grant yourself permissions you do not already hold',
      );
    }
  }

  /** Scenario 3 — a duplicate identifier is refused before the write. */
  private async assertIdentifiersFree(
    actor: AuthContext,
    dto: CreateUserDto,
    employeeCode: string | null,
    meta: RequestMeta,
    surface: UserSurface,
  ): Promise<void> {
    const clash = await this.prisma.user.findFirst({
      where: {
        orgId: actor.orgId,
        OR: [
          { mobile: dto.mobile },
          ...(dto.email ? [{ email: dto.email }] : []),
          ...(employeeCode ? [{ employeeCode }] : []),
        ],
      },
      select: { mobile: true, email: true, employeeCode: true },
    });

    if (!clash) return;

    const field =
      clash.mobile === dto.mobile
        ? 'Mobile Number'
        : clash.employeeCode === employeeCode && employeeCode !== null
          ? 'Employee ID'
          : 'Email';

    await this.recordRejection(
      actor,
      meta,
      null,
      surface,
      `DUPLICATE_${field}`,
    );
    throw new ConflictException(`This ${field} is already in use`);
  }

  /**
   * Refuses an administrator acting destructively on their own account.
   *
   * One click should not be able to lock someone out of the system they are
   * administering, and unlike most refusals here this one is explicit rather than
   * opaque — the caller obviously knows who they are.
   */
  private async assertNotSelf(
    actor: AuthContext,
    userId: string,
    meta: RequestMeta,
    operation: string,
  ): Promise<void> {
    if (actor.userId !== userId) return;

    await this.recordLockoutPrevented(actor, meta, userId, `SELF_${operation}`);
    throw new ConflictException(
      operation === 'delete'
        ? 'You cannot delete your own account'
        : 'You cannot deactivate your own account',
    );
  }

  /**
   * Refuses if this would remove the organization's last active administrator.
   *
   * A system role is one the tenant cannot function without. Deactivating or
   * deleting its final active holder would leave nobody able to administer the
   * organization and no way back in — the exact lockout `Role.isSystem` exists to
   * prevent, approached from the user side instead of the role side.
   */
  private async assertNotLastSystemAdmin(
    actor: AuthContext,
    userId: string,
    meta: RequestMeta,
    operation: string,
  ): Promise<void> {
    const systemRoleIds = await this.systemRolesHeldBy(actor.orgId, userId);
    if (systemRoleIds.length === 0) return;

    const remaining = await this.prisma.userRole.count({
      where: {
        orgId: actor.orgId,
        roleId: { in: systemRoleIds },
        userId: { not: userId },
        user: { status: 'ACTIVE' },
      },
    });

    if (remaining > 0) return;

    await this.recordLockoutPrevented(
      actor,
      meta,
      userId,
      `LAST_SYSTEM_ADMIN_${operation}`,
    );
    throw new ConflictException(
      'This is the last active administrator. Assign an administrator role to another active user first.',
    );
  }

  /** The same guard, for a role change that would drop the system role. */
  private async assertNotLastSystemAdminAfterRoles(
    actor: AuthContext,
    userId: string,
    roleIds: readonly string[],
    meta: RequestMeta,
  ): Promise<void> {
    const held = await this.systemRolesHeldBy(actor.orgId, userId);
    const keeps = held.some((roleId) => roleIds.includes(roleId));
    if (held.length === 0 || keeps) return;

    await this.assertNotLastSystemAdmin(actor, userId, meta, 'role_change');
  }

  private async systemRolesHeldBy(
    orgId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { orgId, userId, role: { isSystem: true } },
      select: { roleId: true },
    });

    return rows.map((row) => row.roleId);
  }

  private statusAction(surface: UserSurface, activating: boolean): string {
    if (surface === 'EMPLOYEE') {
      return activating
        ? AuditAction.EMPLOYEE_ACTIVATED
        : AuditAction.EMPLOYEE_DEACTIVATED;
    }
    return activating
      ? AuditAction.USER_ACTIVATED
      : AuditAction.USER_DEACTIVATED;
  }

  private async recordScopeDenial(
    actor: AuthContext,
    surface: UserSurface,
    userId: string,
    meta: RequestMeta,
    reason: string,
  ): Promise<void> {
    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.USER_SCOPE_DENIED,
        entityType: surface,
        entityId: userId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason, surface },
      })
      .catch(() => {});
  }

  private async recordRejection(
    actor: AuthContext,
    meta: RequestMeta,
    userId: string | null,
    surface: UserSurface,
    reason: string,
  ): Promise<void> {
    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.USER_CREATE_REJECTED,
        entityType: surface,
        entityId: userId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason },
      })
      .catch(() => {});
  }

  private async recordAssignRejection(
    actor: AuthContext,
    meta: RequestMeta,
    userId: string,
    reason: string,
  ): Promise<void> {
    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.EMPLOYEE_ASSIGN_REJECTED,
        entityType: 'EMPLOYEE',
        entityId: userId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason },
      })
      .catch(() => {});
  }

  private async recordRoleDenial(
    actor: AuthContext,
    meta: RequestMeta,
    userId: string | null,
    reason: string,
    excessPermissions?: string[],
  ): Promise<void> {
    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.USER_ROLE_ASSIGN_DENIED,
        entityType: 'USER',
        entityId: userId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          reason,
          ...(excessPermissions ? { excessPermissions } : {}),
        },
      })
      .catch(() => {});
  }

  private async recordLockoutPrevented(
    actor: AuthContext,
    meta: RequestMeta,
    userId: string,
    reason: string,
  ): Promise<void> {
    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.USER_LOCKOUT_PREVENTED,
        entityType: 'USER',
        entityId: userId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason },
      })
      .catch(() => {});
  }

  private async recordPersistenceFailure(
    actor: AuthContext,
    meta: RequestMeta,
    error: unknown,
    operation: string,
    userId: string | null,
  ): Promise<void> {
    this.logger.error(
      `User ${operation} failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );

    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.USER_PERSISTENCE_FAILED,
        entityType: 'USER',
        entityId: userId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { operation },
      })
      .catch(() => {});
  }

  /**
   * Turns a duplicate-identifier race into the 409 it is.
   *
   * `assertIdentifiersFree` catches the ordinary case; this catches the race
   * between that check and the insert. Without it the unique-constraint violation
   * reaches `AllExceptionsFilter` unrecognized and is rendered as a 503 about the
   * authentication service.
   */
  private translateUniqueViolation(error: unknown, mobile: string): unknown {
    const prismaError = error as { code?: string };
    if (prismaError?.code === 'P2002') {
      return new ConflictException(
        `This Mobile Number is already in use: ${mobile}`,
      );
    }
    return error;
  }
}
