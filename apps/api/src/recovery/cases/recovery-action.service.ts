import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { todayInKolkata, type CivilDate } from '@lms/emi';
import type { RecoveryActionRecord } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { formatPaise } from '../../common/export/money-format';
import { NotificationEventsService } from '../../notifications/ingestion/notification-events.service';
import { PrismaService } from '../../prisma/prisma.service';
import { toActionRecord } from '../recovery.mapper';
import { RecoveryCaseService } from './recovery-case.service';
import type {
  RecordRecoveryActionDto,
  UpdateRecoveryActionDto,
} from '../dto/recovery.dto';

export const RECOVERY_ACTIONS_RECORD_PERMISSION = 'recovery.actions.record';
export const RECOVERY_SYNC_PERMISSION = 'recovery.sync';

const NOT_REACHABLE = 'Recovery action not found';
const STALE =
  'This action has changed since you opened it. Reload and try again.';

/**
 * Module 13 — recovery activity.
 *
 * # Nothing here moves money
 *
 * Rule 15 is explicit: recovery actions do not create customer payment entries.
 * Recording a promise to pay stores an intention and reduces no balance
 * (Scenario 15); if the payment arrives it is posted through Module 11's
 * collection workflow like every other repayment, and this module has no
 * payment path at all.
 *
 * # The two cross-field rules live here, not in the DTO
 *
 * class-validator cannot express "required only when another field is present"
 * without `@ValidateIf`, which skips `@IsNotEmpty` on a required field and
 * silently accepts a missing value. So the promise pairing and the GPS evidence
 * rules are checked in this service — and held as database constraints
 * regardless, because a rule enforced in exactly one layer is a rule that
 * layer's next refactor can drop.
 *
 * # A failed GPS capture is never promoted
 *
 * What the device reported is written through unchanged. Rule 40 and Scenario
 * 30 turn on a failure staying a failure: synchronization must not turn one
 * into a success, so a claimed `VERIFIED` that names no verified check-in is
 * refused rather than downgraded, and a `FAILED` capture citing a check-in is
 * refused rather than upgraded.
 */
