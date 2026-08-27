import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  RoleDeleteBlocker,
  RoleDetail,
  RoleLifecycleStatus,
  RoleSummary,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { AuthorizationService } from '../../common/authorization/authorization.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { ListRolesDto } from './dto/list-roles.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { SetRoleStatusDto } from './dto/set-role-status.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { summarizeRoleBlockers } from './role-dependencies';

export const ROLES_VIEW_PERMISSION = 'roles.view';
export const ROLES_CREATE_PERMISSION = 'roles.create';
export const ROLES_UPDATE_PERMISSION = 'roles.update';
export const ROLES_DELETE_PERMISSION = 'roles.delete';
export const ROLES_ACTIVATE_PERMISSION = 'roles.activate';
export const ROLES_ASSIGN_PERMISSIONS_PERMISSION = 'roles.assign_permissions';

/**
 * One message for every way a role can be unreachable.
 *
 * A role that does not exist and a role in another tenant both produce this.
 * Distinguishing them would let a caller enumerate another organization's role
 * ids by watching which ones answer differently. The real cause goes to the
 * audit log, where it is diagnostic without being a side channel.
 */
const NOT_REACHABLE = 'Role not found';

type RoleRow = {
  orgId: string;
  roleId: string;
  code: string;
  name: string;
  description: string | null;
  status: RoleLifecycleStatus;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type RoleRowWithCounts = RoleRow & {
  _count?: { rolePermissions: number; userRoles: number };
};

function toSummary(row: RoleRowWithCounts): RoleSummary {
  return {
    roleId: row.roleId,
    code: row.code,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    isSystem: row.isSystem,
    permissionCount: row._count?.rolePermissions ?? 0,
    assignedUserCount: row._count?.userRoles ?? 0,
  };
}

function toDetail(row: RoleRowWithCounts, permissions: string[]): RoleDetail {
  return {
    ...toSummary(row),
    permissions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Role & Permission Management.
 *
 * Implements the source-defined sequence Create Role → Assign Module Permissions
 * → Save & Activate, and the two rules that keep it from being an escalation
 * path:
 *
 * **Delegation (Rule 27, Scenario 37).** An administrator may only grant
 * permissions they themselves hold. Without it, anyone with `roles.create` could
 * mint a role containing `loans.approve`, assign it to themselves, and be done —
 * the permission to manage roles would silently be the permission to do
 * everything. The check reads `actor.permissions`, which since Module 03 is
 * resolved live from the database, so a stale token cannot be used to widen what
 * the actor appears to hold.
 *
 * **System-role protection (Rule 25/26, Q-RBAC-17).** A role marked `isSystem`
 * cannot be renamed, deactivated, deleted, or have permissions removed. Nothing
 * otherwise stops an organization deactivating SUPER_ADMIN and locking every
 * administrator out of the tenant permanently. Permissions may still be *added*:
 * the protection is against losing access, not gaining it.
 *
 * Roles are organization-scoped and carry no branch, so unlike `BranchService`
 * there is no branch confinement here — `findInScope` checks tenancy only.
 */
@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Scenario 26. */
  async list(
    actor: AuthContext,
    query: ListRolesDto,
    meta: RequestMeta,
  ): Promise<RoleSummary[]> {
    const rows = await this.prisma.role.findMany({
      where: {
        orgId: actor.orgId,
        ...(query.activeOnly ? { status: 'ACTIVE' } : {}),
      },
      orderBy: [{ code: 'asc' }],
      include: {
        _count: { select: { rolePermissions: true, userRoles: true } },
      },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.ROLE_LISTED,
      entityType: 'ROLE',
      entityId: null,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { count: rows.length, activeOnly: query.activeOnly ?? false },
    });

    return rows.map(toSummary);
  }

  /** Scenarios 26, 29 — the permission editor's read. */
  async getById(
    actor: AuthContext,
    roleId: string,
    meta: RequestMeta,
  ): Promise<RoleDetail> {
    const row = await this.findInScope(actor, roleId, meta);
    const permissions = await this.grantedCodes(actor.orgId, roleId);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.ROLE_VIEWED,
      entityType: 'ROLE',
      entityId: roleId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toDetail(row, permissions);
  }

  /**
   * Create Role — Scenarios 27, 28, 51, 59.
   *
   * Always DRAFT. Scenario 27 requires a new role not grant anything yet, and
   * the source sequence puts activation two steps later.
   */
  async create(
    actor: AuthContext,
    dto: CreateRoleDto,
    meta: RequestMeta,
  ): Promise<RoleDetail> {
    const requested = [...new Set(dto.permissions ?? [])];

    // Both checks precede the write, so a refusal never leaves a partial role.
    // Resolution first, so an unknown code reports as a client error rather than
    // as a delegation refusal — see setPermissions for the same ordering.
    const permissionIds = await this.resolvePermissionIds(
      actor.orgId,
      requested,
    );
    await this.assertDelegable(actor, requested, meta, null);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.role.create({
          data: {
            orgId: actor.orgId,
            code: dto.code,
            name: dto.name,
            description: dto.description ?? null,
            status: 'DRAFT',
            // Never from the caller: a client-created system role would be an
            // undeletable, unmodifiable row anyone could mint at will.
            isSystem: false,
          },
        });

        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({
              orgId: actor.orgId,
              roleId: row.roleId,
              permissionId,
            })),
          });
        }

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.ROLE_CREATED,
            entityType: 'ROLE',
            entityId: row.roleId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            newData: {
              code: row.code,
              name: row.name,
              status: row.status,
              permissions: requested,
            },
          },
          tx,
        );

        return row;
      });

      return toDetail(
        {
          ...created,
          _count: { rolePermissions: requested.length, userRoles: 0 },
        },
        requested,
      );
    } catch (error) {
      await this.recordPersistenceFailure(actor, meta, error, 'create', null);
      throw this.translateUniqueViolation(error, dto.code);
    }
  }

  /**
   * Rename a role or edit its description — Scenario 51.
   *
   * `code`, `status` and `permissions` are absent from the DTO, each having its
   * own endpoint and permission. Nothing downstream moves: a renamed role keeps
   * every assignment and grant it had, because those reference the role id.
   */
  async update(
    actor: AuthContext,
    roleId: string,
    dto: UpdateRoleDto,
    meta: RequestMeta,
  ): Promise<RoleDetail> {
    const before = await this.findInScope(actor, roleId, meta);
    await this.assertNotSystemProtected(actor, before, 'update', meta);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.role.update({
          where: { orgId_roleId: { orgId: actor.orgId, roleId } },
          data: { name: dto.name, description: dto.description ?? null },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.ROLE_UPDATED,
            entityType: 'ROLE',
            entityId: roleId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: { name: before.name, description: before.description },
            newData: { name: row.name, description: row.description },
          },
          tx,
        );

        return row;
      });

      return toDetail(updated, await this.grantedCodes(actor.orgId, roleId));
    } catch (error) {
      await this.recordPersistenceFailure(actor, meta, error, 'update', roleId);
      throw error;
    }
  }

  /**
   * Assign Module Permissions — Scenarios 29, 38, 39, 40, 52, 57, 59.
   *
   * A full replacement inside one transaction, which is what makes Scenario 59
   * hold: if persistence fails, the previous committed set remains authoritative
   * because it was never removed outside a transaction that also rolled back.
   *
   * Historical business records are untouched (Scenario 57). This writes only to
   * `role_permissions`; what a user did yesterday under a permission they no
   * longer hold stays exactly as recorded.
   */
  async setPermissions(
    actor: AuthContext,
    roleId: string,
    dto: SetRolePermissionsDto,
    meta: RequestMeta,
  ): Promise<RoleDetail> {
    const role = await this.findInScope(actor, roleId, meta);
    const requested = [...new Set(dto.permissions)];
    const current = await this.grantedCodes(actor.orgId, roleId);

    // Only what is being *added* is subject to delegation. Requiring the actor to
    // hold everything already on the role would make an administrator unable to
    // remove a permission from a role more privileged than themselves — the rule
    // is about what you can grant, not what you may take away.
    const added = requested.filter((code) => !current.includes(code));
    const removed = current.filter((code) => !requested.includes(code));

    // Resolved before the delegation check, so an unknown code is reported as
    // the client error it is. The other order returns "you cannot grant this",
    // which is true but misleading — a code nobody holds because it does not
    // exist reads as a permissions problem rather than a typo.
    const permissionIds = await this.resolvePermissionIds(
      actor.orgId,
      requested,
    );

    await this.assertDelegable(actor, added, meta, roleId);

    // A system role may gain permissions but never lose them (Q-RBAC-17).
    if (removed.length > 0) {
      await this.assertNotSystemProtected(
        actor,
        role,
        'remove_permissions',
        meta,
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.rolePermission.deleteMany({
          where: { orgId: actor.orgId, roleId },
        });

        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({
              orgId: actor.orgId,
              roleId,
              permissionId,
            })),
          });
        }

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.ROLE_PERMISSIONS_UPDATED,
            entityType: 'ROLE',
            entityId: roleId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            // Both sets, so an auditor sees what changed rather than only the
            // result (Scenario 52).
            oldData: { permissions: current },
            newData: { permissions: requested },
            metadata: { added, removed },
          },
          tx,
        );
      });

      return toDetail(role, requested);
    } catch (error) {
      await this.recordPersistenceFailure(
        actor,
        meta,
        error,
        'set_permissions',
        roleId,
      );
      throw error;
    }
  }

  /**
   * Save & Activate, and its reverse — Scenarios 30, 41.
   *
   * Activating requires at least one permission. An ACTIVE role granting nothing
   * is indistinguishable from a misconfigured one, and the source sequence puts
   * permission assignment before activation precisely so this cannot happen by
   * accident.
   */
  async setStatus(
    actor: AuthContext,
    roleId: string,
    dto: SetRoleStatusDto,
    meta: RequestMeta,
  ): Promise<RoleDetail> {
    const before = await this.findInScope(actor, roleId, meta);

    if (before.status === dto.status) {
      throw new ConflictException(`This role is already ${dto.status}`);
    }

    // A system role may never stop being active, or the organization can lose
    // its last administrator.
    if (dto.status !== 'ACTIVE') {
      await this.assertNotSystemProtected(actor, before, 'deactivate', meta);
    }

    const granted = await this.grantedCodes(actor.orgId, roleId);
    if (dto.status === 'ACTIVE' && granted.length === 0) {
      await this.recordRejection(actor, meta, roleId, 'NO_PERMISSIONS');
      throw new ConflictException(
        'Assign at least one permission before activating this role',
      );
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.role.update({
          where: { orgId_roleId: { orgId: actor.orgId, roleId } },
          data: { status: dto.status },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action:
              dto.status === 'ACTIVE'
                ? AuditAction.ROLE_ACTIVATED
                : AuditAction.ROLE_DEACTIVATED,
            entityType: 'ROLE',
            entityId: roleId,
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

        return row;
      });

      return toDetail(updated, granted);
    } catch (error) {
      await this.recordPersistenceFailure(
        actor,
        meta,
        error,
        'set_status',
        roleId,
      );
      throw error;
    }
  }

  /**
   * Delete a role — Scenario 56.
   *
   * Refused while any user holds it. Deleting an assigned role would silently
   * strip its holders' access, and "deactivate it instead" is the answer the
   * story wants — which is only actionable if the refusal says what is in the
   * way, hence the blockers in the 409 body.
   */
  async remove(
    actor: AuthContext,
    roleId: string,
    meta: RequestMeta,
  ): Promise<{ roleId: string; deleted: boolean }> {
    const role = await this.findInScope(actor, roleId, meta);
    await this.assertNotSystemProtected(actor, role, 'delete', meta);

    let blockers: RoleDeleteBlocker[] = [];

    try {
      await this.prisma.$transaction(async (tx) => {
        // Counted explicitly rather than by looping the dependency list: with a
        // single entry a loop would have to map entity names onto delegates, and
        // a mismatch there would silently count the wrong table. If a second
        // blocking relation is ever added, add its count here alongside.
        const counts: Record<string, number> = {
          userRole: await tx.userRole.count({
            where: { orgId: actor.orgId, roleId },
          }),
        };

        blockers = summarizeRoleBlockers(counts);

        if (blockers.length > 0) {
          throw new ConflictException({
            message:
              'This role cannot be deleted because users are assigned to it. Deactivate it instead.',
            blockedBy: blockers,
          });
        }

        await tx.role.delete({
          where: { orgId_roleId: { orgId: actor.orgId, roleId } },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.ROLE_DELETED,
            entityType: 'ROLE',
            entityId: roleId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: { code: role.code, name: role.name },
          },
          tx,
        );
      });

      return { roleId, deleted: true };
    } catch (error) {
      if (error instanceof ConflictException) {
        // The blocked-delete audit rolled back with its transaction, so it is
        // written again here: recording the refusal must not depend on the
        // transaction that carried it.
        await this.audit
          .record({
            orgId: actor.orgId,
            action: AuditAction.ROLE_DELETE_BLOCKED,
            entityType: 'ROLE',
            entityId: roleId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: { blockedBy: blockers },
          })
          .catch(() => {});

        throw error;
      }

      await this.recordPersistenceFailure(actor, meta, error, 'delete', roleId);
      throw error;
    }
  }

  /**
   * The permission codes a role currently grants.
   *
   * Public because `UserService` needs it to check that a role being assigned is
   * one the actor could have granted (Scenario 37) — assigning a privileged role
   * is the same escalation as creating one.
   */
  async grantedCodes(
    orgId: string,
    roleId: string,
    tx?: Pick<PrismaService, 'rolePermission'>,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const grants = await client.rolePermission.findMany({
      where: { orgId, roleId },
      select: { permission: { select: { code: true } } },
    });

    return grants.map((grant) => grant.permission.code);
  }

  /**
   * The delegation subset rule (Rule 27, Scenario 37).
   *
   * Refuses unless every requested permission is one the actor already holds.
   * `actor.permissions` is the live set resolved by `JwtAuthGuard`, not a token
   * claim, so this cannot be bypassed by holding an old token.
   *
   * Note this permits a *lateral* move: an administrator may create a role
   * holding exactly their own permissions and assign it to someone else. That is
   * the rule working as specified — it bounds escalation, not delegation.
   */
  private async assertDelegable(
    actor: AuthContext,
    requested: readonly string[],
    meta: RequestMeta,
    roleId: string | null,
  ): Promise<void> {
    const excess = AuthorizationService.excessPermissions(
      requested,
      actor.permissions,
    );
    if (excess.length === 0) return;

    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.ROLE_PERMISSIONS_DENIED,
        entityType: 'ROLE',
        entityId: roleId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason: 'NOT_DELEGABLE', excessPermissions: excess },
      })
      .catch(() => {});

    throw new ForbiddenException(
      'You cannot grant permissions that you do not hold yourself',
    );
  }

  /**
   * System-role protection (Rule 25/26, Q-RBAC-17).
   *
   * Unlike the other refusals here, this one is deliberately explicit rather than
   * opaque: the caller is entitled to know a role is protected, because that is
   * a property of the role rather than something about their own scope. Telling
   * them costs nothing and saves a support ticket.
   */
  private async assertNotSystemProtected(
    actor: AuthContext,
    role: RoleRow,
    operation: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (!role.isSystem) return;

    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.ROLE_SYSTEM_PROTECTED,
        entityType: 'ROLE',
        entityId: role.roleId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { operation, code: role.code },
      })
      .catch(() => {});

    throw new ConflictException(
      'This is a system role and cannot be modified. Create a new role instead.',
    );
  }

  /**
   * Maps permission codes to their ids within the tenant, refusing unknown ones.
   *
   * An unknown code is a client error worth reporting rather than something to
   * skip: silently dropping it would leave the administrator believing they had
   * granted a permission that does not exist.
   */
  private async resolvePermissionIds(
    orgId: string,
    codes: readonly string[],
  ): Promise<string[]> {
    if (codes.length === 0) return [];

    const rows = await this.prisma.permission.findMany({
      where: { orgId, code: { in: [...codes] } },
      select: { permissionId: true, code: true },
    });

    const found = new Set(rows.map((row) => row.code));
    const unknown = codes.filter((code) => !found.has(code));
    if (unknown.length > 0) {
      throw new ConflictException(
        `Unknown permission${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`,
      );
    }

    return rows.map((row) => row.permissionId);
  }

  /**
   * Resolves a role the caller is entitled to reach, or refuses.
   *
   * Tenancy only — a role has no branch, so there is no branch comparison to
   * make. Both failure modes produce the same message; only the audit
   * distinguishes them.
   */
  private async findInScope(
    actor: AuthContext,
    roleId: string,
    meta: RequestMeta,
  ): Promise<RoleRowWithCounts> {
    const row = await this.prisma.role.findUnique({
      where: { orgId_roleId: { orgId: actor.orgId, roleId } },
      include: {
        _count: { select: { rolePermissions: true, userRoles: true } },
      },
    });

    if (!row) {
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.ROLE_SCOPE_DENIED,
          entityType: 'ROLE',
          entityId: roleId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { reason: 'NOT_FOUND_OR_OTHER_ORG' },
        })
        .catch(() => {});
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  private async recordRejection(
    actor: AuthContext,
    meta: RequestMeta,
    roleId: string | null,
    reason: string,
  ): Promise<void> {
    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.ROLE_CREATE_REJECTED,
        entityType: 'ROLE',
        entityId: roleId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason },
      })
      .catch(() => {});
  }

  /**
   * Records a write that failed, without letting the recording mask the failure.
   *
   * Swallows its own errors for the same reason the guards do: a failed audit
   * write must not replace the original error with a less useful one.
   */
  private async recordPersistenceFailure(
    actor: AuthContext,
    meta: RequestMeta,
    error: unknown,
    operation: string,
    roleId: string | null,
  ): Promise<void> {
    this.logger.error(
      `Role ${operation} failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );

    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.ROLE_PERSISTENCE_FAILED,
        entityType: 'ROLE',
        entityId: roleId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { operation },
      })
      .catch(() => {});
  }

  /**
   * Turns a duplicate-code collision into the 409 it is.
   *
   * Without this the unique-constraint violation reaches `AllExceptionsFilter`
   * as an unrecognized Prisma error and is rendered as a 503 about the
   * authentication service — the same trap `BranchService` documents.
   */
  private translateUniqueViolation(error: unknown, code: string): unknown {
    const prismaError = error as { code?: string };
    if (prismaError?.code === 'P2002') {
      return new ConflictException(`Role Code "${code}" is already in use`);
    }
    return error;
  }
}
