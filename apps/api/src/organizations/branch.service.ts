import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  BranchDeleteBlocker,
  BranchDetail,
  BranchSummary,
  LifecycleStatus,
} from '@lms/types';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { BRANCH_DEPENDENCIES, summarizeBlockers } from './branch-dependencies';
import { CreateBranchDto } from './dto/create-branch.dto';
import { ListBranchesDto } from './dto/list-branches.dto';
import { SetStatusDto } from './dto/set-status.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

export const BRANCHES_VIEW_PERMISSION = 'branches.view';
export const BRANCHES_CREATE_PERMISSION = 'branches.create';
export const BRANCHES_UPDATE_PERMISSION = 'branches.update';
export const BRANCHES_DELETE_PERMISSION = 'branches.delete';
export const BRANCHES_ACTIVATE_PERMISSION = 'branches.activate';

/**
 * One message for every way a branch can be unreachable.
 *
 * A branch that does not exist, a branch in another tenant, and a branch in
 * another user's branch scope all produce this. Distinguishing them would let a
 * Branch Admin enumerate the organization's branch ids by watching which ones
 * answer "forbidden" rather than "not found". The real cause goes to the audit
 * log, where it is diagnostic without being a side channel.
 */
const NOT_REACHABLE = 'Branch not found';

type BranchRow = {
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
  status: LifecycleStatus;
  deactivatedAt: Date | null;
  deactivationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(row: BranchRow): BranchSummary {
  return {
    branchId: row.branchId,
    code: row.code,
    name: row.name,
    city: row.city,
    state: row.state,
    status: row.status,
  };
}

function toDetail(row: BranchRow): BranchDetail {
  return {
    ...toSummary(row),
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2 ?? undefined,
    pincode: row.pincode,
    phone: row.phone ?? undefined,
    contactEmail: row.contactEmail ?? undefined,
    deactivatedAt: row.deactivatedAt?.toISOString(),
    deactivationReason: row.deactivationReason ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Branch Management.
 *
 * The governing idiom, inherited from the rest of this codebase: the permission
 * grants the action, the service confines the reach. `PermissionsGuard` has
 * already established that the caller may, say, view branches; what it cannot
 * express is *which* branches, because that depends on the caller's own scope.
 * So every method here re-derives scope from `AuthContext` and never from the
 * request.
 *
 * `branchId === null` on the context means organization-wide (a Super Admin);
 * a non-null `branchId` confines the caller to exactly that branch. This is the
 * whole of Scenarios 15, 16, 35 and 38 — branch scope is an authorization
 * boundary, not a UI filter (Rule 26).
 */
@Injectable()
export class BranchService {
  private readonly logger = new Logger(BranchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Scenarios 13, 15, 38, 50. */
  async list(
    actor: AuthContext,
    query: ListBranchesDto,
    meta: RequestMeta,
  ): Promise<BranchSummary[]> {
    const rows = await this.prisma.branch.findMany({
      where: {
        orgId: actor.orgId,
        // The confinement. A Branch Admin's list is one row long, and no query
        // parameter can widen it.
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
        ...(query.activeOnly ? { status: 'ACTIVE' } : {}),
      },
      orderBy: { code: 'asc' },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.BRANCH_LISTED,
      entityType: 'BRANCH',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        returned: rows.length,
        scopedToBranch: actor.branchId,
        activeOnly: query.activeOnly ?? false,
      },
    });

    return rows.map(toSummary);
  }

  /** Scenarios 14, 16, 35, 37. */
  async getById(
    actor: AuthContext,
    branchId: string,
    meta: RequestMeta,
  ): Promise<BranchDetail> {
    const row = await this.findInScope(actor, branchId, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.BRANCH_VIEWED,
      entityType: 'BRANCH',
      entityId: branchId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toDetail(row);
  }

  /**
   * Scenarios 17, 18, 19, 46.
   *
   * The parent organization is the caller's own, taken from the context — a
   * branch cannot be created under another tenant because there is no parameter
   * that names one (Rule 14).
   */
  async create(
    actor: AuthContext,
    dto: CreateBranchDto,
    meta: RequestMeta,
  ): Promise<BranchDetail> {
    const organization = await this.prisma.organization.findUnique({
      where: { orgId: actor.orgId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    // Scenario 18: an inactive organization cannot gain new branches. Checked
    // before the write rather than relying on a constraint, because there is no
    // constraint that could express it.
    if (organization.status !== 'ACTIVE') {
      await this.recordRejection(actor, meta, 'ORG_INACTIVE', {
        code: dto.code,
      });
      throw new ConflictException(
        'A branch cannot be created under an inactive organization',
      );
    }

    // Checked here for a clear message, and again by the unique constraint
    // below — this read cannot exclude a concurrent create, so the constraint
    // is what actually guarantees it (Scenario 19).
    const existing = await this.prisma.branch.findUnique({
      where: { orgId_code: { orgId: actor.orgId, code: dto.code } },
    });

    if (existing) {
      await this.recordRejection(actor, meta, 'DUPLICATE_CODE', {
        code: dto.code,
      });
      throw new ConflictException(
        `Branch Code ${dto.code} is already in use in this organization`,
      );
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.branch.create({
          data: {
            orgId: actor.orgId,
            code: dto.code,
            name: dto.name,
            addressLine1: dto.addressLine1,
            addressLine2: dto.addressLine2 ?? null,
            city: dto.city,
            state: dto.state,
            pincode: dto.pincode,
            phone: dto.phone ?? null,
            contactEmail: dto.contactEmail ?? null,
            status: dto.status,
            deactivatedAt: dto.status === 'INACTIVE' ? new Date() : null,
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.BRANCH_CREATED,
            entityType: 'BRANCH',
            entityId: row.branchId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            newData: {
              code: row.code,
              name: row.name,
              city: row.city,
              status: row.status,
            },
          },
          tx,
        );

        return row;
      });

      return toDetail(created);
    } catch (error) {
      // Scenario 46: nothing partially created. The transaction guarantees it;
      // this only makes sure the attempt is not lost.
      await this.recordPersistenceFailure(actor, meta, error, 'create', null);
      throw this.translateUniqueViolation(error, dto.code);
    }
  }

  /**
   * Scenarios 20, 21, 22.
   *
   * `code`, `status` and any notion of a parent organization are absent from
   * the DTO. Code scopes the gapless receipt sequence, so changing it would
   * retroactively alter what an already-issued receipt number refers to
   * (Scenario 39); status has its own endpoint and permission; and moving a
   * branch between organizations stays unsupported while Q-ORG-15 is open.
   *
   * Nothing downstream moves. A renamed branch keeps every loan, collection and
   * ledger line it already had, still scoped to the same branch id (Scenario 21)
   * — the id, not the name, is what those records reference.
   */
  async update(
    actor: AuthContext,
    branchId: string,
    dto: UpdateBranchDto,
    meta: RequestMeta,
  ): Promise<BranchDetail> {
    const before = await this.findInScope(actor, branchId, meta);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.branch.update({
          where: { orgId_branchId: { orgId: actor.orgId, branchId } },
          data: {
            name: dto.name,
            addressLine1: dto.addressLine1,
            addressLine2: dto.addressLine2 ?? null,
            city: dto.city,
            state: dto.state,
            pincode: dto.pincode,
            phone: dto.phone ?? null,
            contactEmail: dto.contactEmail ?? null,
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.BRANCH_UPDATED,
            entityType: 'BRANCH',
            entityId: branchId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: {
              name: before.name,
              addressLine1: before.addressLine1,
              city: before.city,
              state: before.state,
              pincode: before.pincode,
              phone: before.phone,
              contactEmail: before.contactEmail,
            },
            newData: {
              name: row.name,
              addressLine1: row.addressLine1,
              city: row.city,
              state: row.state,
              pincode: row.pincode,
              phone: row.phone,
              contactEmail: row.contactEmail,
            },
          },
          tx,
        );

        return row;
      });

      return toDetail(updated);
    } catch (error) {
      await this.recordPersistenceFailure(
        actor,
        meta,
        error,
        'update',
        branchId,
      );
      throw error;
    }
  }

  /**
   * Scenarios 27, 28, 48.
   *
   * Deactivation writes one row and nothing else. Historical customers, loans,
   * receipts and ledger lines are untouched and keep their branch scope
   * (Scenario 27); receipt numbers are never renumbered and never reused, which
   * follows from this method not going near the sequence at all (Scenarios 39,
   * 40).
   *
   * Reactivation is refused while the parent organization is inactive: an
   * active branch under a dead tenant would be a route to the new transactions
   * the organization's own status is meant to stop (Rule 49).
   */
  async setStatus(
    actor: AuthContext,
    branchId: string,
    dto: SetStatusDto,
    meta: RequestMeta,
  ): Promise<BranchDetail> {
    const before = await this.findInScope(actor, branchId, meta);

    if (before.status === dto.status) {
      throw new ConflictException(`Branch is already ${dto.status}`);
    }

    const activating = dto.status === 'ACTIVE';

    if (activating) {
      const organization = await this.prisma.organization.findUnique({
        where: { orgId: actor.orgId },
      });

      if (organization?.status !== 'ACTIVE') {
        throw new ConflictException(
          'A branch cannot be activated while its organization is inactive',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.branch.update({
        where: { orgId_branchId: { orgId: actor.orgId, branchId } },
        data: {
          status: dto.status,
          deactivatedAt: activating ? null : new Date(),
          deactivationReason: activating ? null : (dto.reason ?? null),
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: activating
            ? AuditAction.BRANCH_ACTIVATED
            : AuditAction.BRANCH_DEACTIVATED,
          entityType: 'BRANCH',
          entityId: branchId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { reason: dto.reason ?? null },
          oldData: { status: before.status },
          newData: { status: row.status },
        },
        tx,
      );

      return row;
    });

    return toDetail(updated);
  }

  /**
   * Scenarios 29, 30, 33, 47, 54.
   *
   * The counts run inside the same transaction as the delete, which is what
   * makes the guard non-racy: a loan created between a check and a delete would
   * otherwise be orphaned, and Postgres would refuse with a bare foreign-key
   * error that `AllExceptionsFilter` renders as an unrelated 503.
   *
   * When anything references the branch the caller is told what and how much,
   * because the story requires directing them to deactivate instead
   * (Scenario 30) — advice that is only actionable if they can see the reason.
   */
  async remove(
    actor: AuthContext,
    branchId: string,
    meta: RequestMeta,
  ): Promise<{ branchId: string; deleted: boolean }> {
    await this.findInScope(actor, branchId, meta);

    let blockers: BranchDeleteBlocker[] = [];

    try {
      await this.prisma.$transaction(async (tx) => {
        const scope = { orgId: actor.orgId, branchId };

        const counts: Record<string, number> = {};
        for (const dependency of BRANCH_DEPENDENCIES) {
          const delegate = (
            tx as unknown as Record<
              string,
              { count: (args: { where: typeof scope }) => Promise<number> }
            >
          )[dependency.entity];

          counts[dependency.entity] = await delegate.count({ where: scope });
        }

        blockers = summarizeBlockers(counts);

        if (blockers.length > 0) {
          await this.audit.record(
            {
              orgId: actor.orgId,
              action: AuditAction.BRANCH_DELETE_BLOCKED,
              entityType: 'BRANCH',
              entityId: branchId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
              metadata: { blockedBy: blockers },
            },
            tx,
          );

          // Thrown inside the transaction so the audit row rolls back with it?
          // No — it commits, because the block is the outcome worth recording
          // (Scenario 54). See the catch below, which re-throws after the
          // rollback and re-records outside it.
          throw new ConflictException({
            message:
              'This branch cannot be deleted because records reference it. Deactivate it instead.',
            blockedBy: blockers,
          });
        }

        await tx.branch.delete({
          where: { orgId_branchId: { orgId: actor.orgId, branchId } },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.BRANCH_DELETED,
            entityType: 'BRANCH',
            entityId: branchId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          },
          tx,
        );
      });

      return { branchId, deleted: true };
    } catch (error) {
      if (error instanceof ConflictException) {
        // The blocked-delete audit rolled back with its transaction, so it is
        // written again here. Recording the refusal is required (Scenario 54)
        // and must not depend on the transaction that carried the refusal.
        await this.audit
          .record({
            orgId: actor.orgId,
            action: AuditAction.BRANCH_DELETE_BLOCKED,
            entityType: 'BRANCH',
            entityId: branchId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: { blockedBy: blockers },
          })
          .catch(() => {});

        throw error;
      }

      // Scenario 47: a failure must never be reported as a deletion.
      await this.recordPersistenceFailure(
        actor,
        meta,
        error,
        'delete',
        branchId,
      );
      throw error;
    }
  }

  /**
   * The seam downstream modules use to honour Rules 47 and 50.
   *
   * Customers, loans and collections do not exist yet, so nothing calls this
   * today — Scenarios 24, 25, 26 and 44 are satisfied at the guard level only,
   * a limitation recorded in docs/OPEN-QUESTIONS.md. It lives here rather than
   * in each future module so the rule is written once, and it takes a `tx` so a
   * caller can check and write atomically, which is what the offline-sync path
   * will need when it revalidates a queued transaction on arrival.
   */
  async assertBranchOperational(
    tx: Pick<PrismaService, 'branch' | 'organization'>,
    orgId: string,
    branchId: string,
  ): Promise<void> {
    const [organization, branch] = await Promise.all([
      tx.organization.findUnique({ where: { orgId } }),
      tx.branch.findUnique({ where: { orgId_branchId: { orgId, branchId } } }),
    ]);

    if (!organization || organization.status !== 'ACTIVE') {
      throw new ConflictException(
        'This organization is inactive and cannot receive new transactions',
      );
    }

    if (!branch) {
      throw new NotFoundException(NOT_REACHABLE);
    }

    if (branch.status !== 'ACTIVE') {
      throw new ConflictException(
        'This branch is inactive and cannot receive new transactions',
      );
    }
  }

  /**
   * Resolves a branch the caller is actually entitled to reach, or refuses.
   *
   * Out-of-tenant, out-of-branch and non-existent all produce the same
   * `NOT_REACHABLE` message; only the audit metadata distinguishes them.
   */
  private async findInScope(
    actor: AuthContext,
    branchId: string,
    meta: RequestMeta,
  ): Promise<BranchRow> {
    const row = await this.prisma.branch.findUnique({
      where: { orgId_branchId: { orgId: actor.orgId, branchId } },
    });

    if (!row) {
      await this.recordScopeDenial(
        actor,
        branchId,
        meta,
        'NOT_FOUND_OR_OTHER_ORG',
      );
      throw new NotFoundException(NOT_REACHABLE);
    }

    if (actor.branchId !== null && actor.branchId !== branchId) {
      await this.recordScopeDenial(actor, branchId, meta, 'BRANCH_SCOPE');
      throw new ForbiddenException(NOT_REACHABLE);
    }

    return row;
  }

  private async recordScopeDenial(
    actor: AuthContext,
    branchId: string,
    meta: RequestMeta,
    reason: string,
  ): Promise<void> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.BRANCH_SCOPE_DENIED,
      entityType: 'BRANCH',
      entityId: branchId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { reason, actorBranchId: actor.branchId },
    });
  }

  private async recordRejection(
    actor: AuthContext,
    meta: RequestMeta,
    reason: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.BRANCH_CREATE_REJECTED,
      entityType: 'BRANCH',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { reason, ...details },
    });
  }

  private async recordPersistenceFailure(
    actor: AuthContext,
    meta: RequestMeta,
    error: unknown,
    operation: string,
    branchId: string | null,
  ): Promise<void> {
    this.logger.error(
      `Branch ${operation} failed for org ${actor.orgId}`,
      error instanceof Error ? error.stack : undefined,
    );

    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.BRANCH_PERSISTENCE_FAILED,
        entityType: 'BRANCH',
        entityId: branchId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { operation },
      })
      .catch(() => {
        // The store is already failing; a second failure must not mask the
        // original error the caller needs to see.
      });
  }

  /**
   * Turns a unique-constraint violation into the message it deserves.
   *
   * Without this a concurrent duplicate create reaches `AllExceptionsFilter`,
   * which collapses any non-HttpException into a 503 reading "Authentication
   * service is temporarily unavailable" — wrong in every particular for a
   * duplicate branch code.
   */
  private translateUniqueViolation(error: unknown, code: string): unknown {
    const prismaCode = (error as { code?: string } | null)?.code;

    if (prismaCode === 'P2002') {
      return new ConflictException(
        `Branch Code ${code} is already in use in this organization`,
      );
    }

    return error;
  }
}
