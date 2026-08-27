import { createHash, randomUUID } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { todayInKolkata, type CivilDate } from '@lms/emi';
import type {
  RecoveryBlocker,
  RecoveryCaseDetail,
  RecoveryCaseListResult,
  RecoveryCaseStatus,
  RecoveryPriority,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { LoanService } from '../../loans/shared/loan.service';
import { NotificationEventsService } from '../../notifications/ingestion/notification-events.service';
import {
  OverdueService,
  OVERDUE_LOAN_INCLUDE,
} from '../overdue/overdue.service';
import {
  RECOVERY_CASE_INCLUDE,
  toActionRecord,
  toAssignmentRecord,
  toCaseSummary,
  toLegalNoticeRecord,
  toSettlementRecord,
} from '../recovery.mapper';
import { nextRecoveryCaseNumber } from '../recovery-numbering';
import type {
  AssignRecoveryCaseDto,
  CloseRecoveryCaseDto,
  EscalateRecoveryCaseDto,
  ListRecoveryCasesDto,
  OpenRecoveryCaseDto,
} from '../dto/recovery.dto';

export const RECOVERY_CASES_VIEW_PERMISSION = 'recovery.cases.view';
export const RECOVERY_CASES_CREATE_PERMISSION = 'recovery.cases.create';
export const RECOVERY_CASES_ASSIGN_PERMISSION = 'recovery.cases.assign';
export const RECOVERY_CASES_ESCALATE_PERMISSION = 'recovery.cases.escalate';
export const RECOVERY_CASES_CLOSE_PERMISSION = 'recovery.cases.close';

const NOT_REACHABLE = 'Recovery case not found';
const STALE =
  'This recovery case has changed since you opened it. Reload and try again.';

/**
 * Loan statuses against which an *ordinary* recovery action may be taken.
 *
 * Scenario 41: a foreclosed, closed or written-off loan has its own lifecycle
 * and ordinary recovery must not contradict it. `WRITTEN_OFF` is absent
 * deliberately even though Rule 28 permits post-write-off recovery tracking —
 * that path exists, but it is the write-off workflow's, not this one's.
 */
const RECOVERABLE_LOAN_STATUSES = [
  'ACTIVE',
  'OVERDUE',
  'NPA',
  'LEGAL_ESCALATION',
] as const;

/** Case statuses that still count as open. */
const OPEN_CASE_STATUSES = [
  'OPEN',
  'FIELD_ASSIGNED',
  'FIELD_VISIT',
  'BRANCH_REVIEW',
  'LEGAL_NOTICE',
  'SETTLEMENT_PENDING',
  'LEGAL_ACTION',
] as const;

/**
 * Module 13 — recovery case lifecycle.
 *
 * # The load-bearing properties
 *
 * 1. **Assignment history is append-only.** Every assignment writes a
 *    `RecoveryCaseAssignment` row; `assignedAgentId` on the case is a
 *    denormalised pointer at the newest one. Rule 25 and Scenarios 10 and 54
 *    all turn on the history surviving a reassignment, which a single mutable
 *    column cannot do.
 * 2. **Scope is a 404, never a 403.** A 403 would confirm the case exists,
 *    which is the disclosure Scenarios 45 to 47 are about. Every denial is
 *    audited.
 * 3. **A Recovery Officer without assignment authority sees only their own
 *    cases.** Confinement is applied here, server-side, not by the client
 *    filtering — the permission grants the action, never the reach.
 * 4. **`expectedVersion` is enforced twice**: an `assertVersion` pre-check for
 *    a readable message, and a guarded `updateMany` inside the transaction that
 *    is the actual guarantee (Scenarios 12, 52).
 * 5. **Nothing here moves money.** Recording a promise to pay changes no
 *    balance (Rule 15, Scenario 15); a recovery payment goes through Module
 *    11's collection workflow, and this module deliberately has no payment path
 *    of its own.
 */
@Injectable()
export class RecoveryCaseService {
  private readonly logger = new Logger(RecoveryCaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly loans: LoanService,
    private readonly overdue: OverdueService,
    // Module 16. Resolved from the @Global NotificationEventsModule, so this
    // module needs no `imports` entry and acquires no dependency on the
    // notification pipeline — which is what keeps the graph acyclic.
    private readonly events: NotificationEventsService,
  ) {}

  async list(
    actor: AuthContext,
    query: ListRecoveryCasesDto,
    meta: RequestMeta,
  ): Promise<RecoveryCaseListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    // An officer who cannot assign is confined to the cases assigned to them.
    // Server-side, because a client-side filter is not a control.
    const confinedToSelf = !actor.permissions.includes(
      RECOVERY_CASES_ASSIGN_PERMISSION,
    );

    const where = {
      orgId: actor.orgId,
      ...(actor.branchId ? { branchId: actor.branchId } : {}),
      ...(confinedToSelf ? { assignedAgentId: actor.userId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assigneeUserId && !confinedToSelf
        ? { assignedAgentId: query.assigneeUserId }
        : {}),
      ...(query.search
        ? {
            OR: [
              {
                caseNumber: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                loan: {
                  loanNumber: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.recoveryCase.findMany({
        where,
        include: RECOVERY_CASE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.recoveryCase.count({ where }),
    ]);

    const items = await Promise.all(
      rows.map(async (row) =>
        toCaseSummary(row, await this.overdueFor(row.loanId)),
      ),
    );

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.RECOVERY_CASE_LISTED,
      entityType: 'RECOVERY_CASE',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { count: total, confinedToSelf },
    });

    return { items, total, page, pageSize };
  }

  async detail(
    actor: AuthContext,
    recoveryCaseId: string,
    meta: RequestMeta,
  ): Promise<RecoveryCaseDetail> {
    const row = await this.findInScope(actor, recoveryCaseId, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.RECOVERY_CASE_VIEWED,
      entityType: 'RECOVERY_CASE',
      entityId: recoveryCaseId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const overdue = await this.overdue.detail(actor, row.loanId, meta);
    const today = todayInKolkata();

    return {
      ...toCaseSummary(row, overdue),
      loanStatus: overdue.loanStatus,
      assignments: row.assignments.map(toAssignmentRecord),
      actions: row.actions.map((action) =>
        toActionRecord(action, this.isPromiseMissed(action, today)),
      ),
      legalNotices: row.legalNotices.map(toLegalNoticeRecord),
      settlements: row.settlements.map(toSettlementRecord),
      penalties: overdue.penalties,
      overdue,
      ...(row.resolutionType
        ? {
            resolutionType:
              row.resolutionType as RecoveryCaseDetail['resolutionType'],
          }
        : {}),
      ...(row.closureReason ? { closureReason: row.closureReason } : {}),
      ...(row.closedBy ? { closedBy: row.closedBy } : {}),
      ...(row.closedByUser?.name
        ? { closedByName: row.closedByUser.name }
        : {}),
      ...(row.outstandingBeforePaise !== null
        ? { outstandingBeforePaise: row.outstandingBeforePaise.toString() }
        : {}),
      ...(row.recoveredAmountPaise !== null
        ? { recoveredAmountPaise: row.recoveredAmountPaise.toString() }
        : {}),
      ...(row.remainingOutstandingPaise !== null
        ? {
            remainingOutstandingPaise: row.remainingOutstandingPaise.toString(),
          }
        : {}),
      ...(row.approvalReference
        ? { approvalReference: row.approvalReference }
        : {}),
      ...(row.escalatedAt
        ? { escalatedAt: row.escalatedAt.toISOString() }
        : {}),
      ...(row.escalationReason
        ? { escalationReason: row.escalationReason }
        : {}),
      ...(row.createdBy ? { createdBy: row.createdBy } : {}),
    };
  }

  /**
   * Opens a case against an overdue loan.
   *
   * The idempotency replay check runs **before** the eligibility gates, on the
   * Module 11 precedent: a retry of a request that already succeeded must
   * return the original result even if the loan has since become ineligible.
   * Checking eligibility first would make a successful retry fail.
   */
  async open(
    actor: AuthContext,
    dto: OpenRecoveryCaseDto,
    meta: RequestMeta,
  ): Promise<RecoveryCaseDetail> {
    await this.loans.findInScope(actor, dto.loanId, meta);

    const fingerprint = this.fingerprintOf(dto);

    const replay = await this.prisma.recoveryCase.findFirst({
      where: { orgId: actor.orgId, idempotencyKey: dto.idempotencyKey },
    });

    if (replay) {
      if (replay.requestFingerprint !== fingerprint) {
        await this.audit
          .record({
            orgId: actor.orgId,
            action: AuditAction.RECOVERY_CASE_IDEMPOTENCY_CONFLICT,
            entityType: 'RECOVERY_CASE',
            entityId: replay.recoveryCaseId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            metadata: { loanId: dto.loanId },
          })
          .catch(() => {});

        throw new ConflictException({
          message:
            'That idempotency key was already used for a different case. The original is unchanged.',
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          recoveryCaseId: replay.recoveryCaseId,
        });
      }

      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.RECOVERY_CASE_DUPLICATE_IGNORED,
          entityType: 'RECOVERY_CASE',
          entityId: replay.recoveryCaseId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
        })
        .catch(() => {});

      return this.detail(actor, replay.recoveryCaseId, meta);
    }

    const today = todayInKolkata();

    const recoveryCaseId = await this.prisma.$transaction(async (tx) => {
      const loan = await tx.loan.findFirst({
        where: {
          orgId: actor.orgId,
          loanId: dto.loanId,
          ...(actor.branchId ? { branchId: actor.branchId } : {}),
        },
        include: OVERDUE_LOAN_INCLUDE,
      });

      if (!loan) throw new NotFoundException('Loan not found');

      const blockers = this.openBlockers(loan);
      if (blockers.length > 0) {
        await this.audit
          .record({
            orgId: actor.orgId,
            action: AuditAction.RECOVERY_CASE_BLOCKED,
            entityType: 'RECOVERY_CASE',
            entityId: dto.loanId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            metadata: { blockers: blockers.map((blocker) => blocker.key) },
          })
          .catch(() => {});

        throw new ConflictException({
          message: blockers[0]?.reason ?? 'This loan cannot enter recovery.',
          blockers,
        });
      }

      const caseNumber = await nextRecoveryCaseNumber(
        tx,
        actor.orgId,
        loan.branch?.code ?? 'GEN',
      );

      const position = this.overdue.deriveSummary(loan, today);
      const id = randomUUID();

      await tx.recoveryCase.create({
        data: {
          orgId: actor.orgId,
          recoveryCaseId: id,
          caseNumber,
          loanId: loan.loanId,
          branchId: loan.branchId,
          status: 'OPEN',
          priority: dto.priority ?? 'MEDIUM',
          // The *derived* eligibility is recorded as the opening
          // classification. Moving the loan itself to NPA is a separate,
          // authorized act (Rule 29) and is not done here.
          npaStatus: position.npaEligibility,
          openedDate: this.civilToDate(today),
          createdBy: actor.userId,
          idempotencyKey: dto.idempotencyKey,
          requestFingerprint: fingerprint,
        },
      });

      if (dto.notes) {
        await tx.recoveryAction.create({
          data: {
            orgId: actor.orgId,
            recoveryCaseId: id,
            action: 'REMINDER',
            actionDate: this.civilToDate(today),
            outcome: 'ESCALATION_REQUIRED',
            performedBy: actor.userId,
            notes: dto.notes,
          },
        });
      }

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.RECOVERY_CASE_OPENED,
          entityType: 'RECOVERY_CASE',
          entityId: id,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            loanId: loan.loanId,
            caseNumber,
            daysPastDue: position.daysPastDue,
            totalOverduePaise: position.totalOverduePaise,
          },
        },
        tx,
      );

      return id;
    });

    return this.detail(actor, recoveryCaseId, meta);
  }

  /**
   * Assigns or reassigns a case.
   *
   * One method for both: the act is identical, and whether anyone held the case
   * before is a fact the server already knows. The history row is what makes
   * the difference visible afterwards.
   */
  async assign(
    actor: AuthContext,
    recoveryCaseId: string,
    dto: AssignRecoveryCaseDto,
    meta: RequestMeta,
  ): Promise<RecoveryCaseDetail> {
    const before = await this.findInScope(actor, recoveryCaseId, meta);
    this.assertVersion(actor, before, dto.expectedVersion, meta);

    if (before.status === 'CLOSED') {
      throw new ConflictException(
        'This case is closed. Reopen it before assigning it.',
      );
    }

    if (before.assignedAgentId === dto.assigneeUserId) {
      throw new ConflictException('That officer already holds this case.');
    }

    await this.prisma.$transaction(async (tx) => {
      // Scenario 11: an inactive officer cannot receive a new assignment, and
      // the check runs inside the transaction so a deactivation racing the
      // assignment cannot slip through.
      const assignee = await tx.user.findFirst({
        where: {
          orgId: actor.orgId,
          userId: dto.assigneeUserId,
          ...(actor.branchId ? { branchId: actor.branchId } : {}),
        },
        select: { status: true, name: true },
      });

      if (!assignee) {
        throw new NotFoundException(
          'That recovery officer is not available in this branch.',
        );
      }

      if (assignee.status !== 'ACTIVE') {
        await this.audit
          .record({
            orgId: actor.orgId,
            action: AuditAction.RECOVERY_CASE_ASSIGNMENT_REFUSED,
            entityType: 'RECOVERY_CASE',
            entityId: recoveryCaseId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            metadata: {
              assigneeUserId: dto.assigneeUserId,
              assigneeStatus: assignee.status,
            },
          })
          .catch(() => {});

        throw new ConflictException(
          'That recovery officer is inactive and cannot receive new assignments.',
        );
      }

      // The guarded update is the real concurrency guarantee: two users who
      // both opened this case cannot both win (Scenario 12).
      const guard = await tx.recoveryCase.updateMany({
        where: {
          orgId: actor.orgId,
          recoveryCaseId,
          updatedAt: before.updatedAt,
        },
        data: {
          assignedAgentId: dto.assigneeUserId,
          assignmentDate: this.civilToDate(todayInKolkata()),
          status: before.status === 'OPEN' ? 'FIELD_ASSIGNED' : before.status,
        },
      });

      if (guard.count === 0) throw new ConflictException(STALE);

      // The history row. Append-only by trigger, so this is the record Rule 25
      // requires and nothing can later rewrite it.
      await tx.recoveryCaseAssignment.create({
        data: {
          orgId: actor.orgId,
          recoveryCaseId,
          ...(before.assignedAgentId
            ? { fromUserId: before.assignedAgentId }
            : {}),
          toUserId: dto.assigneeUserId,
          assignedBy: actor.userId,
          ...(dto.reason ? { reason: dto.reason } : {}),
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: before.assignedAgentId
            ? AuditAction.RECOVERY_CASE_REASSIGNED
            : AuditAction.RECOVERY_CASE_ASSIGNED,
          entityType: 'RECOVERY_CASE',
          entityId: recoveryCaseId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          // Scenario 54 requires both the previous and the new assignee.
          oldData: { assignedAgentId: before.assignedAgentId },
          newData: { assignedAgentId: dto.assigneeUserId },
          metadata: { reason: dto.reason },
        },
        tx,
      );
    });

    // Module 16. After commit, never inside (Rules 6, 7, 60-62; Scenarios 25,
    // 31, 35). The assignment has already happened; a notification failure must
    // not undo it. `emit` never throws, and the `.catch` makes that visible at
    // the call site rather than something a reader has to go and verify.
    //
    // The recipient is resolved from the authoritative assignment at processing
    // time (Scenario 16), so the payload carries no recipient — only what the
    // template renders. `sourceVersion` is the case's new version, which is what
    // makes a reassignment a distinct event from this one rather than a replay.
    await this.events
      .emit(
        {
          orgId: actor.orgId,
          branchId: before.branchId,
          eventType: 'RECOVERY_ASSIGNED',
          sourceModule: 'recovery',
          sourceRecordId: recoveryCaseId,
          sourceVersion: dto.assigneeUserId,
          payload: {
            caseNumber: before.caseNumber,
            loanNumber: before.loan?.loanNumber ?? '',
            customerName: before.loan?.customer?.fullName ?? '',
            priority: before.priority,
            reason: dto.reason ?? '',
          },
        },
        meta,
      )
      .catch(() => undefined);

    return this.detail(actor, recoveryCaseId, meta);
  }

  async escalate(
    actor: AuthContext,
    recoveryCaseId: string,
    dto: EscalateRecoveryCaseDto,
    meta: RequestMeta,
  ): Promise<RecoveryCaseDetail> {
    const before = await this.findInScope(actor, recoveryCaseId, meta);
    this.assertVersion(actor, before, dto.expectedVersion, meta);

    if (before.status === 'CLOSED') {
      throw new ConflictException('A closed case cannot be escalated.');
    }

    await this.prisma.$transaction(async (tx) => {
      const guard = await tx.recoveryCase.updateMany({
        where: {
          orgId: actor.orgId,
          recoveryCaseId,
          updatedAt: before.updatedAt,
        },
        data: {
          status: 'BRANCH_REVIEW',
          priority: this.raisePriority(before.priority),
          escalatedAt: new Date(),
          escalationReason: dto.reason,
        },
      });

      if (guard.count === 0) throw new ConflictException(STALE);

      await tx.recoveryAction.create({
        data: {
          orgId: actor.orgId,
          recoveryCaseId,
          action: 'BRANCH_REVIEW',
          actionDate: this.civilToDate(todayInKolkata()),
          outcome: 'ESCALATION_REQUIRED',
          performedBy: actor.userId,
          notes: dto.reason,
          // Escalation is a decision, not a draft. Frozen immediately so the
          // prior history cannot be rewritten (Scenario 38).
          finalizedAt: new Date(),
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.RECOVERY_CASE_ESCALATED,
          entityType: 'RECOVERY_CASE',
          entityId: recoveryCaseId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: { status: before.status, priority: before.priority },
          newData: { status: 'BRANCH_REVIEW' },
          metadata: { reason: dto.reason },
        },
        tx,
      );
    });

    return this.detail(actor, recoveryCaseId, meta);
  }

  /**
   * Closes a case.
   *
   * # Why the closure figures are read here rather than accepted
   *
   * Scenario 39 requires the closure record to preserve what was recovered and
   * what remains. Both are read from the authoritative position inside the
   * closing transaction: a form that named them could close a case against
   * figures that were never true, and the `recovery_cases_closure_sums` CHECK
   * would then refuse the write anyway.
   *
   * All four closure columns are written in the **same** statement as the
   * status, because `recovery_cases_closure_complete` is evaluated per
   * statement — a status-then-fill-in ordering would fail the constraint even
   * inside one transaction.
   */
  async close(
    actor: AuthContext,
    recoveryCaseId: string,
    dto: CloseRecoveryCaseDto,
    meta: RequestMeta,
  ): Promise<RecoveryCaseDetail> {
    const before = await this.findInScope(actor, recoveryCaseId, meta);
    this.assertVersion(actor, before, dto.expectedVersion, meta);

    if (before.status === 'CLOSED') {
      throw new ConflictException('This case is already closed.');
    }

    const today = todayInKolkata();
    const blockers = this.closureBlockers(before, dto);

    if (blockers.length > 0) {
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.RECOVERY_CASE_CLOSURE_BLOCKED,
          entityType: 'RECOVERY_CASE',
          entityId: recoveryCaseId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          metadata: { blockers: blockers.map((blocker) => blocker.key) },
        })
        .catch(() => {});

      throw new ConflictException({
        message: blockers[0]?.reason ?? 'This case cannot be closed yet.',
        blockers,
      });
    }

    const position = await this.overdueFor(before.loanId);
    const outstandingBefore = BigInt(position.totalOverduePaise);

    await this.prisma.$transaction(async (tx) => {
      const guard = await tx.recoveryCase.updateMany({
        where: {
          orgId: actor.orgId,
          recoveryCaseId,
          updatedAt: before.updatedAt,
        },
        // Every closure column in one statement — see the doc comment.
        data: {
          status: 'CLOSED',
          closedDate: this.civilToDate(today),
          closedBy: actor.userId,
          closureReason: dto.closureReason,
          resolutionType: dto.resolutionType,
          outstandingBeforePaise: outstandingBefore,
          recoveredAmountPaise: 0n,
          remainingOutstandingPaise: outstandingBefore,
          ...(dto.approvalReference
            ? { approvalReference: dto.approvalReference }
            : {}),
        },
      });

      if (guard.count === 0) throw new ConflictException(STALE);

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.RECOVERY_CASE_CLOSED,
          entityType: 'RECOVERY_CASE',
          entityId: recoveryCaseId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: { status: before.status },
          newData: {
            status: 'CLOSED',
            resolutionType: dto.resolutionType,
            remainingOutstandingPaise: outstandingBefore.toString(),
          },
          metadata: { closureReason: dto.closureReason },
        },
        tx,
      );
    });

    return this.detail(actor, recoveryCaseId, meta);
  }

  /**
   * A case the caller may reach, or a 404.
   *
   * The same four rules as `LoanService.findInScope`, plus the officer
   * confinement: someone without assignment authority reaches only their own
   * cases, so a Recovery Officer cannot read a colleague's by guessing an id
   * (Scenario 4).
   */
  async findInScope(
    actor: AuthContext,
    recoveryCaseId: string,
    meta: RequestMeta,
  ): Promise<CaseWithRelations> {
    const confinedToSelf = !actor.permissions.includes(
      RECOVERY_CASES_ASSIGN_PERMISSION,
    );

    const row = await this.prisma.recoveryCase.findFirst({
      where: {
        orgId: actor.orgId,
        recoveryCaseId,
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
        ...(confinedToSelf ? { assignedAgentId: actor.userId } : {}),
      },
      include: RECOVERY_CASE_INCLUDE,
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.RECOVERY_CASE_SCOPE_DENIED,
        entityType: 'RECOVERY_CASE',
        entityId: recoveryCaseId,
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

  /** Why a loan may not enter recovery. */
  private openBlockers(loan: {
    status: string;
    recoveryCases: { status: string }[];
  }): RecoveryBlocker[] {
    const blockers: RecoveryBlocker[] = [];

    if (
      !RECOVERABLE_LOAN_STATUSES.includes(
        loan.status as (typeof RECOVERABLE_LOAN_STATUSES)[number],
      )
    ) {
      blockers.push({
        key: 'LOAN_NOT_RECOVERABLE',
        reason:
          loan.status === 'WRITTEN_OFF'
            ? 'This loan is written off. Post-write-off recovery follows its own workflow.'
            : `A ${loan.status.toLowerCase().replace(/_/g, ' ')} loan cannot enter ordinary recovery.`,
      });
    }

    if (
      loan.recoveryCases.some((row) =>
        OPEN_CASE_STATUSES.includes(
          row.status as (typeof OPEN_CASE_STATUSES)[number],
        ),
      )
    ) {
      blockers.push({
        key: 'CASE_ALREADY_OPEN',
        reason:
          'This loan already has an open recovery case. Work that one rather than opening a second.',
      });
    }

    return blockers;
  }

  /**
   * Why a case may not be closed (Scenario 40).
   *
   * A pending settlement is the blocking condition the source names: closing
   * over one would leave an approved reduction with nothing to apply it to.
   */
  private closureBlockers(
    row: CaseWithRelations,
    dto: CloseRecoveryCaseDto,
  ): RecoveryBlocker[] {
    const blockers: RecoveryBlocker[] = [];

    const pendingSettlement = row.settlements.some(
      (settlement) =>
        settlement.status === 'PENDING_APPROVAL' ||
        settlement.status === 'APPROVED',
    );

    if (pendingSettlement) {
      blockers.push({
        key: 'SETTLEMENT_UNRESOLVED',
        reason:
          'A settlement on this case is still open. Complete or reject it before closing.',
      });
    }

    if (dto.resolutionType === 'SETTLED') {
      const completed = row.settlements.some(
        (settlement) => settlement.status === 'COMPLETED',
      );
      if (!completed) {
        blockers.push({
          key: 'NO_COMPLETED_SETTLEMENT',
          reason:
            'Closing as settled needs a completed settlement on the case.',
        });
      }
    }

    const activeNotice = row.legalNotices.some(
      (notice) => notice.status === 'ACTIVE',
    );
    if (activeNotice) {
      blockers.push({
        key: 'LEGAL_NOTICE_ACTIVE',
        reason:
          'A legal notice on this case is still active. Resolve it before closing.',
      });
    }

    return blockers;
  }

  /**
   * Whether a promise has been broken (Scenario 16).
   *
   * Derived, never stored: both halves — whether the date has passed and
   * whether a payment landed — change without anyone touching the action row.
   */
  private isPromiseMissed(
    action: { promiseToPayDate: Date | null },
    today: CivilDate,
  ): boolean | undefined {
    if (!action.promiseToPayDate) return undefined;
    const promised = {
      year: action.promiseToPayDate.getUTCFullYear(),
      month: action.promiseToPayDate.getUTCMonth() + 1,
      day: action.promiseToPayDate.getUTCDate(),
    };
    if (promised.year !== today.year) return promised.year < today.year;
    if (promised.month !== today.month) return promised.month < today.month;
    return promised.day < today.day;
  }

  /** The derived overdue figures a case summary carries. */
  private async overdueFor(loanId: string): Promise<{
    totalOverduePaise: string;
    daysPastDue: number;
    bucket: string;
  }> {
    const loan = await this.prisma.loan.findFirst({
      where: { loanId },
      include: OVERDUE_LOAN_INCLUDE,
    });

    if (!loan) {
      return { totalOverduePaise: '0', daysPastDue: 0, bucket: 'CURRENT' };
    }

    const position = this.overdue.deriveSummary(loan, todayInKolkata());
    return {
      totalOverduePaise: position.totalOverduePaise,
      daysPastDue: position.daysPastDue,
      bucket: position.bucket,
    };
  }

  /**
   * The pre-check that turns a stale submit into a readable message.
   *
   * Not the guarantee — the guarded `updateMany` inside each transaction is.
   * This exists so the common case reports "reload and try again" rather than
   * an opaque zero-row update.
   */
  private assertVersion(
    actor: AuthContext,
    row: { recoveryCaseId: string; updatedAt: Date },
    expectedVersion: string,
    meta: RequestMeta,
  ): void {
    const expected = new Date(expectedVersion);

    if (
      Number.isNaN(expected.getTime()) ||
      row.updatedAt.getTime() !== expected.getTime()
    ) {
      void this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.RECOVERY_CASE_CONCURRENT_ATTEMPT_REJECTED,
          entityType: 'RECOVERY_CASE',
          entityId: row.recoveryCaseId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          metadata: {
            expectedVersion,
            actualVersion: row.updatedAt.toISOString(),
          },
        })
        .catch(() => {});

      throw new ConflictException(STALE);
    }
  }

  private raisePriority(current: string): 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (current === 'LOW') return 'MEDIUM';
    if (current === 'MEDIUM') return 'HIGH';
    return 'CRITICAL';
  }

  /**
   * SHA-256 of the fields that materially distinguish one request.
   *
   * `notes` is excluded deliberately, on `Collection.requestFingerprint`'s
   * precedent: a corrected typo in a note is not a different case.
   */
  private fingerprintOf(dto: OpenRecoveryCaseDto): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          loanId: dto.loanId,
          priority: dto.priority ?? 'MEDIUM',
        }),
      )
      .digest('hex');
  }

  /** Midday, so no timezone conversion can move a DATE across a day boundary. */
  private civilToDate(date: CivilDate): Date {
    const month = String(date.month).padStart(2, '0');
    const day = String(date.day).padStart(2, '0');
    return new Date(`${date.year}-${month}-${day}T12:00:00+05:30`);
  }
}

