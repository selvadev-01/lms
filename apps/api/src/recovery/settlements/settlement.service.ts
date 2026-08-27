import { createHash } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { todayInKolkata, type CivilDate } from '@lms/emi';
import type { LegalNoticeRecord, SettlementRecord } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../../loans/disbursal/ledger.service';
import { toLegalNoticeRecord, toSettlementRecord } from '../recovery.mapper';
import { RecoveryCaseService } from '../cases/recovery-case.service';
import type {
  DecideSettlementDto,
  IssueLegalNoticeDto,
  ProposeSettlementDto,
  WriteOffLoanDto,
} from '../dto/recovery.dto';

export const RECOVERY_SETTLEMENTS_PROPOSE_PERMISSION =
  'recovery.settlements.propose';
export const RECOVERY_SETTLEMENTS_APPROVE_PERMISSION =
  'recovery.settlements.approve';
export const RECOVERY_NOTICES_ISSUE_PERMISSION = 'recovery.notices.issue';
export const RECOVERY_WRITEOFF_POST_PERMISSION = 'recovery.writeoff.post';

const STALE =
  'This settlement has changed since you opened it. Reload and try again.';

/**
 * Module 13 — settlements, legal notices and write-off.
 *
 * # The two genuinely ledger-affecting acts this module owns
 *
 * Everything else in Module 13 records intentions and outcomes; these two move
 * value. Completing a settlement and writing a loan off both post
 * `Dr 5100 Loan Write-off Expense / Cr 1100 Loan Receivable` — the asset raised
 * at disbursal is retired because it will not be collected.
 *
 * The *settled* portion is not posted here. It is an ordinary repayment and
 * goes through Module 11's collection workflow (Rules 15, 16), which is why
 * this service has no payment path and no receipt.
 *
 * # Why proposing and approving are separate authorities
 *
 * Scenario 44 and the permission catalog's split rule: the officer who agreed
 * terms with a borrower does not also approve forgiving the remainder. One
 * method that decided from a body field would have to resolve which permission
 * it needed at runtime, after the guard has already run.
 *
 * # Ordering inside the posting transaction
 *
 * The journal entry is written **before** the domain row is updated, and the
 * settlement's id is minted up front so it can be the entry's `sourceId`. The
 * append-only triggers freeze a row on insert, so `journalEntryId` cannot be
 * back-filled — the same constraint `CollectionService` documents.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly cases: RecoveryCaseService,
  ) {}

  /**
   * Proposes a settlement.
   *
   * Commits nothing and posts nothing: a proposal is a suggested reduction
   * awaiting an approval authority. The waived amount is derived from the
   * outstanding balance rather than accepted from the form, so the three
   * figures always satisfy `settlements_waiver_sums`.
   */
  async propose(
    actor: AuthContext,
    recoveryCaseId: string,
    dto: ProposeSettlementDto,
    meta: RequestMeta,
  ): Promise<SettlementRecord> {
    const recoveryCase = await this.cases.findInScope(
      actor,
      recoveryCaseId,
      meta,
    );

    if (recoveryCase.status === 'CLOSED') {
      throw new ConflictException(
        'This case is closed. Reopen it before proposing a settlement.',
      );
    }

    const fingerprint = this.fingerprintOf(dto);

    const replay = await this.prisma.settlement.findFirst({
      where: { orgId: actor.orgId, idempotencyKey: dto.idempotencyKey },
      include: { approvedByUser: { select: { name: true } } },
    });

    if (replay) {
      if (replay.requestFingerprint !== fingerprint) {
        await this.audit
          .record({
            orgId: actor.orgId,
            action: AuditAction.SETTLEMENT_IDEMPOTENCY_CONFLICT,
            entityType: 'SETTLEMENT',
            entityId: replay.settlementId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
          })
          .catch(() => {});

        throw new ConflictException({
          message:
            'That idempotency key was already used for a different settlement. The original is unchanged.',
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          settlementId: replay.settlementId,
        });
      }

      return toSettlementRecord(replay);
    }

    const outstanding = await this.outstandingPrincipal(recoveryCase.loanId);
    const settlementAmount = BigInt(dto.settlementAmountPaise);

    if (settlementAmount > outstanding) {
      throw new ConflictException(
        'A settlement cannot exceed what the borrower still owes.',
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.settlement.create({
        data: {
          orgId: actor.orgId,
          recoveryCaseId,
          loanId: recoveryCase.loanId,
          settlementAmountPaise: settlementAmount,
          outstandingBeforePaise: outstanding,
          waivedAmountPaise: outstanding - settlementAmount,
          status: 'PENDING_APPROVAL',
          agreedDate: this.isoToDate(dto.agreedDate),
          reason: dto.reason,
          createdBy: actor.userId,
          idempotencyKey: dto.idempotencyKey,
          requestFingerprint: fingerprint,
        },
        include: { approvedByUser: { select: { name: true } } },
      });

      await tx.recoveryCase.updateMany({
        where: { orgId: actor.orgId, recoveryCaseId },
        data: { status: 'SETTLEMENT_PENDING' },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.SETTLEMENT_PROPOSED,
          entityType: 'SETTLEMENT',
          entityId: row.settlementId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            recoveryCaseId,
            settlementAmountPaise: settlementAmount.toString(),
            waivedAmountPaise: (outstanding - settlementAmount).toString(),
          },
        },
        tx,
      );

      return row;
    });

    return toSettlementRecord(created);
  }

  /**
   * Approves or rejects a proposal.
   *
   * Approval alone posts nothing — it authorises the waiver. The ledger entry
   * is written when the settlement completes, because until the borrower has
   * paid the settled portion nothing has actually been forgiven.
   */
  async decide(
    actor: AuthContext,
    settlementId: string,
    dto: DecideSettlementDto,
    meta: RequestMeta,
  ): Promise<SettlementRecord> {
    const before = await this.findInScope(actor, settlementId, meta);

    if (before.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(
        'Only a settlement awaiting approval can be decided.',
      );
    }

    this.assertVersion(actor, before, dto.expectedVersion, meta);

    const updated = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.settlement.updateMany({
        where: {
          orgId: actor.orgId,
          settlementId,
          updatedAt: before.updatedAt,
          status: 'PENDING_APPROVAL',
        },
        // Approver and timestamp in one statement — `settlements_approval_paired`
        // is evaluated per statement, so filling them in separately would fail.
        data:
          dto.decision === 'APPROVE'
            ? {
                status: 'APPROVED',
                approvedBy: actor.userId,
                approvedAt: new Date(),
                ...(dto.approvalReference
                  ? { approvalReference: dto.approvalReference }
                  : {}),
              }
            : {
                status: 'REJECTED',
                ...(dto.reason ? { reason: dto.reason } : {}),
              },
      });

      if (guard.count === 0) throw new ConflictException(STALE);

      await this.audit.record(
        {
          orgId: actor.orgId,
          action:
            dto.decision === 'APPROVE'
              ? AuditAction.SETTLEMENT_APPROVED
              : AuditAction.SETTLEMENT_REJECTED,
          entityType: 'SETTLEMENT',
          entityId: settlementId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: { status: before.status },
          newData: {
            status: dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          },
          metadata: { reason: dto.reason },
        },
        tx,
      );

      return tx.settlement.findFirstOrThrow({
        where: { orgId: actor.orgId, settlementId },
        include: { approvedByUser: { select: { name: true } } },
      });
    });

    return toSettlementRecord(updated);
  }

  /**
   * Completes an approved settlement, posting the waiver to the ledger.
   *
   * This is the moment value moves: the forgiven portion of the principal is
   * recognised as a loss and the receivable retired.
   */
  async complete(
    actor: AuthContext,
    settlementId: string,
    dto: DecideSettlementDto,
    meta: RequestMeta,
  ): Promise<SettlementRecord> {
    const before = await this.findInScope(actor, settlementId, meta);

    if (before.status !== 'APPROVED') {
      throw new ConflictException(
        'Only an approved settlement can be completed.',
      );
    }

    this.assertVersion(actor, before, dto.expectedVersion, meta);

    const today = todayInKolkata();

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const loan = await tx.loan.findFirstOrThrow({
          where: { orgId: actor.orgId, loanId: before.loanId },
          select: {
            loanNumber: true,
            branchId: true,
            customerId: true,
          },
        });

        const waived = before.waivedAmountPaise ?? 0n;
        let journalEntryId: string | null = null;

        // A settlement that forgives nothing is legitimate — the borrower
        // simply paid in full on agreed terms — and has no ledger consequence.
        if (waived > 0n) {
          journalEntryId = await this.ledger.postWriteOff(tx, {
            orgId: actor.orgId,
            loanId: before.loanId,
            branchId: loan.branchId,
            customerId: loan.customerId,
            loanNumber: loan.loanNumber,
            sourceType: 'SETTLEMENT',
            sourceId: settlementId,
            principalPaise: waived,
            entryDate: this.civilToDate(today),
            createdBy: actor.userId,
            reason: before.reason ?? 'Settlement',
          });
        }

        const guard = await tx.settlement.updateMany({
          where: {
            orgId: actor.orgId,
            settlementId,
            updatedAt: before.updatedAt,
            status: 'APPROVED',
          },
          data: {
            status: 'COMPLETED',
            completedDate: this.civilToDate(today),
            ...(journalEntryId ? { journalEntryId } : {}),
          },
        });

        if (guard.count === 0) throw new ConflictException(STALE);

        await tx.recoveryCase.updateMany({
          where: { orgId: actor.orgId, recoveryCaseId: before.recoveryCaseId },
          data: { status: 'SETTLED' },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.SETTLEMENT_COMPLETED,
            entityType: 'SETTLEMENT',
            entityId: settlementId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              waivedAmountPaise: waived.toString(),
              journalEntryId,
            },
          },
          tx,
        );

        if (journalEntryId) {
          await this.audit.record(
            {
              orgId: actor.orgId,
              action: AuditAction.SETTLEMENT_LEDGER_POSTED,
              entityType: 'JOURNAL_ENTRY',
              entityId: journalEntryId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              metadata: { settlementId },
            },
            tx,
          );
        }

        return tx.settlement.findFirstOrThrow({
          where: { orgId: actor.orgId, settlementId },
          include: { approvedByUser: { select: { name: true } } },
        });
      });

      return toSettlementRecord(updated);
    } catch (error) {
      // Audited outside the rolled-back transaction, so the failure record
      // survives (Scenario 50's principle).
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.SETTLEMENT_POSTING_FAILED,
          entityType: 'SETTLEMENT',
          entityId: settlementId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          metadata: {
            reason: error instanceof Error ? error.message : 'unknown',
          },
        })
        .catch(() => {});

      throw error;
    }
  }

  /**
   * Issues a legal notice against a case.
   *
   * A document reference, not a money movement: no journal, no idempotency key.
   * The expiry is derived from the notice date and period rather than accepted,
   * so `legal_notices_expiry_after_notice` cannot be violated by a form.
   */
  async issueNotice(
    actor: AuthContext,
    recoveryCaseId: string,
    dto: IssueLegalNoticeDto,
    meta: RequestMeta,
  ): Promise<LegalNoticeRecord> {
    const recoveryCase = await this.cases.findInScope(
      actor,
      recoveryCaseId,
      meta,
    );

    if (recoveryCase.status === 'CLOSED') {
      throw new ConflictException(
        'This case is closed. Reopen it before issuing a notice.',
      );
    }

    const noticeDate = this.isoToDate(dto.noticeDate);
    const expiry = new Date(noticeDate);
    expiry.setUTCDate(expiry.getUTCDate() + dto.noticePeriodDays);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.legalNotice.create({
        data: {
          orgId: actor.orgId,
          recoveryCaseId,
          noticeDate,
          noticePeriodDays: dto.noticePeriodDays,
          expiryDate: expiry,
          status: 'ISSUED',
          issuedBy: actor.userId,
          ...(dto.noticeReference
            ? { noticeReference: dto.noticeReference }
            : {}),
          ...(dto.documentRef ? { documentRef: dto.documentRef } : {}),
        },
        include: { issuedByUser: { select: { name: true } } },
      });

      await tx.recoveryCase.updateMany({
        where: { orgId: actor.orgId, recoveryCaseId },
        data: { status: 'LEGAL_NOTICE' },
      });

      await tx.recoveryAction.create({
        data: {
          orgId: actor.orgId,
          recoveryCaseId,
          action: 'LEGAL_NOTICE',
          actionDate: noticeDate,
          outcome: 'ESCALATION_REQUIRED',
          performedBy: actor.userId,
          notes: dto.noticeReference ?? 'Legal notice issued',
          // A notice is a decision, not a draft.
          finalizedAt: new Date(),
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.LEGAL_NOTICE_ISSUED,
          entityType: 'LEGAL_NOTICE',
          entityId: row.legalNoticeId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            recoveryCaseId,
            noticePeriodDays: dto.noticePeriodDays,
          },
        },
        tx,
      );

      return row;
    });

    return toLegalNoticeRecord(created);
  }

  /**
   * Writes a loan off as unrecoverable.
   *
   * The most irreversible act in the module: it posts the loss, moves the loan
   * to `WRITTEN_OFF` and closes the case. Held by a permission the seed grants
   * to no role, so reaching it is always a deliberate configuration choice.
   *
   * Rule 28 permits recovery tracking to continue after a write-off; that is
   * why the case is closed with `WRITTEN_OFF` as its resolution rather than
   * deleted, and why the history remains readable.
   */
  async writeOff(
    actor: AuthContext,
    recoveryCaseId: string,
    dto: WriteOffLoanDto,
    meta: RequestMeta,
  ): Promise<SettlementRecord | null> {
    const before = await this.cases.findInScope(actor, recoveryCaseId, meta);

    if (before.status === 'CLOSED') {
      throw new ConflictException('This case is already closed.');
    }

    const expected = new Date(dto.expectedVersion);
    if (
      Number.isNaN(expected.getTime()) ||
      before.updatedAt.getTime() !== expected.getTime()
    ) {
      throw new ConflictException(
        'This recovery case has changed since you opened it. Reload and try again.',
      );
    }

    const outstanding = await this.outstandingPrincipal(before.loanId);
    const today = todayInKolkata();

    try {
      await this.prisma.$transaction(async (tx) => {
        const loan = await tx.loan.findFirstOrThrow({
          where: { orgId: actor.orgId, loanId: before.loanId },
          select: { loanNumber: true, branchId: true, customerId: true },
        });

        let journalEntryId: string | null = null;

        if (outstanding > 0n) {
          journalEntryId = await this.ledger.postWriteOff(tx, {
            orgId: actor.orgId,
            loanId: before.loanId,
            branchId: loan.branchId,
            customerId: loan.customerId,
            loanNumber: loan.loanNumber,
            sourceType: 'LOAN_WRITE_OFF',
            sourceId: before.loanId,
            principalPaise: outstanding,
            entryDate: this.civilToDate(today),
            createdBy: actor.userId,
            reason: dto.reason,
          });
        }

        const guard = await tx.recoveryCase.updateMany({
          where: {
            orgId: actor.orgId,
            recoveryCaseId,
            updatedAt: before.updatedAt,
          },
          data: {
            status: 'CLOSED',
            closedDate: this.civilToDate(today),
            closedBy: actor.userId,
            closureReason: dto.reason,
            resolutionType: 'WRITTEN_OFF',
            npaStatus: 'LOSS',
            outstandingBeforePaise: outstanding,
            recoveredAmountPaise: 0n,
            remainingOutstandingPaise: outstanding,
            ...(dto.approvalReference
              ? { approvalReference: dto.approvalReference }
              : {}),
          },
        });

        if (guard.count === 0) {
          throw new ConflictException(
            'This recovery case has changed since you opened it. Reload and try again.',
          );
        }

        await tx.loan.updateMany({
          where: { orgId: actor.orgId, loanId: before.loanId },
          data: { status: 'WRITTEN_OFF' },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_WRITTEN_OFF,
            entityType: 'LOAN',
            entityId: before.loanId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              recoveryCaseId,
              principalPaise: outstanding.toString(),
              journalEntryId,
              reason: dto.reason,
            },
          },
          tx,
        );

        if (journalEntryId) {
          await this.audit.record(
            {
              orgId: actor.orgId,
              action: AuditAction.LOAN_WRITE_OFF_LEDGER_POSTED,
              entityType: 'JOURNAL_ENTRY',
              entityId: journalEntryId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              metadata: { loanId: before.loanId },
            },
            tx,
          );
        }
      });

      return null;
    } catch (error) {
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.LOAN_WRITE_OFF_FAILED,
          entityType: 'LOAN',
          entityId: before.loanId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          metadata: {
            reason: error instanceof Error ? error.message : 'unknown',
          },
        })
        .catch(() => {});

      throw error;
    }
  }

  /**
   * A settlement the caller may reach, or a 404.
   *
   * Reached through its case, so the branch scope and officer confinement of
   * `RecoveryCaseService.findInScope` apply transitively.
   */
  private async findInScope(
    actor: AuthContext,
    settlementId: string,
    meta: RequestMeta,
  ): Promise<SettlementRow> {
    const row = await this.prisma.settlement.findFirst({
      where: {
        orgId: actor.orgId,
        settlementId,
        ...(actor.branchId
          ? { recoveryCase: { branchId: actor.branchId } }
          : {}),
      },
      include: { approvedByUser: { select: { name: true } } },
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.SETTLEMENT_SCOPE_DENIED,
        entityType: 'SETTLEMENT',
        entityId: settlementId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { actorBranchId: actor.branchId },
      });

      throw new NotFoundException('Settlement not found');
    }

    return row;
  }

  /**
   * The principal still owed on a loan.
   *
   * Principal alone, because `1100 Loan Receivable` holds principal alone —
   * interest was never raised as a receivable. Writing off the whole overdue
   * figure would drive the control account below the loan book.
   */
  private async outstandingPrincipal(loanId: string): Promise<bigint> {
    const schedule = await this.prisma.repaymentSchedule.findFirst({
      where: { loanId, status: 'ACTIVE' },
      include: { emis: true },
    });

    if (!schedule) return 0n;

    let outstanding = 0n;
    for (const emi of schedule.emis) {
      const paid = emi.paidAmountPaise;
      const principalPaid =
        paid > emi.interestDuePaise ? paid - emi.interestDuePaise : 0n;
      const remaining =
        emi.principalDuePaise > principalPaid
          ? emi.principalDuePaise - principalPaid
          : 0n;
      outstanding += remaining;
    }

    return outstanding;
  }

  private assertVersion(
    actor: AuthContext,
    row: { settlementId: string; updatedAt: Date },
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
          action: AuditAction.SETTLEMENT_CONCURRENT_ATTEMPT_REJECTED,
          entityType: 'SETTLEMENT',
          entityId: row.settlementId,
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

  /** Excludes `reason`, on `Collection.requestFingerprint`'s precedent. */
  private fingerprintOf(dto: ProposeSettlementDto): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          settlementAmountPaise: dto.settlementAmountPaise,
          agreedDate: dto.agreedDate,
        }),
      )
      .digest('hex');
  }

  private isoToDate(value: string): Date {
    return new Date(`${value}T12:00:00+05:30`);
  }

  private civilToDate(date: CivilDate): Date {
    const month = String(date.month).padStart(2, '0');
    const day = String(date.day).padStart(2, '0');
    return new Date(`${date.year}-${month}-${day}T12:00:00+05:30`);
  }
}

type SettlementRow = Parameters<typeof toSettlementRecord>[0] & {
  loanId: string;
  recoveryCaseId: string;
  waivedAmountPaise: bigint | null;
  reason: string | null;
  updatedAt: Date;
};
