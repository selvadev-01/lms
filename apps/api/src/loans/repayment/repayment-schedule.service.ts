import {
  computeSchedule,
  EmiCalculationError,
  parseIsoDate,
  todayInKolkata,
  type CivilDate,
  type EmiSchedule,
} from '@lms/emi';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  EmiRow,
  EmiStatus,
  RepaymentScheduleListResult,
  RepaymentScheduleSummary,
  RepaymentScheduleView,
  ScheduleLoanSummary,
  ScheduleRegenerationBlocker,
  ScheduleTotals,
  SupersededScheduleRef,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { TransitionTx } from '../applications/application-transition.service';
import {
  ListRepaymentSchedulesDto,
  RegenerateScheduleDto,
} from './dto/repayment-schedule.dto';
import { toIsoDate } from '../applications/loan-application.mapper';
import { LoanService, type LoanWithRelations } from '../shared/loan.service';

export const SCHEDULES_VIEW_PERMISSION = 'loans.schedules.view';
export const SCHEDULES_EXPORT_PERMISSION = 'loans.schedules.export';
export const SCHEDULES_REGENERATE_PERMISSION = 'loans.schedules.regenerate';
export const SCHEDULES_RETRY_PERMISSION = 'loans.schedules.retry';

const NO_SCHEDULE = 'This loan has no repayment schedule yet';
const STALE =
  'This schedule was changed by someone else. Reload and try again.';

/**
 * Module 10 — the repayment schedule.
 *
 * Module 09 already generates version 1 inside the disbursal transaction, so
 * this service does not own generation-at-disbursal. What it owns is everything
 * afterwards: reading a schedule for the life of the loan, deriving each
 * installment's due status, superseding a version where policy allows, and
 * recovering from a generation that failed.
 *
 * # Two things worth knowing before changing anything here
 *
 * **EMI status is derived, never swept.** The persisted `Emi.status` stays
 * `PENDING` until a payment or a lifecycle action writes to the row. The
 * `PENDING → DUE → OVERDUE` progression is computed at read time by comparing
 * the due date to the Asia/Kolkata business date. There is deliberately no
 * nightly job: a job leaves every row wrong between midnight and the run,
 * fails silently when it does not fire, and gives the client's clock a way to
 * matter. Deriving costs one comparison per row and cannot drift
 * (Scenarios 23, 24, 39).
 *
 * **Terms come from the `Loan` row, never from the caller.** A regeneration
 * recomputes from the loan's snapshotted principal, rate, interest type,
 * frequency and duration, anchored to its disbursement date. Nothing in the
 * request body reaches `computeSchedule`, which is what makes Scenarios 8 and
 * 36 hold: a client with a stale view of the terms cannot generate a schedule
 * from them.
 */
