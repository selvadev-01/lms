import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { LifecycleStatus, OrganizationDetail } from '@lms/types';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import { SESSION_REVOKE_REASON } from '../auth/session-state';
import { SessionService } from '../auth/session.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { SetStatusDto } from './dto/set-status.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

export const ORGANIZATIONS_VIEW_PERMISSION = 'organizations.view';
export const ORGANIZATIONS_UPDATE_PERMISSION = 'organizations.update';

type OrganizationRow = {
  orgId: string;
  code: string;
  name: string;
  legalName: string | null;
  logoFileRef: string | null;
  timezone: string;
  status: LifecycleStatus;
  deactivatedAt: Date | null;
  deactivationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDetail(row: OrganizationRow): OrganizationDetail {
  return {
    orgId: row.orgId,
    code: row.code,
    name: row.name,
    legalName: row.legalName ?? undefined,
    logoFileRef: row.logoFileRef ?? undefined,
    timezone: row.timezone,
    status: row.status,
    deactivatedAt: row.deactivatedAt?.toISOString(),
    deactivationReason: row.deactivationReason ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Company Settings — the caller's own organization.
 *
 * There is no list, no create and no delete, and that is a decision rather than
 * an omission (Q-ORG-1, Q-ORG-6). Every authenticated principal in this system
 * is bound to exactly one `orgId` by its JWT; no cross-tenant actor exists. An
 * organization-create would have no `orgId` to scope its own audit row against,
 * and an organization-delete would cascade an entire tenant — including the
 * audit log that is supposed to record the deletion. Both are recorded as
 * deferred in docs/OPEN-QUESTIONS.md rather than built as endpoints nothing can
 * legitimately reach.
 *
 * The consequence is that `orgId` is never read from a request in this class.
 * It comes from `AuthContext`, so Scenario 37 (cross-organization access) is
 * satisfied structurally: there is no parameter through which another tenant
 * could be named.
 */
@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  /** Scenarios 1, 2 — read, and log the read. */
  async getOwn(
    actor: AuthContext,
    meta: RequestMeta,
  ): Promise<OrganizationDetail> {
    const row = await this.prisma.organization.findUnique({
      where: { orgId: actor.orgId },
    });

    if (!row) {
      // The tenant on a valid token has vanished. Not a client error to
      // apologise for — something is wrong server-side, so it is logged loudly.
      this.logger.error(
        `Authenticated org ${actor.orgId} has no organization row`,
      );
      throw new NotFoundException('Organization not found');
    }

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.ORG_VIEWED,
      entityType: 'ORGANIZATION',
      entityId: actor.orgId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toDetail(row);
  }

  /**
   * Scenarios 6, 7 — edit Company Settings.
   *
   * `code` and `status` are absent from the DTO, so `forbidNonWhitelisted`
   * rejects an attempt to send either rather than silently ignoring it. The
   * code is the tenant's identity, quoted at sign-in and referenced by history;
   * status changes go through `setStatus`, which is a different permission and
   * a different audit action.
   *
   * Nothing downstream is touched. Editing the organization's display name does
   * not rewrite a single customer, loan or ledger row (Scenario 7), and the
   * before/after snapshot proves as much to an auditor.
   */
  async updateOwn(
    actor: AuthContext,
    dto: UpdateOrganizationDto,
    meta: RequestMeta,
  ): Promise<OrganizationDetail> {
    const before = await this.prisma.organization.findUnique({
      where: { orgId: actor.orgId },
    });

    if (!before) {
      throw new NotFoundException('Organization not found');
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.organization.update({
          where: { orgId: actor.orgId },
          data: {
            name: dto.name,
            legalName: dto.legalName ?? null,
            ...(dto.timezone ? { timezone: dto.timezone } : {}),
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.ORG_UPDATED,
            entityType: 'ORGANIZATION',
            entityId: actor.orgId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            // Scenario 52 asks for previous/current values. These land in the
            // `oldData`/`newData` audit columns rather than in `metadata` so
            // they stay queryable as structured before/after.
            oldData: {
              name: before.name,
              legalName: before.legalName,
              timezone: before.timezone,
            },
            newData: {
              name: row.name,
              legalName: row.legalName,
              timezone: row.timezone,
            },
          },
          tx,
        );

        return row;
      });

      return toDetail(updated);
    } catch (error) {
      await this.recordFailure(actor, meta, error, 'update');
      throw error;
    }
  }

  /**
   * Scenarios 10, 11, 12 — activate or deactivate.
   *
   * Deactivating writes one row. It does not cascade to branches, does not
   * touch a customer, and creates no ledger line (Scenario 41): an inactive
   * organization is a gate on *new* transactions, enforced at the point those
   * transactions are attempted, not a retroactive edit of everything that
   * already happened (Scenario 11).
   *
   * Reactivation is guarded only by the permission, per Scenario 12 — the story
   * requires that an unauthorized reactivation be refused, and
   * `organizations.update` is that authorization.
   */
  async setStatus(
    actor: AuthContext,
    dto: SetStatusDto,
    meta: RequestMeta,
  ): Promise<OrganizationDetail> {
    const before = await this.prisma.organization.findUnique({
      where: { orgId: actor.orgId },
    });

    if (!before) {
      throw new NotFoundException('Organization not found');
    }

    if (before.status === dto.status) {
      // Idempotent in effect but refused explicitly: silently returning success
      // would put an ORG_DEACTIVATED entry in the log for an organization that
      // was already inactive, which misreads as a second, distinct event.
      throw new ConflictException(`Organization is already ${dto.status}`);
    }

    const deactivating = dto.status === 'INACTIVE';

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.organization.update({
        where: { orgId: actor.orgId },
        data: {
          status: dto.status,
          // Cleared on reactivation: a stale reason on an active organization
          // would describe a state it is no longer in.
          deactivatedAt: deactivating ? new Date() : null,
          deactivationReason: deactivating ? (dto.reason ?? null) : null,
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: deactivating
            ? AuditAction.ORG_DEACTIVATED
            : AuditAction.ORG_ACTIVATED,
          entityType: 'ORGANIZATION',
          entityId: actor.orgId,
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

    if (deactivating) {
      /**
       * Outside the transaction, as user deactivation does it: a revocation
       * failure must not undo a committed deactivation.
       *
       * Necessary because per-request authorization re-reads the user's status
       * but not the organization's. Without this, everyone in a deactivated
       * tenant keeps working until their 15-minute access token lapses and the
       * refresh path — the only place that checks org status — refuses them.
       */
      await this.sessions
        .revokeAllForOrg(actor.orgId, SESSION_REVOKE_REASON.ORG_INACTIVE)
        .catch((error: unknown) => {
          this.logger.error(
            `Deactivated organization ${actor.orgId} but failed to revoke its sessions: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        });
    }

    return toDetail(updated);
  }

  private async recordFailure(
    actor: AuthContext,
    meta: RequestMeta,
    error: unknown,
    operation: string,
  ): Promise<void> {
    this.logger.error(
      `Organization ${operation} failed for org ${actor.orgId}`,
      error instanceof Error ? error.stack : undefined,
    );

    // Outside the rolled-back transaction, so the attempt survives the failure.
    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.ORG_UPDATE_FAILED,
        entityType: 'ORGANIZATION',
        entityId: actor.orgId,
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
}