/**
 * A case row with everything `RECOVERY_CASE_INCLUDE` pulls in.
 *
 * Hand-written rather than `Prisma.RecoveryCaseGetPayload`, matching how every
 * other service in this codebase declares its row shapes (`LoanWithRelations`,
 * the mapper's row types). The relation fields are the ones the include names;
 * the mappers assert the rest.
 */
export type CaseWithRelations = {
  recoveryCaseId: string;
  caseNumber: string | null;
  loanId: string;
  branchId: string;
  /**
   * The enum unions, not `string`. Prisma's update input rejects a widened
   * `string`, and narrowing here is what lets `status` be carried forward
   * unchanged in an update rather than re-derived or cast at each call site.
   */
  status: RecoveryCaseStatus;
  priority: RecoveryPriority;
  npaStatus: string;
  openedDate: Date;
  closedDate: Date | null;
  assignedAgentId: string | null;
  assignmentDate: Date | null;
  createdBy: string | null;
  closedBy: string | null;
  closureReason: string | null;
  resolutionType: string | null;
  outstandingBeforePaise: bigint | null;
  recoveredAmountPaise: bigint | null;
  remainingOutstandingPaise: bigint | null;
  approvalReference: string | null;
  escalatedAt: Date | null;
  escalationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  loan: {
    loanNumber: string;
    customerId: string;
    status: string;
    customer: { fullName: string } | null;
  } | null;
  branch: { name: string; code: string } | null;
  assignedAgent: { name: string } | null;
  closedByUser: { name: string } | null;
  assignments: Parameters<typeof toAssignmentRecord>[0][];
  actions: Parameters<typeof toActionRecord>[0][];
  legalNotices: Parameters<typeof toLegalNoticeRecord>[0][];
  settlements: Parameters<typeof toSettlementRecord>[0][];
};