@Injectable()
export class RepaymentScheduleService {
  private readonly logger = new Logger(RepaymentScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loans: LoanService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The branch-scoped list of schedules (Scenarios 2, 33, 34).
   *
   * Scoping is the loan's branch, spread the same way `LoanService.findInScope`
   * spreads it: a caller carrying a `branchId` is confined to it, and a null one
   * (Super Admin) reaches the whole organization. There is no `branchId` in the
   * DTO, so a client cannot widen its own scope (Scenario 35).
   */
  async list(
    actor: AuthContext,
    dto: ListRepaymentSchedulesDto,
    meta: RequestMeta,
  ): Promise<RepaymentScheduleListResult> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 25;
    const search = dto.search?.trim();

    const where = {
      orgId: actor.orgId,
      status: dto.status ?? ('ACTIVE' as const),
      loan: {
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
        ...(search
          ? {
              OR: [
                {
                  loanNumber: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  customer: {
                    fullName: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              ],
            }
          : {}),
      },
    };

    const [rows, total] = await Promise.all([
      this.prisma.repaymentSchedule.findMany({
        where,
        orderBy: { generatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          loan: {
            select: {
              loanNumber: true,
              customer: { select: { fullName: true } },
              branch: { select: { name: true } },
            },
          },
          emis: {
            orderBy: { installmentNumber: 'asc' },
            select: {
              dueDate: true,
              totalDuePaise: true,
              outstandingAmountPaise: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.repaymentSchedule.count({ where }),
    ]);

    const items: RepaymentScheduleSummary[] = rows.map((row) => {
      let totalPayable = 0n;
      let outstanding = 0n;
      for (const emi of row.emis) {
        totalPayable += emi.totalDuePaise;
        outstanding += emi.outstandingAmountPaise;
      }

      const nextDueDate = nextDueDateOf(row.emis);

      return {
        repaymentScheduleId: row.repaymentScheduleId,
        loanId: row.loanId,
        loanNumber: row.loan.loanNumber,
        customerName: row.loan.customer.fullName,
        branchName: row.loan.branch.name,
        version: row.version,
        status: row.status,
        installmentCount: row.emis.length,
        totalPayablePaise: totalPayable.toString(),
        outstandingPaise: outstanding.toString(),
        ...(nextDueDate ? { nextDueDate } : {}),
        generatedAt: row.generatedAt.toISOString(),
      };
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.REPAYMENT_SCHEDULE_LISTED,
      entityType: 'REPAYMENT_SCHEDULE',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        returned: items.length,
        total,
        page,
        actorBranchId: actor.branchId,
        ...(search ? { search } : {}),
      },
    });

    return { items, total, page, pageSize };
  }

  /**
   * The full schedule screen for one loan.
   *
   * Reaches the loan through `LoanService.findInScope`, which already enforces
   * the tenant boundary, confines a branch-scoped caller, returns 404 rather
   * than 403 so an id cannot be probed, and audits the denial. Reimplementing
   * any of that here would be a second copy of four security properties.
   */
  async getForLoan(
    actor: AuthContext,
    loanId: string,
    meta: RequestMeta,
  ): Promise<RepaymentScheduleView> {
    const loan = await this.loans.findInScope(actor, loanId, meta);
    const schedule = await this.loadActive(actor.orgId, loanId);

    if (!schedule) {
      throw new NotFoundException(NO_SCHEDULE);
    }

    const blockers = await this.checkRegenerationBlockers(
      this.prisma,
      actor.orgId,
      schedule.repaymentScheduleId,
      loan.status,
      schedule.status,
    );

    const priorVersions = await this.prisma.repaymentSchedule.findMany({
      where: {
        orgId: actor.orgId,
        loanId,
        repaymentScheduleId: { not: schedule.repaymentScheduleId },
      },
      orderBy: { version: 'desc' },
      select: {
        repaymentScheduleId: true,
        version: true,
        generatedAt: true,
        supersededAt: true,
        regenerationReason: true,
      },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.REPAYMENT_SCHEDULE_VIEWED,
      entityType: 'REPAYMENT_SCHEDULE',
      entityId: schedule.repaymentScheduleId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { loanId, version: schedule.version },
    });

    return this.toView(loan, schedule, blockers, priorVersions);
  }

  /**
   * Supersede the live schedule with a new version (Scenario 16).
   *
   * One transaction, and the gates run twice: advisorily in `getForLoan` so the
   * screen can grey the button out, and authoritatively here so a caller who
   * bypassed the screen — or whose view went stale between reading and posting
   * — is still refused. The two share `checkRegenerationBlockers`; a second
   * implementation would be a second thing to keep in step.
   *
   * Version is asserted *before* the blockers, unlike Module 09's `confirm`
   * where a replay check comes first. There is no replay to detect here: a
   * regeneration is never idempotent, so a stale token is unambiguously a lost
   * race (Scenario 41).
   */
  async regenerate(
    actor: AuthContext,
    loanId: string,
    dto: RegenerateScheduleDto,
    meta: RequestMeta,
  ): Promise<RepaymentScheduleView> {
    const loan = await this.loans.findInScope(actor, loanId, meta);

    const current = await this.loadActive(actor.orgId, loanId);
    if (!current) {
      throw new NotFoundException(NO_SCHEDULE);
    }

    if (current.updatedAt.toISOString() !== dto.expectedVersion) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.REPAYMENT_SCHEDULE_CONCURRENT_ATTEMPT_REJECTED,
        entityType: 'REPAYMENT_SCHEDULE',
        entityId: current.repaymentScheduleId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          loanId,
          version: current.version,
          submittedVersion: dto.expectedVersion,
          currentVersion: current.updatedAt.toISOString(),
        },
      });
      throw new ConflictException(STALE);
    }

    const blockers = await this.checkRegenerationBlockers(
      this.prisma,
      actor.orgId,
      current.repaymentScheduleId,
      loan.status,
      current.status,
    );

    if (blockers.length > 0) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.REPAYMENT_SCHEDULE_REGENERATION_BLOCKED,
        entityType: 'REPAYMENT_SCHEDULE',
        entityId: current.repaymentScheduleId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { loanId, blockedBy: blockers.map((b) => b.key) },
      });

      throw new ConflictException({
        message: 'This schedule can no longer be regenerated',
        blockers,
      });
    }

