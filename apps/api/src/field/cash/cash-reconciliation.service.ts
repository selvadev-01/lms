import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CashReconciliationDetail,
  CashReconciliationListResult,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { formatPaise } from '../../common/export/money-format';
import { NotificationEventsService } from '../../notifications/ingestion/notification-events.service';
import { PrismaService } from '../../prisma/prisma.service';
import { nextReconciliationNumber } from './cash-numbering';
import {
  CASH_RECONCILIATION_INCLUDE,
  toCashReconciliationDetail,
  toCashReconciliationSummary,
  type CashReconciliationRow,
} from './cash-reconciliation.mapper';
import type {
  CreateReconciliationDto,
  ListReconciliationsDto,
  ResolveDiscrepancyDto,
} from './dto/cash-reconciliation.dto';

export const CASH_RECONCILIATION_VIEW_PERMISSION = 'cash.reconciliation.view';
export const CASH_RECONCILIATION_PERFORM_PERMISSION =
  'cash.reconciliation.perform';
export const CASH_RECONCILIATION_RESOLVE_PERMISSION =
  'cash.reconciliation.resolve';

const NOT_REACHABLE = 'Reconciliation not found';
const STALE =
  'This reconciliation has changed since you opened it. Reload and try again.';

/**
 * Module 12 — cash reconciliation.
 *
 * # This service posts nothing to the ledger
 *
 * Not an omission. Rule 36 forbids an approval silently changing historical
 * amounts, and Scenario 29 says any accounting adjustment "follows a
 * *separately authorized* financial rule" — Module 14's manual journal is that
 * rule, and it already exists behind its own permission.
 *
 * So a resolution records a type, a reason, an action and an approver, and
 * `approvalReference` carries the Module 14 entry number when one was posted.
 * This is the same posture `ReconciliationService` takes for the ledger: it
 * flags, it never repairs. A service that both detected a shortage and quietly
 * wrote it off would be the unreviewed control this module exists to prevent.
 *
 * # Why the counted figures are frozen
 *
 * `expectedCashPaise`, `actualCashPaise` and `differencePaise` are pinned by
 * `cash_reconciliations_append_only`, which permits only the transition to
 * RESOLVED. Scenario 29's "the original values remain historically traceable"
 * is therefore a database fact rather than a rule a future endpoint might
 * forget.
 */
