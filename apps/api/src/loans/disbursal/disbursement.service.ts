import {
  computeSchedule,
  EmiCalculationError,
  todayInKolkata,
  type EmiSchedule,
} from '@lms/emi';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  DisbursalBlocker,
  DisbursalQueueItem,
  DisbursalReadiness,
  DisbursementDetail,
  DisbursementSummary,
  LedgerEntryDetail,
  PaymentMode,
  RepaymentScheduleDetail,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { formatPaise } from '../../common/export/money-format';
import { NotificationEventsService } from '../../notifications/ingestion/notification-events.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApplicationTransitionService,
  type TransitionTx,
} from '../applications/application-transition.service';
import {
  CancelDisbursementDto,
  ConfirmDisbursementDto,
  FailDisbursementDto,
  ListDisbursementsDto,
  RecordTransferDto,
  ScheduleDisbursementDto,
  UpdateDisbursementScheduleDto,
} from './dto/disbursement.dto';
import { FUNDING_ACCOUNT_CODES } from './ledger-accounts';
import { LedgerService } from './ledger.service';
import { LoanApplicationService } from '../applications/loan-application.service';
import { toIsoDate } from '../applications/loan-application.mapper';
import { LoanService } from '../shared/loan.service';
import { toEmiRow, totalsOf } from '../repayment/repayment-schedule.service';

export const DISBURSEMENTS_VIEW_PERMISSION = 'loans.disbursements.view';
export const DISBURSEMENTS_SCHEDULE_PERMISSION = 'loans.disbursements.schedule';
export const DISBURSEMENTS_TRANSFER_PERMISSION =
  'loans.disbursements.record_transfer';
export const DISBURSEMENTS_CONFIRM_PERMISSION = 'loans.disbursements.confirm';
export const DISBURSEMENTS_CANCEL_PERMISSION = 'loans.disbursements.cancel';

const NOT_REACHABLE = 'Disbursement not found';
const STALE =
  'This disbursement was changed by someone else. Reload and try again.';

/**
 * Module 09 — disbursal.
 *
 * ```
 * AGREEMENT_SIGNED --schedule--> DISBURSEMENT_PENDING --confirm--> DISBURSED
 *                                        |
 *                                    (transfer fails)
 *                                        v
 *                                 stays PENDING, retryable
 * ```
 *
 * The disbursement itself moves SCHEDULED -> PROCESSING -> COMPLETED, with
 * FAILED and CANCELLED as exits. Two state machines rather than one because
 * they answer different questions: the application's says how far the borrower
 * has got, the disbursement's says what happened to one attempt at paying them.
 * A failed attempt must not un-sign an agreement.
 *
 * # What makes this module different
 *
 * Every other module in this system records intentions. This one moves money,
 * and three consequences follow.
 *
 * **The amount is never the caller's.** It is read from the sanction letter
 * inside the transaction, every time. `recordTransfer` accepts an amount only
 * so a mismatch can be *reported* (Scenario 6) — the figure posted is always
 * the sanctioned one. This is what makes Rule 6 true by construction.
 *
 * **Every gate runs twice.** `disbursalReadiness` answers advisorily so the UI
 * can grey out a button; `confirm` re-runs all of it inside the transaction
 * against freshly read rows. A client that cached AGREEMENT_SIGNED, or an
 * account deactivated between the two calls, is caught by the second run
 * (Rules 47, 53, 54; Scenarios 36, 41, 42).
 *
 * **Nothing commits alone.** The disbursement, the ledger entry, the loan
 * activation and the repayment schedule are one transaction. Rules 14 and 17
 * forbid marking a loan disbursed without its ledger posting, and generating
 * the schedule in the same breath means the ambiguous state of Scenario 25 is
 * unreachable rather than recoverable.
 */
@Injectable()
export class DisbursementService {
  private readonly logger = new Logger(DisbursementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly applications: LoanApplicationService,
    private readonly transitions: ApplicationTransitionService,
    private readonly ledger: LedgerService,
    private readonly loans: LoanService,
    // Module 16, from the @Global NotificationEventsModule.
    private readonly events: NotificationEventsService,
  ) {}

  // --- Reads ---------------------------------------------------------------

