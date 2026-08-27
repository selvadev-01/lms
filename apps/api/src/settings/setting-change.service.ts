import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getSettingDefinition, validateSettingValue } from '@lms/validation';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { resolveBranchScope } from '../reports/report-scope';

export const SETTINGS_CHANGES_VIEW_PERMISSION = 'settings.changes.view';
export const SETTINGS_CHANGES_SUBMIT_PERMISSION = 'settings.changes.submit';
export const SETTINGS_CHANGES_APPROVE_PERMISSION = 'settings.changes.approve';

const NOT_REACHABLE = 'Configuration change request not found';

/**
 * States a change request can never leave (Scenario 13).
 *
 * Expressed as data rather than as a chain of `if` statements so the rule is one
 * thing to read and one thing to test. A request that has been rejected,
 * cancelled, applied or failed is spent: the remedy is a new request, not the
 * revival of an old one.
 */
const TERMINAL_STATUSES = new Set([
  'REJECTED',
  'CANCELLED',
  'APPLIED',
  'FAILED',
]);

interface ChangeRequestRow {
  changeRequestId: string;
  changeRequestNumber: string;
  branchId: string | null;
  settingId: string | null;
  settingCode: string;
  requestedValueJson: unknown;
  baseVersion: number;
  resultVersion: number | null;
  changeReason: string;
  status: string;
  requestedBy: string;
  submittedAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  appliedAt: Date | null;
  failureReason: string | null;
}

export interface ChangeRequestDetail {
  changeRequestId: string;
  changeRequestNumber: string;
  branchId: string | null;
  settingCode: string;
  settingName: string;
  requestedValue: unknown;
  baseVersion: number;
  resultVersion: number | null;
  changeReason: string;
  status: string;
  requestedBy: string;
  submittedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  appliedAt: string | null;
  failureReason: string | null;
}

/**
 * Maker-checker for protected configuration (Scenarios 9-13, 63).
 *
 * # Self-approval is refused with no escape hatch
 *
 * `approve` compares `requestedBy` to the acting user and refuses a match. There
 * is deliberately no policy flag permitting self-approval for "low-risk"
 * settings (spec Open Question 8, answered "no" for the MVP). A flag would mean
 * the separation of duties Rule 43 describes could be switched off by the same
 * administrator it constrains — and adding one later should be a deliberate,
 * visible change rather than a config value nobody notices.
 *
 * # Validation runs twice, and the second time is the one that matters
 *
 * A request is validated at submission and AGAIN at apply time, against both the
 * registry and the live row's version. An approval can arrive days after the
 * proposal, by which time the value may no longer be legal or the setting may
 * have moved. Applying on the strength of the submission-time check would let an
 * approval silently overwrite a newer value — the exact failure Scenario 63 asks
 * us to turn into a recorded, non-effective failure.
 */
