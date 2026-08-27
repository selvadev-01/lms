import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SETTING_DEFINITIONS,
  getSettingDefinition,
  validateSettingValue,
  type SettingDefinition,
} from '@lms/validation';
import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { resolveBranchScope } from '../reports/report-scope';

export const SETTINGS_VIEW_PERMISSION = 'settings.view';
export const SETTINGS_MANAGE_PERMISSION = 'settings.manage';
export const SETTINGS_BRANCH_MANAGE_PERMISSION = 'settings.branch.manage';
export const SETTINGS_PROTECTED_MANAGE_PERMISSION = 'settings.protected.manage';

/**
 * One message for every way a setting can be unreachable — absent, another
 * branch's, or another tenant's. Following `MasterDataService` and
 * `CustomerService`: distinguishing them would confirm the existence of rows the
 * caller cannot see. The real cause goes to the audit log instead.
 */
const NOT_REACHABLE = 'Setting not found';

/** What a caller without `settings.protected.manage` sees instead of a value. */
const MASKED = '********';

/**
 * The `settings` row, as this service uses it.
 *
 * Declared structurally rather than imported from the generated client, the
 * convention every other service here follows: the generated types are not
 * re-exported through a stable path, and a service that named them would break
 * on a client regeneration that changed their location.
 */
interface SettingRow {
  settingId: string;
  branchId: string | null;
  settingCode: string;
  settingCategory: string;
  valueType: string;
  valueJson: unknown;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  status: string;
  version: number;
  isProtected: boolean;
  updatedAt: Date;
}

export interface SettingDetail {
  settingId: string;
  branchId: string | null;
  settingCode: string;
  name: string;
  description: string;
  category: string;
  valueType: string;
  /** Masked for a protected setting when the caller lacks the permission. */
  value: unknown;
  isValueMasked: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: string;
  version: number;
  isProtected: boolean;
  /** From the registry, never from a column — see the registry file header. */
  requiresApproval: boolean;
  updatedAt: string;
}

/**
 * Module 17 — configured settings at organization and branch scope.
 *
 * # The registry is the authority, not this table
 *
 * `settings` stores `setting_code` + `value_json` and could hold anything. What
 * it may actually hold is decided by `SETTING_DEFINITIONS` in `@lms/validation`:
 * every write resolves its code there first, and an unresolved code is refused
 * rather than stored. That is Rules 8 and 9 without a migration per setting.
 *
 * Two consequences are easy to undo by accident:
 *
 *  * `requiresApproval` and `isProtected` are read from the DEFINITION on every
 *    authorization decision, never from the row. The row carries an
 *    `isProtected` snapshot for rendering only. Reading the column to decide
 *    whether an edit is permitted would let an operator who can write the row
 *    also write their own permission check (Rule 43).
 *  * A setting whose code requires approval is never written directly. `upsert`
 *    returns a change request instead and leaves the active row untouched, which
 *    is Scenario 9 — the existing configuration stays effective until approval.
 *
 * # Uniqueness lives in the database, not here
 *
 * Duplicate codes are caught by two PARTIAL unique indexes (see the migration),
 * not by a read-then-write check, which would race. P2002 is translated to a
 * 409 at the bottom of this file.
 */