  /**
   * Loans whose agreement is signed and which have not yet been disbursed
   * (Scenario 1).
   *
   * Scoped by the branch spread and by nothing the caller can send: there is
   * deliberately no `branchId` parameter on `ListDisbursementsDto`, which is
   * what makes Scenario 3 structural rather than a check this query has to
   * remember.
   */
  async listEligible(
    actor: AuthContext,
    meta: RequestMeta,
  ): Promise<DisbursalQueueItem[]> {
    const rows = await this.prisma.loanApplication.findMany({
      where: {
        orgId: actor.orgId,
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
        status: { in: ['AGREEMENT_SIGNED', 'DISBURSEMENT_PENDING'] },
      },
      include: {
        customer: { select: { fullName: true, customerCode: true } },
        sanctionLetter: { select: { sanctionedAmountPaise: true } },
        loans: {
          select: {
            loanId: true,
            loanNumber: true,
            disbursements: {
              where: { status: { notIn: ['CANCELLED'] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                disbursementId: true,
                status: true,
                scheduledDate: true,
              },
            },
          },
        },
      },
      orderBy: { agreementSignedAt: 'asc' },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.DISBURSEMENT_QUEUE_VIEWED,
      entityType: 'DISBURSEMENT',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { resultCount: rows.length, actorBranchId: actor.branchId },
    });

    return rows.map((row) => {
      const loan = row.loans[0];
      const disbursement = loan?.disbursements[0];

      return {
        applicationId: row.applicationId,
        applicationNumber: row.applicationNumber,
        customerId: row.customerId,
        customerName: row.customer.fullName,
        customerCode: row.customer.customerCode,
        branchId: row.branchId,
        sanctionedAmountPaise: (
          row.sanctionLetter?.sanctionedAmountPaise ?? row.requestedAmountPaise
        ).toString(),
        agreementSignedAt: row.agreementSignedAt?.toISOString() ?? '',
        ...(loan ? { loanId: loan.loanId, loanNumber: loan.loanNumber } : {}),
        ...(disbursement
          ? {
              disbursementId: disbursement.disbursementId,
              disbursementStatus: disbursement.status,
              scheduledDate: toIsoDate(disbursement.scheduledDate),
            }
          : {}),
      };
    });
  }

  /**
   * The funding accounts a disbursement may be scheduled against.
   *
   * Returned as `SelectOption`-shaped rows so the web's `<SelectField>` consumes
   * them without knowing they came from the chart of accounts rather than from
   * master data — the one option shape the app has.
   *
   * Only ACTIVE accounts, because this list exists to populate a form and a
   * form must not offer a value the confirm step will refuse (Scenario 34). The
   * loan receivable account is excluded: it is the debit side of every
   * disbursal and is never something an operator picks.
   */
  async listFundingAccounts(
    actor: AuthContext,
  ): Promise<{ value: string; label: string; hint?: string }[]> {
    const rows = await this.prisma.account.findMany({
      where: {
        orgId: actor.orgId,
        status: 'ACTIVE',
        // Spread because Prisma's `in` wants a mutable array and the constant
        // is `readonly` — which it should stay, so the copy happens here.
        accountCode: { in: [...FUNDING_ACCOUNT_CODES] },
      },
      orderBy: { accountCode: 'asc' },
      select: { accountId: true, accountCode: true, accountName: true },
    });

    return rows.map((row) => ({
      value: row.accountId,
      label: row.accountName,
      hint: row.accountCode,
    }));
  }

  async list(
    actor: AuthContext,
    query: ListDisbursementsDto,
  ): Promise<{ items: DisbursementSummary[]; total: number }> {
    const search = query.search?.trim();

    const where = {
      orgId: actor.orgId,
      ...(actor.branchId ? { branchId: actor.branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              {
                transactionReference: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
              {
                loan: {
                  loanNumber: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
              },
              {
                loan: {
                  customer: {
                    fullName: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const [rows, total] = await Promise.all([
      this.prisma.disbursement.findMany({
        where,
        include: DISBURSEMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.disbursement.count({ where }),
    ]);

    return { items: rows.map(toSummary), total };
  }

  /**
   * A disbursement the caller may reach, or a 404.
   *
   * Same four rules as `LoanService.findInScope` — org on the query, the branch
   * spread, 404 rather than 403, and an audited denial.
   */
  async findInScope(
    actor: AuthContext,
    disbursementId: string,
    meta: RequestMeta,
  ): Promise<DisbursementRow> {
    const row = await this.prisma.disbursement.findFirst({
      where: {
        orgId: actor.orgId,
        disbursementId,
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
      },
      include: DISBURSEMENT_INCLUDE,
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.DISBURSEMENT_SCOPE_DENIED,
        entityType: 'DISBURSEMENT',
        entityId: disbursementId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { actorBranchId: actor.branchId },
      });

      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  async getDetail(
    actor: AuthContext,
    disbursementId: string,
    meta: RequestMeta,
  ): Promise<DisbursementDetail> {
    const row = await this.findInScope(actor, disbursementId, meta);
    return toDetail(row);
  }

  async getLedger(
    actor: AuthContext,
    disbursementId: string,
    meta: RequestMeta,
  ): Promise<LedgerEntryDetail> {
    const row = await this.findInScope(actor, disbursementId, meta);

    if (!row.journalEntryId) {
      throw new NotFoundException(
        'No ledger entry exists yet — this disbursement has not been confirmed',
      );
    }

    const entry = await this.ledger.getEntry(actor.orgId, row.journalEntryId);
    if (!entry) throw new NotFoundException('Ledger entry not found');

    return entry;
  }

  async getSchedule(
    actor: AuthContext,
    disbursementId: string,
    meta: RequestMeta,
  ): Promise<RepaymentScheduleDetail> {
    const row = await this.findInScope(actor, disbursementId, meta);

    const schedule = await this.prisma.repaymentSchedule.findFirst({
      where: { orgId: actor.orgId, loanId: row.loanId, status: 'ACTIVE' },
      include: { emis: { orderBy: { installmentNumber: 'asc' } } },
    });

    if (!schedule) {
      throw new NotFoundException(
        'No repayment schedule exists yet — this disbursement has not been confirmed',
      );
    }

    // Mapped and summed by Module 10's helpers rather than here. This endpoint
    // and the loan-keyed schedule screen render the same persisted rows, and a
    // second implementation would be a second place for `effectiveStatus` and
    // the totals to be derived differently.
    const today = todayInKolkata();
    const totals = totalsOf(schedule.emis);

    return {
      repaymentScheduleId: schedule.repaymentScheduleId,
      loanId: schedule.loanId,
      version: schedule.version,
      status: schedule.status,
      generatedAt: schedule.generatedAt.toISOString(),
      installments: schedule.emis.map((emi) => toEmiRow(emi, today)),
      totalPrincipalPaise: totals.totalPrincipalPaise,
      totalInterestPaise: totals.totalInterestPaise,
      totalPayablePaise: totals.totalPayablePaise,
    };
  }

  /**
   * Why a disbursement cannot be confirmed right now (Scenarios 8, 9, 10, 41).
   *
   * Advisory only. `confirm` re-runs every one of these inside its transaction,
   * so a blocker appearing between this call and the confirm is still caught.
   * The read-only twin of the real gates, exactly as `approvalReadiness` is for
   * approval.
   */
  async disbursalReadiness(
    actor: AuthContext,
    disbursementId: string,
    meta: RequestMeta,
  ): Promise<DisbursalReadiness> {
    const row = await this.findInScope(actor, disbursementId, meta);
    const blockers = await this.collectBlockers(this.prisma, actor.orgId, row);

    return {
      disbursementId: row.disbursementId,
      confirmable: blockers.length === 0,
      blockers,
      version: row.updatedAt.toISOString(),
    };
  }

  // --- Writes --------------------------------------------------------------

  /**
   * Schedule a disbursement against a signed agreement (Scenario 5).
   *
   * Creates the `Loan` row as well — Module 09 is its only writer, and a
   * disbursement with no loan to point at would be unreferenceable. Both, plus
   * the application's move to DISBURSEMENT_PENDING, commit together.
   *
   * The loan stays undisbursed until the transfer is confirmed: this method
   * moves no money and posts no ledger line.
   */
  async schedule(
    actor: AuthContext,
    dto: ScheduleDisbursementDto,
    meta: RequestMeta,
  ): Promise<DisbursementDetail> {
    const application = await this.applications.findInScope(
      actor,
      dto.applicationId,
      meta,
    );

    const sanction = await this.prisma.sanctionLetter.findFirst({
      where: { orgId: actor.orgId, applicationId: dto.applicationId },
    });

    // Scenarios 8, 10: no letter, or a letter the customer did not accept.
    if (!sanction) {
      await this.recordBlocked(actor, dto.applicationId, meta, 'NO_SANCTION');
      throw new ConflictException(
        'This application has no sanction letter and cannot be disbursed',
      );
    }

    if (sanction.customerResponse !== 'ACCEPTED') {
      await this.recordBlocked(
        actor,
        dto.applicationId,
        meta,
        `SANCTION_${sanction.customerResponse}`,
      );
      throw new ConflictException(
        sanction.customerResponse === 'DECLINED'
          ? 'The customer declined this sanction, so it cannot be disbursed'
          : 'The customer has not yet accepted this sanction',
      );
    }

    if (!sanction.agreementSignedAt) {
      await this.recordBlocked(
        actor,
        dto.applicationId,
        meta,
        'AGREEMENT_UNSIGNED',
      );
      throw new ConflictException(
        'The loan agreement has not been signed, so this loan cannot be disbursed',
      );
    }

    // Revalidated again at confirm — an account may be deactivated in between
    // (Scenario 36). Checked here too so the operator finds out now.
    const account = await this.requireUsableAccount(
      this.prisma,
      actor,
      dto.disbursementAccountId,
      meta,
    );

    const disbursementDate = kolkataDate(dto.disbursementDate);
    let disbursementId = '';

    await this.transitions.run(actor, application, dto.expectedVersion, meta, {
      from: ['AGREEMENT_SIGNED'],
      to: 'DISBURSEMENT_PENDING',
      action: AuditAction.DISBURSEMENT_SCHEDULED,
      inTransaction: async (tx) => {
        const loanNumber = await this.loans.nextLoanNumber(tx, actor.orgId);

        const loan = await tx.loan.create({
          data: {
            orgId: actor.orgId,
            loanNumber,
            branchId: application.branchId,
            customerId: application.customerId,
            applicationId: application.applicationId,
            loanProductId: application.loanProductId,
            loanSchemeId: application.loanSchemeId,
            // Snapshotted from the sanction letter, not the application: the
            // letter is what the customer agreed to (Rules 39, 40).
            principalAmountPaise: sanction.sanctionedAmountPaise,
            interestRateBps: sanction.interestRateBps,
            interestType: sanction.interestType,
            repaymentFrequency: sanction.repaymentFrequency,
            durationCount: sanction.durationCount,
            status: 'DISBURSEMENT_PENDING',
            sanctionDate: sanction.issuedAt,
            agreementDate: sanction.agreementSignedAt,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          },
        });

        const created = await tx.disbursement.create({
          data: {
            orgId: actor.orgId,
            loanId: loan.loanId,
            branchId: application.branchId,
            scheduledDate: disbursementDate,
            disbursementAccountId: account.accountId,
            // The sanctioned figure, never a caller-supplied one (Rule 6).
            amountPaise: sanction.sanctionedAmountPaise,
            // A placeholder until the transfer is recorded. The column is not
            // nullable because every disbursement eventually has a mode, and
            // BANK_TRANSFER is the source's default reading of Rule 10.
            paymentMode: 'BANK_TRANSFER',
            status: 'SCHEDULED',
            // Scheduling has its own key so a double-submitted schedule form
            // cannot create two loans. Server-minted: unlike confirm, there is
            // no retry semantics to preserve across a client crash here.
            idempotencyKey: `SCHEDULE:${application.applicationId}`,
            createdBy: actor.userId,
          },
        });

        disbursementId = created.disbursementId;

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_CREATED,
            entityType: 'LOAN',
            entityId: loan.loanId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              loanNumber,
              applicationId: application.applicationId,
              principalAmountPaise: sanction.sanctionedAmountPaise.toString(),
            },
          },
          tx,
        );
      },
      metadata: {
        disbursementAccountId: account.accountId,
        scheduledDate: dto.disbursementDate,
        notes: dto.notes ?? null,
      },
    });

    return this.getDetail(actor, disbursementId, meta);
  }

  /**
   * Edit a scheduled disbursement before any transfer (Scenario 11).
   *
   * The `status: 'SCHEDULED'` in the guard is what blocks Scenario 12: once the
   * transfer has been recorded the row no longer matches and the edit is
   * refused, leaving the original financial record unchanged.
   */
  async updateSchedule(
    actor: AuthContext,
    disbursementId: string,
    dto: UpdateDisbursementScheduleDto,
    meta: RequestMeta,
  ): Promise<DisbursementDetail> {
    const before = await this.findInScope(actor, disbursementId, meta);
    this.assertVersion(before, dto.expectedVersion);

    const account = await this.requireUsableAccount(
      this.prisma,
      actor,
      dto.disbursementAccountId,
      meta,
    );

    const guard = await this.prisma.disbursement.updateMany({
      where: {
        orgId: actor.orgId,
        disbursementId,
        status: 'SCHEDULED',
        updatedAt: before.updatedAt,
      },
      data: {
        scheduledDate: kolkataDate(dto.disbursementDate),
        disbursementAccountId: account.accountId,
      },
    });

    if (guard.count === 0) {
      await this.recordConcurrent(actor, before, meta, 'UPDATE_SCHEDULE');
      throw new ConflictException(
        before.status === 'SCHEDULED'
          ? STALE
          : `A disbursement that is ${before.status} can no longer be rescheduled`,
      );
    }

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.DISBURSEMENT_SCHEDULE_UPDATED,
      entityType: 'DISBURSEMENT',
      entityId: disbursementId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      oldData: {
        scheduledDate: toIsoDate(before.scheduledDate),
        disbursementAccountId: before.disbursementAccountId,
      },
      newData: {
        scheduledDate: dto.disbursementDate,
        disbursementAccountId: account.accountId,
      },
    });

    return this.getDetail(actor, disbursementId, meta);
  }

  /**
   * Record that the transfer was made (Scenarios 14-17).
   *
   * Records what happened externally; it does not itself move money. The
   * amount is compared against the sanctioned figure and a mismatch refused
   * (Scenario 6) — the stored amount is never replaced by the caller's.
   */
  async recordTransfer(
    actor: AuthContext,
    disbursementId: string,
    dto: RecordTransferDto,
    meta: RequestMeta,
  ): Promise<DisbursementDetail> {
    const before = await this.findInScope(actor, disbursementId, meta);
    this.assertVersion(before, dto.expectedVersion);

    /**
     * Rule 11 / Scenario 16 — required here rather than on the DTO field.
     *
     * `@ValidateIf` would be the obvious decorator for "required when the mode
     * is a bank transfer", and it is precisely the wrong tool: applied to a
     * field it skips `@IsNotEmpty` and silently accepts a missing value. So the
     * field stays optional at the DTO layer (cash genuinely has no reference)
     * and the conditional requirement is enforced here, against the resolved
     * mode, where it cannot be skipped.
     *
     * UPI is included because it settles through a bank and produces a
     * reference just as a transfer does; only cash is exempt.
     */
    const needsReference =
      dto.paymentMode === 'BANK_TRANSFER' || dto.paymentMode === 'UPI';

    if (needsReference && !dto.transactionReference?.trim()) {
      await this.recordBlocked(
        actor,
        before.loan.applicationId,
        meta,
        'REFERENCE_REQUIRED',
        { paymentMode: dto.paymentMode },
      );

      throw new ConflictException(
        'A transaction reference is required for a bank transfer',
      );
    }

    // Scenario 6 / Rule 6. The caller's figure is checked, then discarded.
    if (BigInt(dto.amountPaise) !== before.amountPaise) {
      await this.recordBlocked(
        actor,
        before.loan.applicationId,
        meta,
        'AMOUNT_MISMATCH',
        {
          submittedAmountPaise: dto.amountPaise,
          sanctionedAmountPaise: before.amountPaise.toString(),
        },
      );

      throw new ConflictException(
        `The disbursement amount must match the approved amount of ${before.amountPaise} paise`,
      );
    }

    const guard = await this.prisma.disbursement
      .updateMany({
        where: {
          orgId: actor.orgId,
          disbursementId,
          status: 'SCHEDULED',
          updatedAt: before.updatedAt,
        },
        data: {
          paymentMode: dto.paymentMode,
          transactionReference: dto.transactionReference ?? null,
          transferDate: kolkataDate(dto.transferDate),
          status: 'PROCESSING',
        },
      })
      .catch(async (error: unknown) => {
        // A duplicate reference reaches here as P2002. Untranslated it would
        // surface as a 503 "Authentication service unavailable" from the global
        // filter, which is actively misleading for Scenario 17.
        if (isUniqueViolation(error, 'transaction_reference')) {
          await this.audit
            .record({
              orgId: actor.orgId,
              action: AuditAction.DISBURSEMENT_DUPLICATE_REFERENCE,
              entityType: 'DISBURSEMENT',
              entityId: disbursementId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
              metadata: { transactionReference: dto.transactionReference },
            })
            .catch(() => {});

          throw new ConflictException(
            `Transaction reference ${dto.transactionReference} has already been used for another disbursement`,
          );
        }
        throw error;
      });

    if (guard.count === 0) {
      await this.recordConcurrent(actor, before, meta, 'RECORD_TRANSFER');
      throw new ConflictException(
        before.status === 'SCHEDULED'
          ? STALE
          : `A transfer has already been recorded for this disbursement (${before.status})`,
      );
    }

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.DISBURSEMENT_TRANSFER_RECORDED,
      entityType: 'DISBURSEMENT',
      entityId: disbursementId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        paymentMode: dto.paymentMode,
        amountPaise: before.amountPaise.toString(),
        transactionReference: dto.transactionReference ?? null,
        transferDate: dto.transferDate,
      },
    });

    return this.getDetail(actor, disbursementId, meta);
  }

  /**
   * The money-moving transaction (Scenarios 19-24, 27, 28, 44, 46).
   *
   * In one transaction, in this order:
   *
   *   1. replay an existing idempotency key, if any
   *   2. re-read and re-check every gate against the database
   *   3. claim the disbursement with a status+version guard
   *   4. post the balanced ledger entry
   *   5. activate the loan
   *   6. generate the repayment schedule
   *
   * Any throw rolls all of it back, which is what Rules 14, 16 and 17 require:
   * a failed ledger commit must not leave a loan marked disbursed.
   */
  async confirm(
    actor: AuthContext,
    disbursementId: string,
    dto: ConfirmDisbursementDto,
    meta: RequestMeta,
  ): Promise<DisbursementDetail> {
    const before = await this.findInScope(actor, disbursementId, meta);

    // Scenarios 28, 46 — the replay. Checked before the version guard on
    // purpose: a client retrying after a timeout holds the version from before
    // the successful commit, so a version check first would reject the retry
    // with a conflict instead of returning what it already achieved.
    const replay = await this.findReplay(actor.orgId, dto.idempotencyKey);
    if (replay) {
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.DISBURSEMENT_DUPLICATE_IGNORED,
          entityType: 'DISBURSEMENT',
          entityId: replay.disbursementId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { idempotencyKey: dto.idempotencyKey },
        })
        .catch(() => {});

      // Reported as the success it is, never as an error — the same treatment
      // a duplicate GPS check-in gets.
      return toDetail(replay);
    }

    this.assertVersion(before, dto.expectedVersion);

    const application = await this.applications.findInScope(
      actor,
      before.loan.applicationId,
      meta,
    );

    const disbursedAt = new Date();

    try {
      await this.transitions.run(
        actor,
        application,
        application.updatedAt.toISOString(),
        meta,
        {
          from: ['DISBURSEMENT_PENDING'],
          to: 'DISBURSED',
          action: AuditAction.DISBURSEMENT_CONFIRMED,
          inTransaction: async (tx) => {
            // (2) Every gate again, against rows read inside this transaction.
            const fresh = await tx.disbursement.findFirst({
              where: { orgId: actor.orgId, disbursementId },
              include: DISBURSEMENT_INCLUDE,
            });

            if (!fresh) throw new NotFoundException(NOT_REACHABLE);

            const blockers = await this.collectBlockers(tx, actor.orgId, fresh);

            if (blockers.length > 0) {
              throw new ConflictException({
                message: blockers[0].reason,
                blockedBy: blockers[0].key,
                blockers,
              });
            }

            // (3) Claim it. `status: 'PROCESSING'` plus the version is what
            // makes Scenario 44 resolve to exactly one winner — the database
            // arbitrates rather than a check-then-act in application code.
            const guard = await tx.disbursement.updateMany({
              where: {
                orgId: actor.orgId,
                disbursementId,
                status: 'PROCESSING',
                updatedAt: fresh.updatedAt,
              },
              data: {
                status: 'COMPLETED',
                disbursedAt,
                confirmedBy: actor.userId,
                confirmedAt: disbursedAt,
                idempotencyKey: dto.idempotencyKey,
              },
            });

            if (guard.count === 0) throw new ConflictException(STALE);

            // (4) The ledger. A throw here rolls back the claim above.
            const journalEntryId = await this.ledger.postDisbursement(tx, {
              orgId: actor.orgId,
              loanId: fresh.loanId,
              branchId: fresh.branchId,
              customerId: fresh.loan.customerId,
              amountPaise: fresh.amountPaise,
              paymentMode: fresh.paymentMode,
              entryDate: fresh.transferDate ?? fresh.scheduledDate,
              disbursementId,
              loanNumber: fresh.loan.loanNumber,
              createdBy: actor.userId,
            });

            await tx.disbursement.update({
              where: {
                orgId_disbursementId: { orgId: actor.orgId, disbursementId },
              },
              data: { journalEntryId },
            });

            await this.audit.record(
              {
                orgId: actor.orgId,
                action: AuditAction.DISBURSEMENT_LEDGER_POSTED,
                entityType: 'JOURNAL_ENTRY',
                entityId: journalEntryId,
                actorUserId: actor.userId,
                requestId: meta.requestId,
                ipAddress: meta.ipAddress,
                userAgent: meta.userAgent,
                metadata: {
                  disbursementId,
                  loanId: fresh.loanId,
                  amountPaise: fresh.amountPaise.toString(),
                  paymentMode: fresh.paymentMode,
                },
              },
              tx,
            );

            // (5) The loan becomes repayable.
            await tx.loan.update({
              where: {
                orgId_loanId: { orgId: actor.orgId, loanId: fresh.loanId },
              },
              data: {
                status: 'ACTIVE',
                disbursementDate: fresh.transferDate ?? fresh.scheduledDate,
                updatedBy: actor.userId,
              },
            });

            // (6) The schedule, in the same transaction (Scenario 24). Doing
            // it here is what makes Scenario 25's ambiguous state unreachable.
            await this.generateSchedule(tx, actor, fresh, meta);

            await this.audit.record(
              {
                orgId: actor.orgId,
                action: AuditAction.LOAN_ACTIVATED,
                entityType: 'LOAN',
                entityId: fresh.loanId,
                actorUserId: actor.userId,
                requestId: meta.requestId,
                ipAddress: meta.ipAddress,
                userAgent: meta.userAgent,
                metadata: { loanNumber: fresh.loan.loanNumber },
              },
              tx,
            );
          },
          metadata: {
            disbursementId,
            idempotencyKey: dto.idempotencyKey,
            amountPaise: before.amountPaise.toString(),
          },
        },
      );
    } catch (error) {
      // Recorded outside the rolled-back transaction, or it would vanish with
      // it and leave no trace of why the disbursal failed (Rules 45, 46).
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.DISBURSEMENT_LEDGER_FAILED,
          entityType: 'DISBURSEMENT',
          entityId: disbursementId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            reason: error instanceof Error ? error.message : 'UNKNOWN',
            idempotencyKey: dto.idempotencyKey,
          },
        })
        .catch(() => {});

      if (!(error instanceof ConflictException)) {
        this.logger.error(
          `Disbursement ${disbursementId} failed for org ${actor.orgId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }

      throw error;
    }

    // Module 16. After commit (Rules 6, 7, 31, 60-62): the money has left the
    // account and the ledger is posted. Reached only on the success path — the
    // `catch` above rethrows, so a failed disbursal raises no completion event.
    await this.events
      .emit(
        {
          orgId: actor.orgId,
          branchId: application.branchId,
          eventType: 'DISBURSAL_COMPLETED',
          sourceModule: 'disbursal',
          sourceRecordId: disbursementId,
          // The disbursal's own idempotency key when it has one: a retried
          // confirmation and a replayed event then share one identity.
          deduplicationKey: dto.idempotencyKey
            ? `DISBURSAL_COMPLETED:disbursal:${dto.idempotencyKey}`
            : undefined,
          payload: {
            applicationNumber: application.applicationNumber,
            loanNumber: before.loan?.loanNumber ?? '',
            amountPaise: before.amountPaise.toString(),
            amountFormatted: formatPaise(before.amountPaise.toString()),
            // DATE-only (Rules 26, 68).
            disbursedOn: disbursedAt.toISOString().slice(0, 10),
          },
        },
        meta,
      )
      .catch(() => undefined);

    return this.getDetail(actor, disbursementId, meta);
  }

  /**
   * Record that the transfer failed (Scenario 26).
   *
   * The loan stays DISBURSEMENT_PENDING and the application does not move: a
   * failed transfer must not mark a loan disbursed (Rule 16), and it must stay
   * retryable. Returns the disbursement to SCHEDULED so a retry can record a
   * fresh transfer without re-scheduling.
   */
  async markFailed(
    actor: AuthContext,
    disbursementId: string,
    dto: FailDisbursementDto,
    meta: RequestMeta,
  ): Promise<DisbursementDetail> {
    const before = await this.findInScope(actor, disbursementId, meta);
    this.assertVersion(before, dto.expectedVersion);

    const guard = await this.prisma.disbursement.updateMany({
      where: {
        orgId: actor.orgId,
        disbursementId,
        status: 'PROCESSING',
        updatedAt: before.updatedAt,
      },
      data: {
        status: 'SCHEDULED',
        failureReason: dto.failureReason,
        // Released so a retry may reuse it, or use a different one. Holding a
        // reference from a transfer that never happened would make Scenario 17
        // fire on the retry.
        transactionReference: null,
        transferDate: null,
      },
    });

    if (guard.count === 0) {
      await this.recordConcurrent(actor, before, meta, 'MARK_FAILED');
      throw new ConflictException(
        before.status === 'COMPLETED'
          ? 'This disbursement has already completed and cannot be marked failed'
          : STALE,
      );
    }

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.DISBURSEMENT_TRANSFER_FAILED,
      entityType: 'DISBURSEMENT',
      entityId: disbursementId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { failureReason: dto.failureReason, retryable: true },
    });

    return this.getDetail(actor, disbursementId, meta);
  }

  /**
   * Cancel a scheduled disbursement (Scenarios 37, 38).
   *
   * Only from SCHEDULED, and the row is never deleted — Rules 30 and 31 forbid
   * removing a financial record, and a completed disbursement is refused
   * outright. Cancelling returns the application to AGREEMENT_SIGNED so it can
   * be scheduled again.
   */
  async cancel(
    actor: AuthContext,
    disbursementId: string,
    dto: CancelDisbursementDto,
    meta: RequestMeta,
  ): Promise<{ cancelled: true }> {
    const before = await this.findInScope(actor, disbursementId, meta);
    this.assertVersion(before, dto.expectedVersion);

    if (before.status === 'COMPLETED') {
      throw new ConflictException(
        'A completed disbursement cannot be cancelled. A financial correction requires a reversal entry.',
      );
    }

    const application = await this.applications.findInScope(
      actor,
      before.loan.applicationId,
      meta,
    );

    await this.transitions.run(
      actor,
      application,
      application.updatedAt.toISOString(),
      meta,
      {
        from: ['DISBURSEMENT_PENDING'],
        to: 'AGREEMENT_SIGNED',
        action: AuditAction.DISBURSEMENT_CANCELLED,
        inTransaction: async (tx) => {
          const guard = await tx.disbursement.updateMany({
            where: {
              orgId: actor.orgId,
              disbursementId,
              status: { in: ['SCHEDULED', 'PROCESSING'] },
              updatedAt: before.updatedAt,
            },
            data: {
              status: 'CANCELLED',
              failureReason: dto.cancellationReason,
              // Released so a re-scheduled disbursement may reuse it.
              transactionReference: null,
            },
          });

          if (guard.count === 0) throw new ConflictException(STALE);

          // The loan row stays. It is referenced by the disbursement, and
          // deleting a record that a financial row points at is exactly what
          // Rule 30 forbids.
          await tx.loan.update({
            where: {
              orgId_loanId: { orgId: actor.orgId, loanId: before.loanId },
            },
            data: { status: 'AGREEMENT_SIGNED', updatedBy: actor.userId },
          });
        },
        metadata: {
          disbursementId,
          cancellationReason: dto.cancellationReason,
        },
      },
    );

    return { cancelled: true };
  }

  // --- Internals -----------------------------------------------------------

  /**
   * Every reason a disbursement cannot be confirmed.
   *
   * Takes a `tx` so the same code serves both the advisory read and the
   * authoritative check inside the transaction. That sharing is the point: two
   * separate implementations would drift, and the one that drifted would be the
   * advisory one telling an operator they may proceed when they may not.
   */
  private async collectBlockers(
    tx: Pick<TransitionTx, 'sanctionLetter' | 'account'>,
    orgId: string,
    row: DisbursementRow,
  ): Promise<DisbursalBlocker[]> {
    const blockers: DisbursalBlocker[] = [];

    if (row.status === 'COMPLETED') {
      blockers.push({
        key: 'ALREADY_DISBURSED',
        reason: 'This loan has already been disbursed',
      });
    } else if (row.status !== 'PROCESSING') {
      blockers.push({
        key: 'NO_TRANSFER_RECORDED',
        reason:
          row.status === 'SCHEDULED'
            ? 'Record the fund transfer before confirming the disbursement'
            : `A disbursement that is ${row.status} cannot be confirmed`,
        details: { status: row.status },
      });
    }

    const sanction = await tx.sanctionLetter.findFirst({
      where: { orgId, applicationId: row.loan.applicationId },
      select: {
        sanctionedAmountPaise: true,
        customerResponse: true,
        agreementSignedAt: true,
      },
    });

    // Scenarios 8, 41: revalidated here rather than trusted from the client.
    if (!sanction?.agreementSignedAt) {
      blockers.push({
        key: 'NOT_AGREEMENT_SIGNED',
        reason: 'The loan agreement has not been signed',
      });
    }

    // Scenarios 9, 10.
    if (sanction && sanction.customerResponse !== 'ACCEPTED') {
      blockers.push({
        key: 'SANCTION_NOT_ACCEPTED',
        reason:
          sanction.customerResponse === 'DECLINED'
            ? 'The customer declined this sanction'
            : 'The customer has not accepted this sanction',
        details: { customerResponse: sanction.customerResponse },
      });
    }

    // Scenarios 6, 42: the stored amount must still equal the sanctioned one.
    if (sanction && sanction.sanctionedAmountPaise !== row.amountPaise) {
      blockers.push({
        key: 'AMOUNT_MISMATCH',
        reason: 'The disbursement amount no longer matches the approved amount',
        details: {
          disbursementAmountPaise: row.amountPaise.toString(),
          sanctionedAmountPaise: sanction.sanctionedAmountPaise.toString(),
        },
      });
    }

    // Scenarios 34, 36: an account active at scheduling may not be at confirm.
    const account = await tx.account.findFirst({
      where: { orgId, accountId: row.disbursementAccountId },
      select: { status: true, accountName: true },
    });

    if (!account || account.status !== 'ACTIVE') {
      blockers.push({
        key: 'ACCOUNT_INACTIVE',
        reason: account
          ? `The ${account.accountName} account is inactive and cannot be used`
          : 'The selected disbursement account no longer exists',
      });
    }

    return blockers;
  }

  /**
   * Generates version 1 of the repayment schedule (Scenario 24).
   *
   * Built from the loan's snapshotted terms — the ones captured at scheduling
   * from the sanction letter — anchored to the actual disbursement date, so a
   * transfer that happened later than scheduled produces due dates counted from
   * when the borrower actually got the money (Rule 39).
   *
   * `finalInstallmentPaise` from `@lms/emi` absorbs all rounding residue, which
   * is what makes the persisted rows sum exactly to `totalPayablePaise`.
   */
  private async generateSchedule(
    tx: TransitionTx,
    actor: AuthContext,
    row: DisbursementRow,
    meta: RequestMeta,
  ): Promise<void> {
    const anchor = row.transferDate ?? row.scheduledDate;

    // Annotated rather than inferred: a bare `let schedule;` assigned inside the
    // try widens to `any`, which would silently drop type checking on every
    // installment field written to the database below.
    let schedule: EmiSchedule;
    try {
      schedule = computeSchedule({
        principalPaise: row.amountPaise,
        annualRateBps: row.loan.interestRateBps,
        interestType: row.loan.interestType,
        frequency: row.loan.repaymentFrequency,
        durationCount: row.loan.durationCount,
        startDate: toIsoDate(anchor),
      });
    } catch (error) {
      if (error instanceof EmiCalculationError) {
        // Rolls the disbursal back. A loan that cannot produce a schedule must
        // not be funded — the borrower would owe money on no defined terms.
        throw new ConflictException(
          `This disbursement cannot be confirmed: these terms produce no repayment schedule (${error.message})`,
        );
      }
      throw error;
    }

    const created = await tx.repaymentSchedule.create({
      data: {
        orgId: actor.orgId,
        loanId: row.loanId,
        // Module 10: which disbursal produced this version, and who confirmed
        // it. Both are provenance the schedule screen and its audit trail read.
        disbursementId: row.disbursementId,
        version: 1,
        generatedAt: new Date(),
        generatedBy: actor.userId,
        status: 'ACTIVE',
      },
    });

    // `openingPrincipalPaise` is the previous installment's closing balance, and
    // the financed principal on the first. Tracking it here rather than
    // recomputing on read is what lets the persisted rows be checked against the
    // principal directly (Module 10 Scenario 11).
    let opening = row.amountPaise;

    for (const installment of schedule.installments) {
      await tx.emi.create({
        data: {
          orgId: actor.orgId,
          repaymentScheduleId: created.repaymentScheduleId,
          loanId: row.loanId,
          installmentNumber: installment.installmentNumber,
          dueDate: kolkataDate(installment.dueDate),
          openingPrincipalPaise: opening,
          principalDuePaise: installment.principalPaise,
          interestDuePaise: installment.interestPaise,
          totalDuePaise: installment.totalPaise,
          // Generating a schedule is never a payment (Rules 12, 13, 14): the
          // borrower owes the whole installment the moment it exists.
          paidAmountPaise: 0n,
          outstandingAmountPaise: installment.totalPaise,
          status: 'PENDING',
        },
      });

      opening = installment.closingBalancePaise;
    }

    await this.audit.record(
      {
        orgId: actor.orgId,
        action: AuditAction.REPAYMENT_SCHEDULE_GENERATED,
        entityType: 'REPAYMENT_SCHEDULE',
        entityId: created.repaymentScheduleId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          loanId: row.loanId,
          version: 1,
          installmentCount: schedule.installmentCount,
          totalPayablePaise: schedule.totalPayablePaise.toString(),
          firstDueDate: schedule.firstDueDate,
          lastDueDate: schedule.lastDueDate,
        },
      },
      tx,
    );
  }

  /** A completed disbursement already committed under this key, if any. */
  private async findReplay(
    orgId: string,
    idempotencyKey: string,
  ): Promise<DisbursementRow | null> {
    const row = await this.prisma.disbursement.findFirst({
      where: { orgId, idempotencyKey, status: 'COMPLETED' },
      include: DISBURSEMENT_INCLUDE,
    });

    return row ?? null;
  }

  /**
   * The account must exist, be active, and belong to the caller's organization
   * (Scenarios 18, 31, 32, 34).
   *
   * Branch is not checked because the three seeded ledger accounts are
   * organization-wide by design — which branch a posting belongs to is carried
   * by the `AccountDimension` on the journal line, not by owning a separate
   * account per branch. Cross-branch use (Scenario 31) is therefore prevented
   * by the loan's own branch scoping, not by the account's.
   */
  private async requireUsableAccount(
    tx: Pick<TransitionTx, 'account'>,
    actor: AuthContext,
    accountId: string,
    meta: RequestMeta,
  ): Promise<{ accountId: string }> {
    const account = await tx.account.findFirst({
      where: { orgId: actor.orgId, accountId },
      select: { accountId: true, accountName: true, status: true },
    });

    if (!account) {
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.DISBURSEMENT_BLOCKED,
          entityType: 'ACCOUNT',
          entityId: accountId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { reason: 'ACCOUNT_OUT_OF_SCOPE' },
        })
        .catch(() => {});

      throw new ConflictException(
        'That disbursement account is not available to your organization',
      );
    }

    if (account.status !== 'ACTIVE') {
      throw new ConflictException(
        `The ${account.accountName} account is inactive and cannot receive a disbursement`,
      );
    }

    return { accountId: account.accountId };
  }

  /**
   * The caller's belief about the row, checked against what was read.
   *
   * The same reasoning as `ApplicationTransitionService`: without this the
   * `updateMany` guards below would compare a value the caller just read for
   * itself, and the client's `expectedVersion` would be decorative.
   */
  private assertVersion(row: DisbursementRow, expectedVersion: string): void {
    const expected = this.transitions.assertParsableVersion(expectedVersion);

    if (row.updatedAt.getTime() !== expected.getTime()) {
      throw new ConflictException(STALE);
    }
  }

  private async recordBlocked(
    actor: AuthContext,
    applicationId: string,
    meta: RequestMeta,
    reason: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.DISBURSEMENT_BLOCKED,
        entityType: 'LOAN_APPLICATION',
        entityId: applicationId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason, ...(details ?? {}) },
      })
      .catch(() => {});
  }

  private async recordConcurrent(
    actor: AuthContext,
    row: DisbursementRow,
    meta: RequestMeta,
    operation: string,
  ): Promise<void> {
    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.DISBURSEMENT_CONCURRENT_ATTEMPT_REJECTED,
        entityType: 'DISBURSEMENT',
        entityId: row.disbursementId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { operation, observedStatus: row.status },
      })
      .catch(() => {});
  }
}

// --- Mapping ---------------------------------------------------------------

const DISBURSEMENT_INCLUDE = {
  loan: {
    select: {
      loanNumber: true,
      applicationId: true,
      customerId: true,
      interestType: true,
      interestRateBps: true,
      repaymentFrequency: true,
      durationCount: true,
      customer: { select: { fullName: true } },
      application: { select: { applicationNumber: true } },
    },
  },
  disbursementAccount: {
    select: { accountCode: true, accountName: true, status: true },
  },
} as const;

export type DisbursementRow = {
  orgId: string;
  disbursementId: string;
  loanId: string;
  branchId: string;
  scheduledDate: Date;
  disbursementAccountId: string;
  disbursedAt: Date | null;
  amountPaise: bigint;
  paymentMode: PaymentMode;
  bankAccountReference: string | null;
  transactionReference: string | null;
  transferDate: Date | null;
  status: 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  idempotencyKey: string;
  journalEntryId: string | null;
  failureReason: string | null;
  createdBy: string;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  loan: {
    loanNumber: string;
    applicationId: string;
    customerId: string;
    interestType: 'FLAT' | 'REDUCING' | 'CUSTOM_RATE';
    interestRateBps: bigint;
    repaymentFrequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
    durationCount: number;
    customer: { fullName: string };
    application: { applicationNumber: string };
  };
  disbursementAccount: {
    accountCode: string;
    accountName: string;
    status: 'ACTIVE' | 'INACTIVE';
  };
};

function toSummary(row: DisbursementRow): DisbursementSummary {
  return {
    disbursementId: row.disbursementId,
    loanId: row.loanId,
    loanNumber: row.loan.loanNumber,
    applicationId: row.loan.applicationId,
    applicationNumber: row.loan.application.applicationNumber,
    customerId: row.loan.customerId,
    customerName: row.loan.customer.fullName,
    branchId: row.branchId,
    status: row.status,
    scheduledDate: toIsoDate(row.scheduledDate),
    amountPaise: row.amountPaise.toString(),
    paymentMode: row.paymentMode,
    ...(row.transactionReference
      ? { transactionReference: row.transactionReference }
      : {}),
    ...(row.transferDate ? { transferDate: toIsoDate(row.transferDate) } : {}),
    ...(row.disbursedAt ? { disbursedAt: row.disbursedAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
    version: row.updatedAt.toISOString(),
  };
}

function toDetail(row: DisbursementRow): DisbursementDetail {
  return {
    ...toSummary(row),
    disbursementAccountId: row.disbursementAccountId,
    disbursementAccountCode: row.disbursementAccount.accountCode,
    disbursementAccountName: row.disbursementAccount.accountName,
    disbursementAccountStatus: row.disbursementAccount.status,
    ...(row.bankAccountReference
      ? { bankAccountReference: row.bankAccountReference }
      : {}),
    ...(row.failureReason ? { failureReason: row.failureReason } : {}),
    createdBy: row.createdBy,
    ...(row.confirmedBy ? { confirmedBy: row.confirmedBy } : {}),
    ...(row.confirmedAt ? { confirmedAt: row.confirmedAt.toISOString() } : {}),
    ...(row.journalEntryId ? { journalEntryId: row.journalEntryId } : {}),
    interestType: row.loan.interestType,
    interestRateBps: row.loan.interestRateBps.toString(),
    repaymentFrequency: row.loan.repaymentFrequency,
    durationCount: row.loan.durationCount,
  };
}

/**
 * A `YYYY-MM-DD` string as the Date a `@db.Date` column expects.
 *
 * Anchored at noon Asia/Kolkata rather than midnight so no timezone conversion
 * anywhere in the stack can shift it across a day boundary — the same idiom
 * `recordAgreement` uses. Rule 38: EMI due dates are DATE-only, Asia/Kolkata.
 */
function kolkataDate(value: string): Date {
  return new Date(`${value}T12:00:00+05:30`);
}

/**
 * Prisma's unique-constraint violation, narrowed to one column.
 *
 * # Why the message is consulted and not only `meta.target`
 *
 * `meta.target` is the documented place to find the offending columns, and on
 * this stack — Prisma 7 with the `@prisma/adapter-pg` driver adapter — it is
 * not reliably populated. An e2e run caught exactly that: a duplicate
 * transaction reference produced a genuine P2002 whose `meta` did not carry the
 * target, so this predicate returned false, the error escaped untranslated, and
 * the global filter rendered it as **503 "Authentication service is temporarily
 * unavailable"** — an alarming and completely wrong answer to "you have already
 * used that reference" (Scenario 17).
 *
 * So both are checked. `meta.target` first because it is structured, then the
 * message, which reliably reads:
 *
 *   Unique constraint failed on the fields: (`org_id`, `transaction_reference`)
 *
 * Matching on a message is ordinarily a smell. Here it is the difference
 * between a correct 409 and a misleading 503 on a money-moving endpoint, and
 * the fallback costs nothing on the paths where `meta` is present.
 */
function isUniqueViolation(error: unknown, column: string): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as {
    code?: string;
    message?: unknown;
    meta?: { target?: unknown };
  };

  if (candidate.code !== 'P2002') return false;

  const target = candidate.meta?.target;
  if (typeof target === 'string' && target.includes(column)) return true;
  if (Array.isArray(target) && target.some((t) => String(t).includes(column))) {
    return true;
  }

  return (
    typeof candidate.message === 'string' && candidate.message.includes(column)
  );
}