@Injectable()
export class CashReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // Module 16, from the @Global NotificationEventsModule.
    private readonly events: NotificationEventsService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * Branch scope, and nothing else.
   *
   * No agent confinement here, unlike the collection and handover reads: a
   * reconciliation is branch work, and every permission that reaches this
   * service is withheld from Field Employees entirely. Adding an own-records
   * narrowing would be dead code that reads like a live rule.
   */
  private scopeWhere(actor: AuthContext) {
    return {
      orgId: actor.orgId,
      ...(actor.branchId ? { branchId: actor.branchId } : {}),
    };
  }

  async list(
    actor: AuthContext,
    dto: ListReconciliationsDto,
    meta: RequestMeta,
  ): Promise<CashReconciliationListResult> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const where = {
      ...this.scopeWhere(actor),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.discrepancyType ? { discrepancyType: dto.discrepancyType } : {}),
      ...(dto.fromDate || dto.toDate
        ? {
            businessDate: {
              ...(dto.fromDate ? { gte: this.civilDate(dto.fromDate) } : {}),
              ...(dto.toDate ? { lte: this.civilDate(dto.toDate) } : {}),
            },
          }
        : {}),
      ...(dto.search
        ? {
            reconciliationNumber: {
              contains: dto.search,
              mode: 'insensitive' as const,
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.cashReconciliation.findMany({
        where,
        include: CASH_RECONCILIATION_INCLUDE,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.cashReconciliation.count({ where }),
    ]);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CASH_RECONCILIATION_LISTED,
      entityType: 'CASH_RECONCILIATION',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { total },
    });

    return {
      items: rows.map((row) =>
        toCashReconciliationSummary(row as unknown as CashReconciliationRow),
      ),
      total,
      page,
      pageSize,
    };
  }

  private async findInScope(
    actor: AuthContext,
    reconciliationId: string,
    meta: RequestMeta,
  ): Promise<CashReconciliationRow> {
    const row = await this.prisma.cashReconciliation.findFirst({
      where: { ...this.scopeWhere(actor), reconciliationId },
      include: CASH_RECONCILIATION_INCLUDE,
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CASH_RECONCILIATION_SCOPE_DENIED,
        entityType: 'CASH_RECONCILIATION',
        entityId: reconciliationId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      // 404, never 403: a 403 would confirm the reconciliation exists in
      // another branch or organization (Scenario 47).
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  async getDetail(
    actor: AuthContext,
    reconciliationId: string,
    meta: RequestMeta,
  ): Promise<CashReconciliationDetail> {
    const row = await this.findInScope(actor, reconciliationId, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CASH_RECONCILIATION_VIEWED,
      entityType: 'CASH_RECONCILIATION',
      entityId: reconciliationId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toCashReconciliationDetail(row);
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  /**
   * Counts the cash against a received handover (Scenarios 26-28).
   *
   * `expectedCashPaise` is copied from what the branch recorded receiving, not
   * supplied by the client — a client-supplied expectation would let a
   * reconciliation assert a match it never counted.
   *
   * The difference decides the status, and nothing else does. Zero is
   * `MATCHED`; anything else is `DISCREPANCY_PENDING` with a type derived from
   * the sign. **A discrepancy is never silently absorbed** (Rule 34): there is
   * no tolerance band, because a tolerance is a decision about who bears a loss
   * and that decision belongs to the approval authority.
   */
  async create(
    actor: AuthContext,
    dto: CreateReconciliationDto,
    meta: RequestMeta,
  ): Promise<CashReconciliationDetail> {
    const fingerprint = this.fingerprintOf(dto);

    const replay = await this.prisma.cashReconciliation.findFirst({
      where: { orgId: actor.orgId, idempotencyKey: dto.idempotencyKey },
      select: { reconciliationId: true, requestFingerprint: true },
    });

    if (replay) {
      if (replay.requestFingerprint !== fingerprint) {
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.CASH_RECONCILIATION_IDEMPOTENCY_CONFLICT,
          entityType: 'CASH_RECONCILIATION',
          entityId: replay.reconciliationId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            idempotencyKey: dto.idempotencyKey,
            storedRequestFingerprint: replay.requestFingerprint,
            submittedRequestFingerprint: fingerprint,
          },
        });

        throw new ConflictException({
          message:
            'That idempotency key was already used for a different count. The original is unchanged.',
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          reconciliationId: replay.reconciliationId,
        });
      }

      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CASH_RECONCILIATION_DUPLICATE_IGNORED,
        entityType: 'CASH_RECONCILIATION',
        entityId: replay.reconciliationId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return this.getDetail(actor, replay.reconciliationId, meta);
    }

    const actualPaise = BigInt(dto.actualCashPaise);

    const reconciliationId = await this.prisma.$transaction(async (tx) => {
      const handover = await tx.cashHandover.findFirst({
        where: {
          orgId: actor.orgId,
          handoverId: dto.handoverId,
          ...(actor.branchId ? { branchId: actor.branchId } : {}),
        },
        select: {
          handoverId: true,
          handoverNumber: true,
          branchId: true,
          fieldAgentId: true,
          businessDate: true,
          receivedCashPaise: true,
          status: true,
          updatedAt: true,
          branch: { select: { code: true } },
        },
      });

      if (!handover) throw new NotFoundException('Cash handover not found');

      if (handover.status !== 'RECEIVED') {
        throw new ConflictException(
          handover.status === 'RECONCILED'
            ? 'This handover has already been reconciled.'
            : 'Only a received handover can be reconciled.',
        );
      }

      // The CHECK constraint guarantees a RECEIVED row has this, but reading it
      // as nullable keeps the type honest rather than asserting.
      const expectedPaise = handover.receivedCashPaise ?? 0n;
      const differencePaise = actualPaise - expectedPaise;

      const status = differencePaise === 0n ? 'MATCHED' : 'DISCREPANCY_PENDING';

      const reconciliationNumber = await nextReconciliationNumber(
        tx,
        actor.orgId,
        handover.branch?.code ?? 'BR',
      );

      const created = await tx.cashReconciliation.create({
        data: {
          orgId: actor.orgId,
          reconciliationNumber,
          branchId: handover.branchId,
          fieldAgentId: handover.fieldAgentId,
          handoverId: handover.handoverId,
          businessDate: handover.businessDate,
          expectedCashPaise: expectedPaise,
          actualCashPaise: actualPaise,
          differencePaise,
          status,
          // The type is derived from the sign, not chosen by the counter. What
          // *caused* the difference is the resolver's judgement and is recorded
          // then; what the arithmetic says is not a matter of opinion.
          ...(status === 'DISCREPANCY_PENDING'
            ? {
                discrepancyType:
                  differencePaise < 0n
                    ? ('SHORTAGE' as const)
                    : ('EXCESS' as const),
                discrepancyReason: 'Pending review.',
              }
            : {}),
          idempotencyKey: dto.idempotencyKey,
          requestFingerprint: fingerprint,
          ...(dto.notes ? { notes: dto.notes } : {}),
          createdBy: actor.userId,
        },
      });

      // Closing the handover, guarded on its own version so a concurrent
      // reconciliation of the same handover loses rather than double-counting
      // (Scenario 50).
      const guard = await tx.cashHandover.updateMany({
        where: {
          orgId: actor.orgId,
          handoverId: handover.handoverId,
          status: 'RECEIVED',
          updatedAt: handover.updatedAt,
        },
        data: { status: 'RECONCILED' },
      });

      if (guard.count === 0) {
        throw new ConflictException({
          message:
            'This handover was reconciled by someone else. Reload and try again.',
          code: 'HANDOVER_ALREADY_RECONCILED',
        });
      }

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CASH_RECONCILIATION_CREATED,
          entityType: 'CASH_RECONCILIATION',
          entityId: created.reconciliationId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            reconciliationNumber,
            handoverNumber: handover.handoverNumber,
            expectedCashPaise: expectedPaise.toString(),
            actualCashPaise: actualPaise.toString(),
            differencePaise: differencePaise.toString(),
          },
        },
        tx,
      );

      // Split by outcome rather than one action with an amount, because a
      // match and a discrepancy are different kinds of event (Rule 34).
      await this.audit.record(
        {
          orgId: actor.orgId,
          action:
            status === 'MATCHED'
              ? AuditAction.CASH_RECONCILIATION_MATCHED
              : AuditAction.CASH_DISCREPANCY_DETECTED,
          entityType: 'CASH_RECONCILIATION',
          entityId: created.reconciliationId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { differencePaise: differencePaise.toString() },
        },
        tx,
      );

      return created.reconciliationId;
    });

    const detail = await this.getDetail(actor, reconciliationId, meta);

    // Module 16. After commit (Rules 60-62): the count stands whether or not
    // anyone is told about it.
    //
    // Emitted from the detail rather than from inside the transaction because
    // the discriminating values — the difference and which way it falls — are
    // computed in the closure, and reading them back is cheaper and less
    // fragile than hoisting five variables out of it. Every amount here is
    // already a paise string (Rule 25); nothing is recomputed.
    //
    // Only a discrepancy raises an event. A drawer that balances is the
    // expected outcome and notifying on it would train recipients to ignore the
    // ones that matter.
    if (detail.discrepancyType) {
      await this.events
        .emit(
          {
            orgId: actor.orgId,
            branchId: detail.branchId,
            eventType:
              detail.discrepancyType === 'SHORTAGE'
                ? 'CASH_SHORTAGE'
                : 'CASH_EXCESS',
            sourceModule: 'cash',
            sourceRecordId: reconciliationId,
            payload: {
              reconciliationNumber: detail.reconciliationNumber,
              handoverNumber: detail.handoverNumber ?? '',
              branchName: detail.branchName ?? '',
              // Already DATE-only (Rules 26, 68).
              businessDate: detail.businessDate,
              expectedPaise: detail.expectedCashPaise,
              actualPaise: detail.actualCashPaise,
              differencePaise: detail.differencePaise,
              differenceFormatted: formatPaise(detail.differencePaise),
              discrepancyType: detail.discrepancyType,
            },
          },
          meta,
        )
        .catch(() => undefined);
    }

    return detail;
  }

  // -------------------------------------------------------------------------
  // Resolve
  // -------------------------------------------------------------------------

  /**
   * Resolves a pending shortage or excess (Scenario 29).
   *
   * Records what was decided. Writes **no journal** — see the class comment.
   * The counted figures are untouched and the append-only trigger would refuse
   * them anyway, which is what "the original expected, actual and difference
   * values remain historically traceable" means in practice.
   */
  async resolve(
    actor: AuthContext,
    reconciliationId: string,
    dto: ResolveDiscrepancyDto,
    meta: RequestMeta,
  ): Promise<CashReconciliationDetail> {
    const before = await this.findInScope(actor, reconciliationId, meta);

    if (before.updatedAt.toISOString() !== dto.expectedVersion) {
      throw new ConflictException(STALE);
    }

    if (before.status !== 'DISCREPANCY_PENDING') {
      throw new ConflictException(
        before.status === 'RESOLVED'
          ? 'This discrepancy has already been resolved.'
          : 'Only a pending discrepancy can be resolved.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const guard = await tx.cashReconciliation.updateMany({
        where: {
          orgId: actor.orgId,
          reconciliationId,
          status: 'DISCREPANCY_PENDING',
          updatedAt: before.updatedAt,
        },
        data: {
          status: 'RESOLVED',
          discrepancyType: dto.discrepancyType,
          discrepancyReason: dto.discrepancyReason,
          resolutionAction: dto.resolutionAction,
          ...(dto.resolutionNotes
            ? { resolutionNotes: dto.resolutionNotes }
            : {}),
          ...(dto.approvalReference
            ? { approvalReference: dto.approvalReference }
            : {}),
          resolvedBy: actor.userId,
          resolvedAt: new Date(),
          approvedBy: actor.userId,
        },
      });

      if (guard.count === 0) throw new ConflictException(STALE);

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CASH_DISCREPANCY_RESOLVED,
          entityType: 'CASH_RECONCILIATION',
          entityId: reconciliationId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: { status: 'DISCREPANCY_PENDING' },
          newData: { status: 'RESOLVED' },
          metadata: {
            discrepancyType: dto.discrepancyType,
            resolutionAction: dto.resolutionAction,
            reason: dto.discrepancyReason,
            approvalReference: dto.approvalReference ?? null,
            // Recorded so the audit shows what was forgiven, not merely that
            // something was.
            differencePaise: before.differencePaise.toString(),
          },
        },
        tx,
      );
    });

    return this.getDetail(actor, reconciliationId, meta);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Excludes `notes`, for the reason Module 11's fingerprint does. */
  private fingerprintOf(dto: CreateReconciliationDto): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          handoverId: dto.handoverId,
          actualCashPaise: dto.actualCashPaise,
        }),
      )
      .digest('hex');
  }

  private civilDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }
}