@Injectable()
export class SettingChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthContext,
    filters: { status?: string; settingCode?: string },
  ): Promise<ChangeRequestDetail[]> {
    const branchScope = resolveBranchScope(actor);

    const rows = await this.prisma.settingChangeRequest.findMany({
      where: {
        orgId: actor.orgId,
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.settingCode ? { settingCode: filters.settingCode } : {}),
        ...(branchScope
          ? { OR: [{ branchId: branchScope }, { branchId: null }] }
          : {}),
      },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });

    return rows.map((row) => this.toDetail(row));
  }

  async get(
    actor: AuthContext,
    changeRequestId: string,
  ): Promise<ChangeRequestDetail> {
    return this.toDetail(await this.findInScope(actor, changeRequestId));
  }

  /**
   * Approve, and apply (Scenario 10).
   *
   * Approval and application are one transaction. Recording an approval that
   * then fails to apply would leave a request marked APPROVED whose value never
   * became effective — a state that looks successful in every list.
   */
  async approve(
    actor: AuthContext,
    changeRequestId: string,
    meta: RequestMeta,
  ): Promise<ChangeRequestDetail> {
    const request = await this.findInScope(actor, changeRequestId);
    this.assertPending(actor, request, meta);

    // Scenario 11. Checked before anything else mutates.
    if (request.requestedBy === actor.userId) {
      await this.audit
        .record({
          orgId: actor.orgId,
          branchId: request.branchId,
          actorUserId: actor.userId,
          action: AuditAction.SETTING_CHANGE_SELF_APPROVAL_DENIED,
          entityType: 'setting_change_request',
          entityId: changeRequestId,
          metadata: {
            settingCode: request.settingCode,
            changeRequestNumber: request.changeRequestNumber,
          },
          ...meta,
        })
        .catch(() => undefined);
      throw new ForbiddenException(
        'You cannot approve a configuration change you submitted yourself',
      );
    }

    const definition = getSettingDefinition(request.settingCode);
    if (!definition) {
      return this.failApply(
        actor,
        request,
        'That setting is no longer supported by this system',
        meta,
      );
    }

    // Apply-time revalidation — see the class header.
    const validated = validateSettingValue(
      request.settingCode,
      request.requestedValueJson,
    );
    if (!validated.ok) {
      return this.failApply(actor, request, validated.message, meta);
    }

    const live = await this.prisma.setting.findFirst({
      where: {
        orgId: actor.orgId,
        branchId: request.branchId,
        settingCode: request.settingCode,
      },
    });

    // The setting moved since the proposal was built. Refuse rather than
    // overwrite: the approver approved a diff from a version that no longer
    // exists (Scenario 63).
    if ((live?.version ?? 0) !== request.baseVersion) {
      return this.failApply(
        actor,
        request,
        live
          ? `This setting has changed since the request was submitted (expected version ${request.baseVersion}, found ${live.version}). Submit a new request.`
          : 'The setting this request targets no longer exists.',
        meta,
      );
    }

    const now = new Date();
    const applied = await this.prisma.$transaction(async (tx) => {
      const setting = live
        ? await tx.setting.update({
            where: {
              orgId_settingId: {
                orgId: actor.orgId,
                settingId: live.settingId,
              },
            },
            data: {
              valueJson: validated.value as never,
              version: { increment: 1 },
              updatedBy: actor.userId,
              isProtected: definition.isProtected,
            },
          })
        : await tx.setting.create({
            data: {
              orgId: actor.orgId,
              branchId: request.branchId,
              settingCode: definition.code,
              settingCategory: definition.category,
              valueType: definition.valueType,
              valueJson: validated.value as never,
              status: 'ACTIVE',
              isProtected: definition.isProtected,
              createdBy: request.requestedBy,
              updatedBy: actor.userId,
            },
          });

      const updated = await tx.settingChangeRequest.update({
        where: {
          orgId_changeRequestId: { orgId: actor.orgId, changeRequestId },
        },
        data: {
          status: 'APPLIED',
          approvedBy: actor.userId,
          approvedAt: now,
          appliedAt: now,
          settingId: setting.settingId,
          resultVersion: setting.version,
        },
      });

      // In the transaction: an approval that rolls back must not leave an audit
      // row claiming it happened.
      await this.audit.record(
        {
          orgId: actor.orgId,
          branchId: request.branchId,
          actorUserId: actor.userId,
          action: AuditAction.SETTING_CHANGE_APPROVED,
          entityType: 'setting_change_request',
          entityId: changeRequestId,
          oldData: { version: request.baseVersion },
          newData: { version: setting.version, value: setting.valueJson },
          metadata: {
            settingCode: request.settingCode,
            changeRequestNumber: request.changeRequestNumber,
            requestedBy: request.requestedBy,
          },
          ...meta,
        },
        tx,
      );

      await this.audit.record(
        {
          orgId: actor.orgId,
          branchId: request.branchId,
          actorUserId: actor.userId,
          action: AuditAction.SETTING_CHANGE_APPLIED,
          entityType: 'setting',
          entityId: setting.settingId,
          newData: { value: setting.valueJson, version: setting.version },
          metadata: { changeRequestNumber: request.changeRequestNumber },
          ...meta,
        },
        tx,
      );

      return updated;
    });

    return this.toDetail(applied);
  }

  /** Reject with a mandatory reason (Scenario 12). */
  async reject(
    actor: AuthContext,
    changeRequestId: string,
    rejectionReason: string,
    meta: RequestMeta,
  ): Promise<ChangeRequestDetail> {
    const request = await this.findInScope(actor, changeRequestId);
    this.assertPending(actor, request, meta);

    const updated = await this.prisma.settingChangeRequest.update({
      where: { orgId_changeRequestId: { orgId: actor.orgId, changeRequestId } },
      data: {
        status: 'REJECTED',
        rejectedBy: actor.userId,
        rejectedAt: new Date(),
        rejectionReason,
      },
    });

    await this.audit.record({
      orgId: actor.orgId,
      branchId: request.branchId,
      actorUserId: actor.userId,
      action: AuditAction.SETTING_CHANGE_REJECTED,
      entityType: 'setting_change_request',
      entityId: changeRequestId,
      metadata: {
        settingCode: request.settingCode,
        changeRequestNumber: request.changeRequestNumber,
        rejectionReason,
      },
      ...meta,
    });

    return this.toDetail(updated);
  }

  /**
   * Withdraw one's own pending request.
   *
   * Only the submitter may cancel: an approver who wants it gone rejects it,
   * which records a reason. Letting an approver cancel would give them a way to
   * dispose of a request without saying why.
   */
  async cancel(
    actor: AuthContext,
    changeRequestId: string,
    meta: RequestMeta,
  ): Promise<ChangeRequestDetail> {
    const request = await this.findInScope(actor, changeRequestId);
    this.assertPending(actor, request, meta);

    if (request.requestedBy !== actor.userId) {
      throw new ForbiddenException(
        'Only the user who submitted a change request may cancel it',
      );
    }

    const updated = await this.prisma.settingChangeRequest.update({
      where: { orgId_changeRequestId: { orgId: actor.orgId, changeRequestId } },
      data: { status: 'CANCELLED' },
    });

    await this.audit.record({
      orgId: actor.orgId,
      branchId: request.branchId,
      actorUserId: actor.userId,
      action: AuditAction.SETTING_CHANGE_CANCELLED,
      entityType: 'setting_change_request',
      entityId: changeRequestId,
      metadata: {
        settingCode: request.settingCode,
        changeRequestNumber: request.changeRequestNumber,
      },
      ...meta,
    });

    return this.toDetail(updated);
  }

  // --- internals ----------------------------------------------------------

  /**
   * Record an approved-but-unapplicable request as FAILED (Scenario 63).
   *
   * The request is spent and the previously active configuration stands. This is
   * a recorded outcome rather than a thrown error for the approver, because the
   * request genuinely reached a terminal state that must be visible in the queue
   * — but the caller still gets a 409 so the UI does not report success.
   */
  private async failApply(
    actor: AuthContext,
    request: ChangeRequestRow,
    reason: string,
    meta: RequestMeta,
  ): Promise<never> {
    await this.prisma.settingChangeRequest.update({
      where: {
        orgId_changeRequestId: {
          orgId: actor.orgId,
          changeRequestId: request.changeRequestId,
        },
      },
      data: {
        status: 'FAILED',
        approvedBy: actor.userId,
        approvedAt: new Date(),
        failureReason: reason,
      },
    });

    await this.audit
      .record({
        orgId: actor.orgId,
        branchId: request.branchId,
        actorUserId: actor.userId,
        action: AuditAction.SETTING_CHANGE_APPLY_FAILED,
        entityType: 'setting_change_request',
        entityId: request.changeRequestId,
        metadata: {
          settingCode: request.settingCode,
          changeRequestNumber: request.changeRequestNumber,
          reason,
        },
        ...meta,
      })
      .catch(() => undefined);

    throw new ConflictException(reason);
  }

  private assertPending(
    actor: AuthContext,
    request: ChangeRequestRow,
    meta: RequestMeta,
  ): void {
    if (!TERMINAL_STATUSES.has(request.status)) return;

    void this.audit
      .record({
        orgId: actor.orgId,
        branchId: request.branchId,
        actorUserId: actor.userId,
        action: AuditAction.SETTING_CHANGE_TERMINAL_TRANSITION_REJECTED,
        entityType: 'setting_change_request',
        entityId: request.changeRequestId,
        metadata: {
          settingCode: request.settingCode,
          status: request.status,
        },
        ...meta,
      })
      .catch(() => undefined);

    throw new ConflictException(
      `This change request is ${request.status.toLowerCase()} and can no longer be acted on.`,
    );
  }

  private async findInScope(
    actor: AuthContext,
    changeRequestId: string,
  ): Promise<ChangeRequestRow> {
    const row = await this.prisma.settingChangeRequest.findFirst({
      where: { orgId: actor.orgId, changeRequestId },
    });
    if (!row) throw new NotFoundException(NOT_REACHABLE);

    if (actor.branchId && row.branchId && row.branchId !== actor.branchId) {
      throw new NotFoundException(NOT_REACHABLE);
    }
    return row;
  }

  private toDetail(row: ChangeRequestRow): ChangeRequestDetail {
    const definition = getSettingDefinition(row.settingCode);
    return {
      changeRequestId: row.changeRequestId,
      changeRequestNumber: row.changeRequestNumber,
      branchId: row.branchId,
      settingCode: row.settingCode,
      settingName: definition?.name ?? row.settingCode,
      requestedValue: row.requestedValueJson,
      baseVersion: row.baseVersion,
      resultVersion: row.resultVersion,
      changeReason: row.changeReason,
      status: row.status,
      requestedBy: row.requestedBy,
      submittedAt: row.submittedAt.toISOString(),
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectedBy: row.rejectedBy,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      appliedAt: row.appliedAt?.toISOString() ?? null,
      failureReason: row.failureReason,
    };
  }
}