@Injectable()
export class RecoveryActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cases: RecoveryCaseService,
    // Module 16, from the @Global NotificationEventsModule.
    private readonly events: NotificationEventsService,
  ) {}

  /**
   * Records an activity against a case.
   *
   * # Offline replay
   *
   * `offlineActivityUuid` is minted by the device and unique per organization.
   * A retried synchronization after a lost response finds the original row and
   * returns it rather than creating a second (Scenario 28) — the same shape as
   * the collection module's offline identity, reusing its column semantics.
   */
  async record(
    actor: AuthContext,
    recoveryCaseId: string,
    dto: RecordRecoveryActionDto,
    meta: RequestMeta,
  ): Promise<RecoveryActionRecord> {
    const recoveryCase = await this.cases.findInScope(
      actor,
      recoveryCaseId,
      meta,
    );

    if (recoveryCase.status === 'CLOSED') {
      throw new ConflictException(
        'This case is closed. Reopen it before recording further activity.',
      );
    }

    this.assertPromiseIsWhole(dto);
    this.assertGpsEvidenceIsHonest(dto);

    // Scenario 28: a replayed sync returns the original.
    if (dto.offlineActivityUuid) {
      const replay = await this.prisma.recoveryAction.findFirst({
        where: {
          orgId: actor.orgId,
          offlineActivityUuid: dto.offlineActivityUuid,
        },
        include: { performedByUser: { select: { name: true } } },
      });

      if (replay) {
        // Scenario 29: an activity that arrives for a case whose state has
        // moved on is surfaced, not silently applied over the newer state.
        if (replay.recoveryCaseId !== recoveryCaseId) {
          await this.audit
            .record({
              orgId: actor.orgId,
              action: AuditAction.RECOVERY_SYNC_CONFLICT,
              entityType: 'RECOVERY_ACTION',
              entityId: replay.recoveryActionId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              metadata: {
                submittedCaseId: recoveryCaseId,
                storedCaseId: replay.recoveryCaseId,
              },
            })
            .catch(() => {});

          throw new ConflictException({
            message:
              'This activity was already recorded against a different case. The stored record is unchanged.',
            code: 'SYNC_CONFLICT',
            recoveryActionId: replay.recoveryActionId,
          });
        }

        await this.audit
          .record({
            orgId: actor.orgId,
            action: AuditAction.RECOVERY_SYNC_DUPLICATE_IGNORED,
            entityType: 'RECOVERY_ACTION',
            entityId: replay.recoveryActionId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
          })
          .catch(() => {});

        return toActionRecord(replay);
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.recoveryAction.create({
        data: {
          orgId: actor.orgId,
          recoveryCaseId,
          action: dto.actionType,
          actionDate: this.isoToDate(dto.actionDate),
          outcome: dto.outcome,
          performedBy: actor.userId,
          ...(dto.notes ? { notes: dto.notes } : {}),
          ...(dto.nextFollowUpDate
            ? { nextFollowUpDate: this.isoToDate(dto.nextFollowUpDate) }
            : {}),
          ...(dto.promiseToPayDate
            ? { promiseToPayDate: this.isoToDate(dto.promiseToPayDate) }
            : {}),
          ...(dto.promiseToPayAmountPaise
            ? {
                promiseToPayAmountPaise: BigInt(dto.promiseToPayAmountPaise),
              }
            : {}),
          ...(dto.offlineActivityUuid
            ? { offlineActivityUuid: dto.offlineActivityUuid }
            : {}),
          ...(dto.deviceId ? { deviceId: dto.deviceId } : {}),
          // Written through exactly as reported. Never promoted.
          ...(dto.gpsCaptureStatus
            ? { gpsCaptureStatus: dto.gpsCaptureStatus }
            : {}),
          ...(dto.gpsCheckInId ? { gpsCheckInId: dto.gpsCheckInId } : {}),
          ...(dto.customerAckReference
            ? { customerAckReference: dto.customerAckReference }
            : {}),
        },
        include: { performedByUser: { select: { name: true } } },
      });

      // A field visit moves the case along, so the worklist reflects what has
      // happened without an officer having to update a status by hand.
      if (
        dto.actionType === 'FIELD_VISIT' &&
        recoveryCase.status === 'FIELD_ASSIGNED'
      ) {
        await tx.recoveryCase.updateMany({
          where: { orgId: actor.orgId, recoveryCaseId },
          data: { status: 'FIELD_VISIT' },
        });
      }

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: dto.promiseToPayDate
            ? AuditAction.RECOVERY_PROMISE_RECORDED
            : AuditAction.RECOVERY_ACTION_RECORDED,
          entityType: 'RECOVERY_ACTION',
          entityId: row.recoveryActionId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            recoveryCaseId,
            actionType: dto.actionType,
            outcome: dto.outcome,
            ...(dto.promiseToPayAmountPaise
              ? { promiseToPayAmountPaise: dto.promiseToPayAmountPaise }
              : {}),
            ...(dto.offlineActivityUuid ? { synced: true } : {}),
          },
        },
        tx,
      );

      if (dto.gpsCaptureStatus === 'FAILED') {
        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.RECOVERY_GPS_CAPTURE_FAILED,
            entityType: 'RECOVERY_ACTION',
            entityId: row.recoveryActionId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            metadata: { deviceId: dto.deviceId },
          },
          tx,
        );
      }

      return row;
    });

    // Module 16, after commit (Rules 60-62).
    //
    // Only a promise to pay raises an event; the other outcomes are records of
    // a visit, not commitments anyone needs reminding about. The reminder
    // itself is raised later by the daily sweep, which reads the promise date —
    // this event is the acknowledgement that one was made.
    if (created.promiseToPayDate) {
      await this.events
        .emit(
          {
            orgId: actor.orgId,
            branchId: recoveryCase.branchId,
            eventType: 'PROMISE_TO_PAY_REMINDER',
            sourceModule: 'recovery',
            sourceRecordId: recoveryCase.recoveryCaseId,
            sourceVersion: created.recoveryActionId,
            payload: {
              caseNumber: recoveryCase.caseNumber,
              loanNumber: recoveryCase.loan?.loanNumber ?? '',
              customerName: recoveryCase.loan?.customer?.fullName ?? '',
              // DATE-only (Rules 26, 68; Scenario 36).
              promiseDate: created.promiseToPayDate.toISOString().slice(0, 10),
              amountPaise: (created.promiseToPayAmountPaise ?? 0n).toString(),
              amountFormatted: formatPaise(
                (created.promiseToPayAmountPaise ?? 0n).toString(),
              ),
            },
          },
          meta,
        )
        .catch(() => undefined);
    }

    return toActionRecord(created);
  }

  /**
   * Edits a pending action (Scenario 31).
   *
   * A finalized action is refused here *and* by the
   * `recovery_actions_append_only` trigger. Both, deliberately: the service
   * gives a message a user can act on, the trigger makes the rule true for
   * every writer including a future migration or a psql session.
   */
  async update(
    actor: AuthContext,
    recoveryActionId: string,
    dto: UpdateRecoveryActionDto,
    meta: RequestMeta,
  ): Promise<RecoveryActionRecord> {
    const before = await this.findInScope(actor, recoveryActionId, meta);

    if (before.finalizedAt) {
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.RECOVERY_ACTION_EDIT_BLOCKED,
          entityType: 'RECOVERY_ACTION',
          entityId: recoveryActionId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          metadata: { finalizedAt: before.finalizedAt.toISOString() },
        })
        .catch(() => {});

      throw new ConflictException(
        'This action is finalized. Record a follow-up action instead of editing it.',
      );
    }

    const expected = new Date(dto.expectedVersion);
    if (
      Number.isNaN(expected.getTime()) ||
      before.updatedAt.getTime() !== expected.getTime()
    ) {
      throw new ConflictException(STALE);
    }

    // The pairing rule applies to the merged result, not to the patch: clearing
    // one half of an existing promise must fail exactly as submitting half a
    // new one does.
    this.assertPromiseIsWhole({
      promiseToPayDate:
        dto.promiseToPayDate ??
        (before.promiseToPayDate
          ? before.promiseToPayDate.toISOString().slice(0, 10)
          : undefined),
      promiseToPayAmountPaise:
        dto.promiseToPayAmountPaise ??
        (before.promiseToPayAmountPaise !== null
          ? before.promiseToPayAmountPaise.toString()
          : undefined),
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.recoveryAction.updateMany({
        where: {
          orgId: actor.orgId,
          recoveryActionId,
          updatedAt: before.updatedAt,
          finalizedAt: null,
        },
        data: {
          ...(dto.outcome ? { outcome: dto.outcome } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.nextFollowUpDate
            ? { nextFollowUpDate: this.isoToDate(dto.nextFollowUpDate) }
            : {}),
          ...(dto.promiseToPayDate
            ? { promiseToPayDate: this.isoToDate(dto.promiseToPayDate) }
            : {}),
          ...(dto.promiseToPayAmountPaise
            ? { promiseToPayAmountPaise: BigInt(dto.promiseToPayAmountPaise) }
            : {}),
        },
      });

      if (guard.count === 0) throw new ConflictException(STALE);

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.RECOVERY_ACTION_UPDATED,
          entityType: 'RECOVERY_ACTION',
          entityId: recoveryActionId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: { outcome: before.outcome, notes: before.notes },
          newData: { outcome: dto.outcome ?? before.outcome },
        },
        tx,
      );

      return tx.recoveryAction.findFirstOrThrow({
        where: { orgId: actor.orgId, recoveryActionId },
        include: { performedByUser: { select: { name: true } } },
      });
    });

    return toActionRecord(updated);
  }

  /**
   * Finalizes an action, freezing it (Scenario 32).
   *
   * One-way. After this the trigger refuses every update and delete, and a
   * correction must be a follow-up action.
   */
  async finalize(
    actor: AuthContext,
    recoveryActionId: string,
    meta: RequestMeta,
  ): Promise<RecoveryActionRecord> {
    const before = await this.findInScope(actor, recoveryActionId, meta);

    if (before.finalizedAt) {
      throw new ConflictException('This action is already finalized.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.recoveryAction.updateMany({
        where: {
          orgId: actor.orgId,
          recoveryActionId,
          updatedAt: before.updatedAt,
          finalizedAt: null,
        },
        data: { finalizedAt: new Date() },
      });

      if (guard.count === 0) throw new ConflictException(STALE);

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.RECOVERY_ACTION_UPDATED,
          entityType: 'RECOVERY_ACTION',
          entityId: recoveryActionId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          metadata: { finalized: true },
        },
        tx,
      );

      return tx.recoveryAction.findFirstOrThrow({
        where: { orgId: actor.orgId, recoveryActionId },
        include: { performedByUser: { select: { name: true } } },
      });
    });

    return toActionRecord(updated);
  }

  async detail(
    actor: AuthContext,
    recoveryActionId: string,
    meta: RequestMeta,
  ): Promise<RecoveryActionRecord> {
    const row = await this.findInScope(actor, recoveryActionId, meta);
    return toActionRecord(row, this.isPromiseMissed(row, todayInKolkata()));
  }

  /**
   * An action the caller may reach, or a 404.
   *
   * Reached *through its case*, so the officer confinement and branch scope of
   * `RecoveryCaseService.findInScope` apply transitively — an officer cannot
   * read a colleague's activity by guessing an action id.
   */
  private async findInScope(
    actor: AuthContext,
    recoveryActionId: string,
    meta: RequestMeta,
  ): Promise<ActionRowWithUser> {
    const confinedToSelf = !actor.permissions.includes('recovery.cases.assign');

    const row = await this.prisma.recoveryAction.findFirst({
      where: {
        orgId: actor.orgId,
        recoveryActionId,
        recoveryCase: {
          ...(actor.branchId ? { branchId: actor.branchId } : {}),
          ...(confinedToSelf ? { assignedAgentId: actor.userId } : {}),
        },
      },
      include: { performedByUser: { select: { name: true } } },
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.RECOVERY_CASE_SCOPE_DENIED,
        entityType: 'RECOVERY_ACTION',
        entityId: recoveryActionId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { actorBranchId: actor.branchId, confinedToSelf },
      });

      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  /**
   * A promise is an amount and a date, or neither (Scenario 15).
   *
   * Half a promise cannot be followed up or checked against a payment, so it is
   * not a promise. The `recovery_actions_promise_paired` CHECK holds the same
   * rule at the database.
   */
  private assertPromiseIsWhole(dto: {
    promiseToPayDate?: string | undefined;
    promiseToPayAmountPaise?: string | undefined;
  }): void {
    const hasDate = dto.promiseToPayDate !== undefined;
    const hasAmount = dto.promiseToPayAmountPaise !== undefined;

    if (hasDate !== hasAmount) {
      throw new BadRequestException(
        'A promise to pay needs both an amount and a date. Record both, or neither.',
      );
    }

    if (hasAmount && BigInt(dto.promiseToPayAmountPaise ?? '0') <= 0n) {
      throw new BadRequestException(
        'A promise to pay must be for more than zero.',
      );
    }
  }

  /**
   * GPS evidence must say what actually happened (Rule 40, Scenario 30).
   *
   * A claimed `VERIFIED` with no check-in is refused rather than downgraded,
   * and a `FAILED` capture citing one is refused rather than upgraded. Silently
   * correcting either would be the system deciding what the device saw.
   */
  private assertGpsEvidenceIsHonest(dto: RecordRecoveryActionDto): void {
    if (dto.gpsCaptureStatus === 'FAILED' && dto.gpsCheckInId) {
      throw new BadRequestException(
        'A failed GPS capture cannot cite a verified check-in.',
      );
    }

    if (dto.gpsCaptureStatus === 'VERIFIED' && !dto.gpsCheckInId) {
      throw new BadRequestException(
        'A verified GPS capture must cite the check-in it came from.',
      );
    }
  }

  private isPromiseMissed(
    row: { promiseToPayDate: Date | null },
    today: CivilDate,
  ): boolean | undefined {
    if (!row.promiseToPayDate) return undefined;
    const promised = {
      year: row.promiseToPayDate.getUTCFullYear(),
      month: row.promiseToPayDate.getUTCMonth() + 1,
      day: row.promiseToPayDate.getUTCDate(),
    };
    if (promised.year !== today.year) return promised.year < today.year;
    if (promised.month !== today.month) return promised.month < today.month;
    return promised.day < today.day;
  }

  /** Midday, so no timezone conversion can move a DATE across a day boundary. */
  private isoToDate(value: string): Date {
    return new Date(`${value}T12:00:00+05:30`);
  }
}

type ActionRowWithUser = Parameters<typeof toActionRecord>[0] & {
  performedByUser: { name: string } | null;
};