    const computed = this.compute(
      loan,
      actor,
      meta,
      current.repaymentScheduleId,
    );

    await this.prisma.$transaction(async (tx) => {
      // The guarded update is the real concurrency defence, not the check
      // above: two callers can both pass the version assertion and arrive here,
      // and only one can move the row out of ACTIVE.
      const retired = await tx.repaymentSchedule.updateMany({
        where: {
          orgId: actor.orgId,
          repaymentScheduleId: current.repaymentScheduleId,
          status: 'ACTIVE',
        },
        data: {
          status: 'SUPERSEDED',
          supersededAt: new Date(),
          supersededBy: actor.userId,
        },
      });

      if (retired.count === 0) {
        throw new ConflictException(STALE);
      }

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.REPAYMENT_SCHEDULE_SUPERSEDED,
          entityType: 'REPAYMENT_SCHEDULE',
          entityId: current.repaymentScheduleId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { loanId, version: current.version, reason: dto.reason },
        },
        tx,
      );

      const created = await this.persist(tx, actor, loan, computed, {
        version: current.version + 1,
        reason: dto.reason,
        disbursementId: current.disbursementId,
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.REPAYMENT_SCHEDULE_REGENERATED,
          entityType: 'REPAYMENT_SCHEDULE',
          entityId: created.repaymentScheduleId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            loanId,
            previousScheduleId: current.repaymentScheduleId,
            previousVersion: current.version,
            newVersion: current.version + 1,
            reason: dto.reason,
            installmentCount: computed.installmentCount,
            totalPayablePaise: computed.totalPayablePaise.toString(),
          },
        },
        tx,
      );
    });

    return this.getForLoan(actor, loanId, meta);
  }

  /**
   * Generate the schedule for an active loan that has none (Scenario 29).
   *
   * Idempotent by construction: if a schedule appeared between the check and
   * the insert, the `(orgId, loanId, version)` unique index rejects the second
   * write and the caller is handed the authoritative existing result rather
   * than an error (Scenarios 31, 40). Version 1 always — a retry produces the
   * schedule that should already have existed and supersedes nothing.
   */
  async retry(
    actor: AuthContext,
    loanId: string,
    meta: RequestMeta,
  ): Promise<RepaymentScheduleView> {
    const loan = await this.loans.findInScope(actor, loanId, meta);

    const existing = await this.loadActive(actor.orgId, loanId);
    if (existing) {
      return this.getForLoan(actor, loanId, meta);
    }

    // Rule 21 / Scenario 7: no schedule before the money moved, and Scenario 22:
    // an ineligible loan may not enter a new collection cycle.
    if (loan.status !== 'ACTIVE' || !loan.disbursementDate) {
      throw new ConflictException(
        'A repayment schedule can only be generated for a disbursed, active loan',
      );
    }

    const computed = this.compute(loan, actor, meta, null);

    try {
      await this.prisma.$transaction(async (tx) => {
        const created = await this.persist(tx, actor, loan, computed, {
          version: 1,
          reason: null,
          disbursementId: null,
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.REPAYMENT_SCHEDULE_RETRIED,
            entityType: 'REPAYMENT_SCHEDULE',
            entityId: created.repaymentScheduleId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              loanId,
              version: 1,
              installmentCount: computed.installmentCount,
              totalPayablePaise: computed.totalPayablePaise.toString(),
            },
          },
          tx,
        );
      });
    } catch (error) {
      // Someone else won the race and wrote version 1. Theirs is authoritative;
      // return it rather than surfacing a duplicate-key error the caller can do
      // nothing about (Scenario 31).
      if (isUniqueViolation(error)) {
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.REPAYMENT_SCHEDULE_CONCURRENT_ATTEMPT_REJECTED,
          entityType: 'REPAYMENT_SCHEDULE',
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { loanId, version: 1, resolution: 'returned-existing' },
        });
        return this.getForLoan(actor, loanId, meta);
      }
      throw error;
    }

    return this.getForLoan(actor, loanId, meta);
  }

  /** The view an export renders. Audited as an export, not as a read. */
  async forExport(
    actor: AuthContext,
    loanId: string,
    format: 'csv' | 'pdf',
    meta: RequestMeta,
  ): Promise<RepaymentScheduleView> {
    const loan = await this.loans.findInScope(actor, loanId, meta);
    const schedule = await this.loadActive(actor.orgId, loanId);

    if (!schedule) {
      throw new NotFoundException(NO_SCHEDULE);
    }

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.REPAYMENT_SCHEDULE_EXPORTED,
      entityType: 'REPAYMENT_SCHEDULE',
      entityId: schedule.repaymentScheduleId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { loanId, version: schedule.version, format },
    });

    return this.toView(loan, schedule, [], []);
  }

  /**
   * Why this schedule may not be regenerated.
   *
   * Every reason at once rather than the first one found, so the caller is not
   * led through a sequence of refusals. Takes a client rather than reading
   * `this.prisma` so the authoritative run inside the transaction sees the same
   * rows the update will touch.
   */
  async checkRegenerationBlockers(
    tx: Pick<
      PrismaService,
      'collectionAllocation' | 'penalty' | 'recoveryCase' | 'emi'
    >,
    orgId: string,
    repaymentScheduleId: string,
    loanStatus: string,
    scheduleStatus: string,
  ): Promise<ScheduleRegenerationBlocker[]> {
    const blockers: ScheduleRegenerationBlocker[] = [];

    if (scheduleStatus !== 'ACTIVE') {
      blockers.push({
        key: 'SCHEDULE_NOT_ACTIVE',
        message: `Only the active schedule can be regenerated; this one is ${scheduleStatus.toLowerCase()}`,
      });
    }

    // Scenario 22: an inactive or ineligible loan may not enter a new cycle.
    if (loanStatus !== 'ACTIVE') {
      blockers.push({
        key: 'LOAN_NOT_ACTIVE',
        message: `The loan is ${loanStatus.toLowerCase()} and cannot take a new repayment schedule`,
      });
    }

    const emiIds = (
      await tx.emi.findMany({
        where: { orgId, repaymentScheduleId },
        select: { emiId: true },
      })
    ).map((row) => row.emiId);

    if (emiIds.length === 0) return blockers;

    const scope = { orgId, emiId: { in: emiIds } };

    // The three tables that hold a foreign key into `Emi`. Any row in any of
    // them is financial history attached to an installment this regeneration
    // would replace (Rules 21, 23; Scenarios 17, 19, 20).
    const [allocations, penalties, recoveryCases] = await Promise.all([
      tx.collectionAllocation.count({ where: scope }),
      tx.penalty.count({ where: scope }),
      tx.recoveryCase.count({ where: scope }),
    ]);

    if (allocations > 0) {
      blockers.push({
        key: 'ALLOCATIONS_EXIST',
        message: `${allocations} payment allocation${allocations === 1 ? '' : 's'} reference this schedule`,
        count: allocations,
      });
    }

    if (penalties > 0) {
      blockers.push({
        key: 'PENALTIES_EXIST',
        message: `${penalties} penalt${penalties === 1 ? 'y references' : 'ies reference'} this schedule`,
        count: penalties,
      });
    }

    if (recoveryCases > 0) {
      blockers.push({
        key: 'RECOVERY_CASES_EXIST',
        message: `${recoveryCases} recovery case${recoveryCases === 1 ? '' : 's'} reference this schedule`,
        count: recoveryCases,
      });
    }

    return blockers;
  }

  /** Recompute from the loan's own terms. Nothing the caller sent reaches here. */
  private compute(
    loan: LoanWithRelations,
    actor: AuthContext,
    meta: RequestMeta,
    scheduleId: string | null,
  ): EmiSchedule {
    const anchor = loan.disbursementDate;

    if (!anchor) {
      throw new ConflictException('Disbursement Date is required');
    }

    try {
      return computeSchedule({
        principalPaise: loan.principalAmountPaise,
        annualRateBps: loan.interestRateBps,
        interestType: loan.interestType,
        frequency: loan.repaymentFrequency,
        durationCount: loan.durationCount,
        startDate: toIsoDate(anchor),
      });
    } catch (error) {
      if (error instanceof EmiCalculationError) {
        // Scenarios 28, 44: the failure is recorded and nothing is activated.
        // Fire-and-forget because the throw below is what the caller sees, and
        // an audit write that failed must not mask the real reason.
        void this.audit
          .record({
            orgId: actor.orgId,
            action: AuditAction.REPAYMENT_SCHEDULE_GENERATION_FAILED,
            entityType: 'REPAYMENT_SCHEDULE',
            ...(scheduleId ? { entityId: scheduleId } : {}),
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              loanId: loan.loanId,
              code: error.code,
              detail: error.message,
            },
          })
          .catch((auditError: unknown) => {
            this.logger.error(
              `Failed to audit schedule generation failure for loan ${loan.loanId}`,
              auditError,
            );
          });

        throw new ConflictException(
          `These loan terms produce no repayment schedule (${error.message})`,
        );
      }
      throw error;
    }
  }

  /**
   * Write a schedule and its installments.
   *
   * `openingPrincipalPaise` is the previous installment's closing balance, and
   * the financed principal on the first — which is what makes the persisted
   * rows reconcile to the principal exactly (Scenario 11).
   */
  private async persist(
    tx: Pick<TransitionTx, 'repaymentSchedule' | 'emi'>,
    actor: AuthContext,
    loan: LoanWithRelations,
    computed: EmiSchedule,
    options: {
      version: number;
      reason: string | null;
      disbursementId: string | null;
    },
  ): Promise<{ repaymentScheduleId: string }> {
    const created = await tx.repaymentSchedule.create({
      data: {
        orgId: actor.orgId,
        loanId: loan.loanId,
        disbursementId: options.disbursementId,
        version: options.version,
        generatedAt: new Date(),
        generatedBy: actor.userId,
        status: 'ACTIVE',
        regenerationReason: options.reason,
      },
    });

    let opening = loan.principalAmountPaise;

    for (const installment of computed.installments) {
      await tx.emi.create({
        data: {
          orgId: actor.orgId,
          repaymentScheduleId: created.repaymentScheduleId,
          loanId: loan.loanId,
          installmentNumber: installment.installmentNumber,
          dueDate: kolkataDate(installment.dueDate),
          openingPrincipalPaise: opening,
          principalDuePaise: installment.principalPaise,
          interestDuePaise: installment.interestPaise,
          totalDuePaise: installment.totalPaise,
          // Generation is never a payment (Rules 12, 13, 14).
          paidAmountPaise: 0n,
          outstandingAmountPaise: installment.totalPaise,
          status: 'PENDING',
        },
      });

      opening = installment.closingBalancePaise;
    }

    return created;
  }

  private async loadActive(orgId: string, loanId: string) {
    return this.prisma.repaymentSchedule.findFirst({
      where: { orgId, loanId, status: 'ACTIVE' },
      include: { emis: { orderBy: { installmentNumber: 'asc' } } },
    });
  }

  private toView(
    loan: LoanWithRelations,
    schedule: ScheduleWithEmis,
    blockers: ScheduleRegenerationBlocker[],
    priorVersions: PriorVersionRow[],
  ): RepaymentScheduleView {
    const today = todayInKolkata();
    const installments = schedule.emis.map((emi) => toEmiRow(emi, today));

    return {
      repaymentScheduleId: schedule.repaymentScheduleId,
      loan: toLoanSummary(loan),
      version: schedule.version,
      status: schedule.status,
      generatedAt: schedule.generatedAt.toISOString(),
      ...(schedule.supersededAt
        ? { supersededAt: schedule.supersededAt.toISOString() }
        : {}),
      ...(schedule.regenerationReason
        ? { regenerationReason: schedule.regenerationReason }
        : {}),
      expectedVersion: schedule.updatedAt.toISOString(),
      totals: totalsOf(schedule.emis),
      installments,
      canRegenerate: blockers.length === 0,
      regenerationBlockers: blockers,
      priorVersions: priorVersions.map((row) => ({
        repaymentScheduleId: row.repaymentScheduleId,
        version: row.version,
        generatedAt: row.generatedAt.toISOString(),
        ...(row.supersededAt
          ? { supersededAt: row.supersededAt.toISOString() }
          : {}),
        ...(row.regenerationReason
          ? { regenerationReason: row.regenerationReason }
          : {}),
      })) satisfies SupersededScheduleRef[],
    };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers. Exported where a test or another module needs them.
// ---------------------------------------------------------------------------

export interface EmiLike {
  emiId: string;
  installmentNumber: number;
  dueDate: Date;
  openingPrincipalPaise: bigint;
  principalDuePaise: bigint;
  interestDuePaise: bigint;
  totalDuePaise: bigint;
  paidAmountPaise: bigint;
  outstandingAmountPaise: bigint;
  status: EmiStatus;
  paidAt: Date | null;
}

type ScheduleWithEmis = {
  repaymentScheduleId: string;
  loanId: string;
  disbursementId: string | null;
  version: number;
  status: 'ACTIVE' | 'SUPERSEDED' | 'CANCELLED';
  generatedAt: Date;
  supersededAt: Date | null;
  regenerationReason: string | null;
  updatedAt: Date;
  emis: EmiLike[];
};

type PriorVersionRow = {
  repaymentScheduleId: string;
  version: number;
  generatedAt: Date;
  supersededAt: Date | null;
  regenerationReason: string | null;
};

/**
 * The status to show for an installment, given today's business date.
 *
 * A settled status is never overridden: once a payment has moved a row to
 * `PARTIALLY_PAID`, `PAID`, `WAIVED` or `CANCELLED`, that is a fact about money
 * and the calendar does not change it. Rule 33 — a part-payment must not rewrite
 * the contractual EMI — is the same idea one level down.
 *
 * Everything else is a comparison against the Asia/Kolkata business date, on
 * `CivilDate` integers rather than `Date` objects so no timezone conversion can
 * shift an installment across a day boundary (Scenarios 23, 24, 39).
 */
export function deriveEmiStatus(
  status: EmiStatus,
  dueDate: CivilDate,
  today: CivilDate,
): EmiStatus {
  if (
    status === 'PAID' ||
    status === 'PARTIALLY_PAID' ||
    status === 'WAIVED' ||
    status === 'CANCELLED'
  ) {
    return status;
  }

  const comparison = compareCivilDates(dueDate, today);
  if (comparison > 0) return 'PENDING';
  if (comparison === 0) return 'DUE';
  return 'OVERDUE';
}

/** Negative when `a` is earlier, zero when equal, positive when later. */
export function compareCivilDates(a: CivilDate, b: CivilDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/**
 * One persisted installment as the wire sees it.
 *
 * Exported because Module 09's disbursement-keyed schedule read renders the
 * same rows: two mappings would be two places for `effectiveStatus` to be
 * derived differently, and the whole point of deriving it is that every surface
 * agrees.
 */
export function toEmiRow(emi: EmiLike, today: CivilDate): EmiRow {
  const dueDate = toIsoDate(emi.dueDate);

  return {
    emiId: emi.emiId,
    installmentNumber: emi.installmentNumber,
    dueDate,
    openingPrincipalPaise: emi.openingPrincipalPaise.toString(),
    principalDuePaise: emi.principalDuePaise.toString(),
    interestDuePaise: emi.interestDuePaise.toString(),
    totalDuePaise: emi.totalDuePaise.toString(),
    paidAmountPaise: emi.paidAmountPaise.toString(),
    outstandingAmountPaise: emi.outstandingAmountPaise.toString(),
    status: emi.status,
    effectiveStatus: deriveEmiStatus(emi.status, parseIsoDate(dueDate), today),
    ...(emi.paidAt ? { paidAt: emi.paidAt.toISOString() } : {}),
  };
}

/**
 * The Schedule Summary block, summed from the persisted rows.
 *
 * Exported so the reconciliation invariants of Scenarios 11 and 12 can be
 * asserted directly against it.
 */
export function totalsOf(emis: EmiLike[]): ScheduleTotals {
  let principal = 0n;
  let interest = 0n;
  let total = 0n;
  let paid = 0n;
  let outstanding = 0n;

  for (const emi of emis) {
    principal += emi.principalDuePaise;
    interest += emi.interestDuePaise;
    total += emi.totalDuePaise;
    paid += emi.paidAmountPaise;
    outstanding += emi.outstandingAmountPaise;
  }

  const nextDueDate = nextDueDateOf(emis);

  return {
    installmentCount: emis.length,
    totalPrincipalPaise: principal.toString(),
    totalInterestPaise: interest.toString(),
    totalPayablePaise: total.toString(),
    totalPaidPaise: paid.toString(),
    outstandingPaise: outstanding.toString(),
    ...(nextDueDate ? { nextDueDate } : {}),
  };
}

/**
 * The earliest installment still owing anything.
 *
 * Keyed on outstanding rather than on status, so it stays correct without
 * consulting the business date: a fully-paid installment owes nothing whatever
 * the calendar says, and an unpaid one is next whether it reads pending, due or
 * overdue.
 */
function nextDueDateOf(
  emis: { dueDate: Date; outstandingAmountPaise: bigint }[],
): string | undefined {
  const pending = emis
    .filter((emi) => emi.outstandingAmountPaise > 0n)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  return pending[0] ? toIsoDate(pending[0].dueDate) : undefined;
}

function toLoanSummary(loan: LoanWithRelations): ScheduleLoanSummary {
  return {
    loanId: loan.loanId,
    loanNumber: loan.loanNumber,
    customerId: loan.customerId,
    customerName: loan.customer.fullName,
    branchId: loan.branchId,
    branchName: loan.branch.name,
    status: loan.status as ScheduleLoanSummary['status'],
    principalAmountPaise: loan.principalAmountPaise.toString(),
    interestRateBps: loan.interestRateBps.toString(),
    interestType: loan.interestType,
    repaymentFrequency: loan.repaymentFrequency,
    durationCount: loan.durationCount,
    ...(loan.disbursementDate
      ? { disbursementDate: toIsoDate(loan.disbursementDate) }
      : {}),
  };
}

/**
 * A `YYYY-MM-DD` string as the Date a `@db.Date` column expects.
 *
 * Noon Asia/Kolkata rather than midnight so no timezone conversion anywhere in
 * the stack can shift it across a day boundary — the same idiom
 * `DisbursementService` uses, for the same reason.
 */
function kolkataDate(value: string): Date {
  return new Date(`${value}T12:00:00+05:30`);
}

/**
 * Prisma's unique-constraint violation.
 *
 * The message is consulted as well as the code because on Prisma 7 with the
 * `@prisma/adapter-pg` driver adapter, `meta.target` is not reliably populated
 * — the same finding `DisbursementService` documents.
 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'P2002') return true;
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === 'string' && message.includes('Unique constraint failed')
  );
}