@Injectable()
export class SettingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Settings visible to the caller.
   *
   * A branch-confined caller sees their own branch's rows AND the
   * organization-wide ones — the org row is the effective default for their
   * branch, so hiding it would show them a screen that does not describe the
   * configuration they actually operate under (Scenarios 1, 3).
   */
  async list(
    actor: AuthContext,
    filters: {
      category?: string;
      branchId?: string;
      includeInactive?: boolean;
    },
  ): Promise<SettingDetail[]> {
    const branchScope = resolveBranchScope(actor, filters.branchId);

    const rows = await this.prisma.setting.findMany({
      where: {
        orgId: actor.orgId,
        ...(filters.category ? { settingCategory: filters.category } : {}),
        ...(filters.includeInactive ? {} : { status: { not: 'INACTIVE' } }),
        ...(branchScope
          ? { OR: [{ branchId: branchScope }, { branchId: null }] }
          : {}),
      },
      orderBy: [{ settingCategory: 'asc' }, { settingCode: 'asc' }],
    });

    return rows.map((row) => this.toDetail(row, actor));
  }

  async get(actor: AuthContext, settingId: string): Promise<SettingDetail> {
    const row = await this.findInScope(actor, settingId);
    return this.toDetail(row, actor);
  }

  /**
   * Create or update a setting.
   *
   * The order of the checks below is deliberate. Registry resolution comes
   * first, because an unknown code has no scope, no type and no approval policy
   * to check against — every later question is meaningless without it.
   */
  async upsert(
    actor: AuthContext,
    input: {
      settingCode: string;
      branchId?: string | null;
      value: unknown;
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
      changeReason: string;
      expectedVersion?: number;
    },
    meta: RequestMeta,
  ): Promise<{ setting?: SettingDetail; changeRequestId?: string }> {
    const definition = this.requireDefinition(actor, input.settingCode, meta);

    // Scope: narrows, never widens. `resolveBranchScope` throws for a
    // branch-confined caller naming another branch (Scenario 44).
    const branchId = this.resolveTargetBranch(
      actor,
      definition,
      input.branchId ?? null,
      meta,
    );

    this.assertMayWrite(actor, definition, branchId, meta);

    const validated = validateSettingValue(input.settingCode, input.value);
    if (!validated.ok) {
      // Scenario 68: a rejected change is audited, and the active configuration
      // is left exactly as it was.
      await this.audit
        .record({
          orgId: actor.orgId,
          branchId,
          actorUserId: actor.userId,
          action: AuditAction.SETTING_REJECTED,
          entityType: 'setting',
          metadata: {
            settingCode: input.settingCode,
            reason: validated.message,
          },
          ...meta,
        })
        .catch(() => undefined);
      throw new BadRequestException(validated.message);
    }

    this.assertEffectiveRange(input.effectiveFrom, input.effectiveTo);

    const existing = await this.prisma.setting.findFirst({
      where: { orgId: actor.orgId, branchId, settingCode: input.settingCode },
    });

    // Maker-checker. The active row is not touched; a request is raised instead
    // and the current configuration stays effective until approval (Scenario 9).
    if (definition.requiresApproval) {
      const changeRequestId = await this.raiseChangeRequest(
        actor,
        definition,
        branchId,
        validated.value,
        input.changeReason,
        existing,
        meta,
      );
      return { changeRequestId };
    }

    const row = existing
      ? await this.update(
          actor,
          definition,
          existing,
          validated.value,
          input,
          meta,
        )
      : await this.create(
          actor,
          definition,
          branchId,
          validated.value,
          input,
          meta,
        );

    return { setting: this.toDetail(row, actor) };
  }

  /**
   * Deactivate a setting (Scenario 14).
   *
   * Deactivation, not deletion, is the sanctioned removal path where a setting
   * is referenced (Rules 36, 38): historical records that relied on it stay
   * intact and keep resolving, and only NEW operations stop seeing it.
   */
  async setStatus(
    actor: AuthContext,
    settingId: string,
    status: 'ACTIVE' | 'INACTIVE',
    expectedVersion: number,
    meta: RequestMeta,
  ): Promise<SettingDetail> {
    const row = await this.findInScope(actor, settingId);
    const definition = this.requireDefinition(actor, row.settingCode, meta);
    this.assertMayWrite(actor, definition, row.branchId, meta);

    // Reactivation re-validates before it takes effect (Scenario 18): a value
    // that was legal when it was deactivated may not be legal now, and a stored
    // value that no longer parses must not silently become effective again.
    if (status === 'ACTIVE') {
      const revalidated = validateSettingValue(row.settingCode, row.valueJson);
      if (!revalidated.ok) {
        throw new BadRequestException(
          `This setting cannot be reactivated: ${revalidated.message}`,
        );
      }
    }

    const updated = await this.applyVersionedUpdate(
      actor,
      settingId,
      expectedVersion,
      { status },
      meta,
      row,
    );

    await this.audit.record({
      orgId: actor.orgId,
      branchId: row.branchId,
      actorUserId: actor.userId,
      action:
        status === 'ACTIVE'
          ? AuditAction.SETTING_ACTIVATED
          : AuditAction.SETTING_DEACTIVATED,
      entityType: 'setting',
      entityId: settingId,
      oldData: { status: row.status },
      newData: { status },
      metadata: { settingCode: row.settingCode },
      ...meta,
    });

    return this.toDetail(updated, actor);
  }

  /**
   * Delete a setting, if nothing references it (Scenarios 16, 17).
   *
   * A protected setting is never deletable regardless of references — the
   * permission gates editing it, and deletion is a stronger act than an edit.
   */
  async remove(
    actor: AuthContext,
    settingId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const row = await this.findInScope(actor, settingId);
    const definition = this.requireDefinition(actor, row.settingCode, meta);
    this.assertMayWrite(actor, definition, row.branchId, meta);

    if (definition.isProtected) {
      await this.auditBlocked(
        actor,
        row,
        'Protected settings cannot be deleted',
        meta,
      );
      throw new ConflictException(
        'This setting is protected and cannot be deleted. Deactivate it instead.',
      );
    }

    // Any change request referencing it is history that must survive (Rule 38),
    // so its existence blocks the delete rather than cascading.
    const referencing = await this.prisma.settingChangeRequest.count({
      where: { orgId: actor.orgId, settingId },
    });
    if (referencing > 0) {
      await this.auditBlocked(
        actor,
        row,
        `${referencing} configuration change request(s) reference it`,
        meta,
      );
      throw new ConflictException(
        'This setting has configuration change history and cannot be deleted. Deactivate it instead.',
      );
    }

    await this.prisma.setting.delete({
      where: { orgId_settingId: { orgId: actor.orgId, settingId } },
    });

    await this.audit.record({
      orgId: actor.orgId,
      branchId: row.branchId,
      actorUserId: actor.userId,
      action: AuditAction.SETTING_DELETED,
      entityType: 'setting',
      entityId: settingId,
      oldData: this.snapshot(row),
      metadata: { settingCode: row.settingCode },
      ...meta,
    });
  }

  /**
   * The registry, as the settings screen needs to render it.
   *
   * Exposed so the UI can offer only supported codes rather than a free-text
   * box — the UI half of Rule 9.
   */
  catalog(): Array<{
    code: string;
    name: string;
    description: string;
    category: string;
    scope: string;
    valueType: string;
    isProtected: boolean;
    requiresApproval: boolean;
  }> {
    return SETTING_DEFINITIONS.map((definition) => ({
      code: definition.code,
      name: definition.name,
      description: definition.description,
      category: definition.category,
      scope: definition.scope,
      valueType: definition.valueType,
      isProtected: definition.isProtected,
      requiresApproval: definition.requiresApproval,
    }));
  }

  // --- internals ----------------------------------------------------------

  private async create(
    actor: AuthContext,
    definition: SettingDefinition,
    branchId: string | null,
    value: unknown,
    input: {
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
      changeReason: string;
    },
    meta: RequestMeta,
  ): Promise<SettingRow> {
    try {
      const created = await this.prisma.setting.create({
        data: {
          orgId: actor.orgId,
          branchId,
          settingCode: definition.code,
          settingCategory: definition.category,
          valueType: definition.valueType,
          valueJson: value as never,
          effectiveFrom: input.effectiveFrom
            ? new Date(input.effectiveFrom)
            : null,
          effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
          status: 'ACTIVE',
          isProtected: definition.isProtected,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        },
      });

      await this.audit.record({
        orgId: actor.orgId,
        branchId,
        actorUserId: actor.userId,
        action: AuditAction.SETTING_CREATED,
        entityType: 'setting',
        entityId: created.settingId,
        newData: this.snapshot(created),
        metadata: {
          settingCode: definition.code,
          changeReason: input.changeReason,
        },
        ...meta,
      });

      return created;
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }
  }

  private async update(
    actor: AuthContext,
    definition: SettingDefinition,
    existing: SettingRow,
    value: unknown,
    input: {
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
      changeReason: string;
      expectedVersion?: number;
    },
    meta: RequestMeta,
  ): Promise<SettingRow> {
    if (input.expectedVersion === undefined) {
      throw new BadRequestException(
        'This form is out of date. Reload and try again.',
      );
    }

    const updated = await this.applyVersionedUpdate(
      actor,
      existing.settingId,
      input.expectedVersion,
      {
        valueJson: value,
        effectiveFrom: input.effectiveFrom
          ? new Date(input.effectiveFrom)
          : null,
        effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
        // Re-asserted from the registry on every write, so a definition that
        // becomes protected takes effect on the stored row too.
        isProtected: definition.isProtected,
      },
      meta,
      existing,
    );

    await this.audit.record({
      orgId: actor.orgId,
      branchId: existing.branchId,
      actorUserId: actor.userId,
      action: AuditAction.SETTING_UPDATED,
      entityType: 'setting',
      entityId: existing.settingId,
      oldData: this.snapshot(existing),
      newData: this.snapshot(updated),
      metadata: {
        settingCode: definition.code,
        changeReason: input.changeReason,
      },
      ...meta,
    });

    return updated;
  }

  /**
   * The optimistic lock (Scenarios 7, 48).
   *
   * A conditional `updateMany` rather than a read-compare-write: the comparison
   * and the write are one statement, so two callers cannot both observe version
   * 3 and both proceed. `count === 0` means somebody else got there first.
   */
  private async applyVersionedUpdate(
    actor: AuthContext,
    settingId: string,
    expectedVersion: number,
    data: Record<string, unknown>,
    meta: RequestMeta,
    previous: SettingRow,
  ): Promise<SettingRow> {
    const result = await this.prisma.setting.updateMany({
      where: { orgId: actor.orgId, settingId, version: expectedVersion },
      data: { ...data, updatedBy: actor.userId, version: { increment: 1 } },
    });

    if (result.count === 0) {
      await this.audit
        .record({
          orgId: actor.orgId,
          branchId: previous.branchId,
          actorUserId: actor.userId,
          action: AuditAction.SETTING_CONCURRENT_EDIT_REJECTED,
          entityType: 'setting',
          entityId: settingId,
          metadata: {
            settingCode: previous.settingCode,
            expected: expectedVersion,
            actual: previous.version,
          },
          ...meta,
        })
        .catch(() => undefined);
      throw new ConflictException(
        'This setting was changed by someone else. Reload and try again.',
      );
    }

    const refreshed = await this.prisma.setting.findUnique({
      where: { orgId_settingId: { orgId: actor.orgId, settingId } },
    });
    if (!refreshed) throw new NotFoundException(NOT_REACHABLE);
    return refreshed;
  }

  private async raiseChangeRequest(
    actor: AuthContext,
    definition: SettingDefinition,
    branchId: string | null,
    value: unknown,
    changeReason: string,
    existing: SettingRow | null,
    meta: RequestMeta,
  ): Promise<string> {
    const changeRequestNumber = await this.allocateChangeRequestNumber(
      actor.orgId,
    );

    const created = await this.prisma.settingChangeRequest.create({
      data: {
        orgId: actor.orgId,
        changeRequestNumber,
        branchId,
        settingId: existing?.settingId ?? null,
        settingCode: definition.code,
        requestedValueJson: value as never,
        // Zero when the request creates the setting: there is no prior version
        // to have raced with, and apply time checks for absence instead.
        baseVersion: existing?.version ?? 0,
        changeReason,
        status: 'PENDING_APPROVAL',
        requestedBy: actor.userId,
      },
    });

    await this.audit.record({
      orgId: actor.orgId,
      branchId,
      actorUserId: actor.userId,
      action: AuditAction.SETTING_CHANGE_SUBMITTED,
      entityType: 'setting_change_request',
      entityId: created.changeRequestId,
      newData: { settingCode: definition.code, changeRequestNumber },
      metadata: { changeReason, baseVersion: created.baseVersion },
      ...meta,
    });

    return created.changeRequestId;
  }

  /**
   * `CHG-000001` per organization.
   *
   * Ordered by the numeric suffix rather than lexically: `CHG-000010` sorts
   * before `CHG-000009` as a string, which would reissue a number already taken.
   * The unique constraint on `(orgId, changeRequestNumber)` is the real guard —
   * this only has to be right often enough to avoid retrying constantly.
   */
  private async allocateChangeRequestNumber(orgId: string): Promise<string> {
    const latest = await this.prisma.settingChangeRequest.findFirst({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      select: { changeRequestNumber: true },
    });

    const previous = latest
      ? Number.parseInt(latest.changeRequestNumber.replace(/^CHG-/, ''), 10)
      : 0;
    const next = Number.isFinite(previous) ? previous + 1 : 1;
    return `CHG-${String(next).padStart(6, '0')}`;
  }

  private requireDefinition(
    actor: AuthContext,
    code: string,
    meta: RequestMeta,
  ): SettingDefinition {
    const definition = getSettingDefinition(code);
    if (!definition) {
      // Not a 404: the code is not a resource that might exist elsewhere, it is
      // a value this system does not accept (Rules 8, 9; Scenario 60).
      void this.audit
        .record({
          orgId: actor.orgId,
          actorUserId: actor.userId,
          action: AuditAction.SETTING_REJECTED,
          entityType: 'setting',
          metadata: { settingCode: code, reason: 'Unsupported setting code' },
          ...meta,
        })
        .catch(() => undefined);
      throw new BadRequestException(
        'That setting is not supported by this system',
      );
    }
    return definition;
  }

  private resolveTargetBranch(
    actor: AuthContext,
    definition: SettingDefinition,
    requested: string | null,
    meta: RequestMeta,
  ): string | null {
    // An ORG-only definition is written at organization scope even for a
    // branch-confined caller — and `assertMayWrite` then refuses them, because
    // they hold only `settings.branch.manage`.
    if (definition.scope === 'ORG') {
      if (requested) {
        throw new BadRequestException(
          'This setting is configured for the whole organization, not per branch',
        );
      }
      return null;
    }

    if (definition.scope === 'BRANCH') {
      const branchId = requested ?? actor.branchId;
      if (!branchId) {
        throw new BadRequestException('Branch is required for this setting');
      }
      return resolveBranchScope(actor, branchId);
    }

    return requested
      ? resolveBranchScope(actor, requested)
      : (actor.branchId ?? null);
  }

  /**
   * Who may write this setting (Scenarios 44, 64).
   *
   * Authority comes from the DEFINITION, never from the row's `isProtected`
   * snapshot — see the class header for why that distinction is load-bearing.
   */
  private assertMayWrite(
    actor: AuthContext,
    definition: SettingDefinition,
    branchId: string | null,
    meta: RequestMeta,
  ): void {
    if (
      definition.isProtected &&
      !this.has(actor, SETTINGS_PROTECTED_MANAGE_PERMISSION)
    ) {
      void this.audit
        .record({
          orgId: actor.orgId,
          branchId,
          actorUserId: actor.userId,
          action: AuditAction.SETTING_PROTECTED_DENIED,
          entityType: 'setting',
          metadata: { settingCode: definition.code },
          ...meta,
        })
        .catch(() => undefined);
      throw new ForbiddenException(
        'You are not authorized to change protected settings',
      );
    }

    const needed = branchId
      ? SETTINGS_BRANCH_MANAGE_PERMISSION
      : SETTINGS_MANAGE_PERMISSION;

    // Organization-scope authority implies branch-scope authority; the reverse
    // is exactly what must not hold.
    const permitted =
      this.has(actor, needed) ||
      (branchId !== null && this.has(actor, SETTINGS_MANAGE_PERMISSION));

    if (!permitted) {
      void this.audit
        .record({
          orgId: actor.orgId,
          branchId,
          actorUserId: actor.userId,
          action: AuditAction.SETTING_SCOPE_DENIED,
          entityType: 'setting',
          metadata: { settingCode: definition.code, required: needed },
          ...meta,
        })
        .catch(() => undefined);
      throw new ForbiddenException(
        'You are not authorized to change this setting',
      );
    }
  }

  private has(actor: AuthContext, permission: string): boolean {
    return actor.permissions.includes(permission);
  }

  private assertEffectiveRange(from?: string | null, to?: string | null): void {
    if (from && to && to < from) {
      throw new BadRequestException(
        'Effective To must be on or after Effective From',
      );
    }
  }

  private async findInScope(
    actor: AuthContext,
    settingId: string,
  ): Promise<SettingRow> {
    const row = await this.prisma.setting.findFirst({
      where: { orgId: actor.orgId, settingId },
    });
    if (!row) throw new NotFoundException(NOT_REACHABLE);

    // A branch-confined caller may reach their own branch's rows and the
    // organization-wide ones, and nothing else (Scenarios 3, 46).
    if (actor.branchId && row.branchId && row.branchId !== actor.branchId) {
      throw new NotFoundException(NOT_REACHABLE);
    }
    return row;
  }

  private async auditBlocked(
    actor: AuthContext,
    row: SettingRow,
    reason: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.audit
      .record({
        orgId: actor.orgId,
        branchId: row.branchId,
        actorUserId: actor.userId,
        action: AuditAction.SETTING_DELETE_BLOCKED,
        entityType: 'setting',
        entityId: row.settingId,
        metadata: { settingCode: row.settingCode, reason },
        ...meta,
      })
      .catch(() => undefined);
  }

  private snapshot(row: SettingRow): Record<string, unknown> {
    return {
      settingCode: row.settingCode,
      branchId: row.branchId,
      value: row.valueJson,
      status: row.status,
      version: row.version,
      effectiveFrom: row.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
    };
  }

  private toDetail(row: SettingRow, actor: AuthContext): SettingDetail {
    const definition = getSettingDefinition(row.settingCode);

    // Masking follows the DEFINITION, so a row whose snapshot drifted from the
    // registry still masks correctly (Scenario 2).
    const isProtected = definition?.isProtected ?? row.isProtected;
    const mask =
      isProtected && !this.has(actor, SETTINGS_PROTECTED_MANAGE_PERMISSION);

    return {
      settingId: row.settingId,
      branchId: row.branchId,
      settingCode: row.settingCode,
      name: definition?.name ?? row.settingCode,
      description: definition?.description ?? '',
      category: row.settingCategory,
      valueType: row.valueType,
      value: mask ? MASKED : row.valueJson,
      isValueMasked: mask,
      effectiveFrom: row.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
      status: row.status,
      version: row.version,
      isProtected,
      requiresApproval: definition?.requiresApproval ?? false,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * P2002 is the partial unique index doing its job (Scenario 5).
   *
   * Translated here because an untranslated Prisma error surfaces through
   * `AllExceptionsFilter` as a 503 that names an unrelated service — see the
   * note in `audit.service.ts` about the same failure mode.
   */
  private translateUniqueViolation(error: unknown): unknown {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return new ConflictException(
        'A setting with this code already exists for this scope',
      );
    }
    return error;
  }
}
