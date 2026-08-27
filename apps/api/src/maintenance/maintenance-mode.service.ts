import { BadRequestException, Injectable } from '@nestjs/common';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { resolveBranchScope } from '../reports/report-scope';

export const MAINTENANCE_MODE_MANAGE_PERMISSION = 'maintenance.mode.manage';

/** How long a resolved state is reused before re-reading. See `MaintenanceModeGuard`. */
export const MAINTENANCE_STATE_TTL_MS = 60_000;

export interface MaintenanceModeDetail {
  maintenanceModeId: string;
  branchId: string | null;
  enabled: boolean;
  reason: string;
  enabledBy: string | null;
  enabledAt: string | null;
  expectedEndAt: string | null;
  allowedPermissions: string[];
  blockedOperations: string[];
  userMessage: string | null;
  version: number;
}

/** The shape the guard needs, cheap enough to cache. */
export interface MaintenanceState {
  orgWide: {
    enabled: boolean;
    userMessage: string | null;
    allowedPermissions: string[];
  } | null;
  branches: Map<
    string,
    {
      enabled: boolean;
      userMessage: string | null;
      allowedPermissions: string[];
    }
  >;
}

/**
 * Maintenance mode state (Scenarios 32-35).
 *
 * # Enabling it can never widen access
 *
 * `allowedPermissions` is an ALLOW-list layered on top of normal authorization,
 * never a substitute for it: the guard consults it only after
 * `PermissionsGuard` has already decided the caller may perform the action at
 * all. Holding a permission named here does not grant it. That ordering is the
 * whole of Rule 78 and Scenario 33, and it lives in the guard's registration
 * position rather than in a check somebody could forget.
 *
 * # A branch row restricts only that branch
 *
 * Scenario 34. Branch and organization rows are separate records, and a branch
 * one does not imply the other. `resolveState` returns both so the guard can
 * apply the narrower without a second query per request.
 */
@Injectable()
export class MaintenanceModeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(
    actor: AuthContext,
    branchId?: string,
  ): Promise<MaintenanceModeDetail | null> {
    const scope = resolveBranchScope(actor, branchId);

    const row = await this.prisma.maintenanceMode.findFirst({
      where: { orgId: actor.orgId, branchId: scope },
    });
    return row ? this.toDetail(row) : null;
  }

  async list(actor: AuthContext): Promise<MaintenanceModeDetail[]> {
    const scope = resolveBranchScope(actor);

    const rows = await this.prisma.maintenanceMode.findMany({
      where: {
        orgId: actor.orgId,
        ...(scope ? { OR: [{ branchId: scope }, { branchId: null }] } : {}),
      },
      orderBy: { branchId: 'asc' },
    });
    return rows.map((row) => this.toDetail(row));
  }

  /**
   * Enable or disable, for an organization or one branch.
   *
   * A reason is mandatory in both directions (Rule 77): "why is the system
   * down" and "why did somebody turn the block off" are equally worth recording.
   */
  async set(
    actor: AuthContext,
    input: {
      branchId?: string | null;
      enabled: boolean;
      reason: string;
      expectedEndAt?: string | null;
      allowedPermissions?: string[];
      blockedOperations?: string[];
      userMessage?: string | null;
      expectedVersion?: number;
    },
    meta: RequestMeta,
  ): Promise<MaintenanceModeDetail> {
    const branchId =
      input.branchId === undefined
        ? (actor.branchId ?? null)
        : input.branchId === null
          ? null
          : resolveBranchScope(actor, input.branchId);

    const now = new Date();
    const existing = await this.prisma.maintenanceMode.findFirst({
      where: { orgId: actor.orgId, branchId },
    });

    const data = {
      enabled: input.enabled,
      reason: input.reason,
      expectedEndAt: input.expectedEndAt ? new Date(input.expectedEndAt) : null,
      allowedPermissions: input.allowedPermissions ?? [],
      blockedOperations: input.blockedOperations ?? [],
      userMessage: input.userMessage ?? null,
      ...(input.enabled
        ? {
            enabledBy: actor.userId,
            enabledAt: now,
            disabledBy: null,
            disabledAt: null,
          }
        : { disabledBy: actor.userId, disabledAt: now }),
    };

    let row;
    if (!existing) {
      row = await this.prisma.maintenanceMode.create({
        data: { orgId: actor.orgId, branchId, ...data },
      });
    } else {
      if (input.expectedVersion === undefined) {
        throw new BadRequestException(
          'This form is out of date. Reload and try again.',
        );
      }
      const result = await this.prisma.maintenanceMode.updateMany({
        where: {
          orgId: actor.orgId,
          maintenanceModeId: existing.maintenanceModeId,
          version: input.expectedVersion,
        },
        data: { ...data, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new BadRequestException(
          'Maintenance mode was changed by someone else. Reload and try again.',
        );
      }
      row = await this.prisma.maintenanceMode.findFirst({
        where: {
          orgId: actor.orgId,
          maintenanceModeId: existing.maintenanceModeId,
        },
      });
    }

    await this.audit.record({
      orgId: actor.orgId,
      branchId,
      actorUserId: actor.userId,
      action: input.enabled
        ? AuditAction.MAINTENANCE_MODE_ENABLED
        : AuditAction.MAINTENANCE_MODE_DISABLED,
      entityType: 'maintenance_mode',
      entityId: row!.maintenanceModeId,
      oldData: existing ? { enabled: existing.enabled } : undefined,
      newData: { enabled: input.enabled, reason: input.reason },
      metadata: { branchId, expectedEndAt: input.expectedEndAt ?? null },
      ...meta,
    });

    return this.toDetail(row);
  }

  /**
   * The state the guard applies, for one organization.
   *
   * Returns both the organization row and every branch row in one query: the
   * guard runs on every request, and a per-branch lookup would add a round trip
   * to each one.
   */
  async resolveState(orgId: string): Promise<MaintenanceState> {
    const rows = await this.prisma.maintenanceMode.findMany({
      where: { orgId, enabled: true },
    });

    const state: MaintenanceState = { orgWide: null, branches: new Map() };

    for (const row of rows) {
      const entry = {
        enabled: row.enabled,
        userMessage: row.userMessage,
        allowedPermissions: row.allowedPermissions,
      };
      if (row.branchId === null) {
        state.orgWide = entry;
      } else {
        state.branches.set(row.branchId, entry);
      }
    }

    return state;
  }

  private toDetail(row: {
    maintenanceModeId: string;
    branchId: string | null;
    enabled: boolean;
    reason: string;
    enabledBy: string | null;
    enabledAt: Date | null;
    expectedEndAt: Date | null;
    allowedPermissions: string[];
    blockedOperations: string[];
    userMessage: string | null;
    version: number;
  }): MaintenanceModeDetail {
    return {
      maintenanceModeId: row.maintenanceModeId,
      branchId: row.branchId,
      enabled: row.enabled,
      reason: row.reason,
      enabledBy: row.enabledBy,
      enabledAt: row.enabledAt?.toISOString() ?? null,
      expectedEndAt: row.expectedEndAt?.toISOString() ?? null,
      allowedPermissions: row.allowedPermissions,
      blockedOperations: row.blockedOperations,
      userMessage: row.userMessage,
      version: row.version,
    };
  }
}
