import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  assessPenalty,
  daysPastDue,
  PenaltyConfigurationError,
  todayInKolkata,
  type CivilDate,
  type PenaltyRuleInput,
} from '@lms/emi';
import type { PenaltySummary } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { LoanService } from '../../loans/shared/loan.service';
import { toPenaltySummary } from '../recovery.mapper';
import type { AssessPenaltyDto, PenaltyActionDto } from '../dto/recovery.dto';

export const PENALTIES_ASSESS_PERMISSION = 'penalties.assess';
export const PENALTIES_WAIVE_PERMISSION = 'penalties.waive';

const NOT_REACHABLE = 'Penalty not found';

/**
 * Module 13 — penal interest assessment.
 *
 * # This is the assessment Module 11 deferred
 *
 * `CollectionService.loadAllocationTargets` says it outright: *"Penalties are
 * consumed, never accrued: Module 11 allocates what already exists as a
 * `Penalty` row and never computes one. Module 13 owns assessment."* This file
 * is that owner, and it is the only writer of `penalties`.
 *
 * # No journal is posted at assessment
 *
 * A deliberate consequence of the ledger being cash-basis. `postDisbursement`
 * raises only principal as an asset; interest and penalty are recognised as
 * income at the moment of collection, through `postCollection` crediting 4200.
 * Posting an accrual entry here would need a penalty-receivable account that
 * does not exist, and creating one would double-count every penalty ever
 * collected — once on accrual and again on receipt.
 *
 * So an assessment creates a `Penalty` row and nothing else. The money reaches
 * the ledger when Module 11 allocates a payment against it. The source's
 * Scenario 22 describes an accrual ledger; this system's is documented in
 * `ledger-accounts.ts` and the two disagree deliberately.
 *
 * # Duplicate accrual is prevented structurally
 *
 * Scenario 19 requires a retried accrual not to charge twice. A service-side
 * "have we already?" check is a read followed by a write, and two concurrent
 * assessments both pass it. The guarantee is the
 * `penalties_accrual_basis_key` unique index over
 * (org, loan, emi, rule, assessed date); this service catches the violation and
 * resolves it into the existing row, exactly as the collection service resolves
 * an idempotency-key race.
 */
@Injectable()
export class PenaltyService {
  private readonly logger = new Logger(PenaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly loans: LoanService,
  ) {}

  /**
   * Assesses penal interest for a loan, or returns what was already assessed.
   *
   * # The ordering
   *
   * Scope outside the transaction (for the 404), then the whole assessment
   * inside one, with the unique index arbitrating a concurrent duplicate. The
   * amount is computed from the resolved rule and the authoritative balances —
   * never from anything the caller sent.
   */
  async assess(
    actor: AuthContext,
    dto: AssessPenaltyDto,
    meta: RequestMeta,
  ): Promise<PenaltySummary[]> {
    await this.loans.findInScope(actor, dto.loanId, meta);

    const today = todayInKolkata();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Re-read inside the transaction, with the same scope predicate, so a
        // loan that moved out of reach between the check and the write is not
        // assessed against.
        const loan = await tx.loan.findFirst({
          where: {
            orgId: actor.orgId,
            loanId: dto.loanId,
            ...(actor.branchId ? { branchId: actor.branchId } : {}),
          },
          include: {
            repaymentSchedules: {
              where: { status: 'ACTIVE' },
              include: { emis: { orderBy: { installmentNumber: 'asc' } } },
            },
            penaltyRuleOverrides: { include: { penaltyRule: true } },
            loanScheme: {
              include: {
                penaltyRuleOverrides: { include: { penaltyRule: true } },
              },
            },
          },
        });

        if (!loan) throw new NotFoundException('Loan not found');

        const rule = this.resolveRule(loan);
        if (!rule) {
          throw new BadRequestException(
            'No penalty rule is configured for this loan.',
          );
        }

        const schedule = loan.repaymentSchedules[0];
        if (!schedule) {
          throw new BadRequestException(
            'This loan has no active repayment schedule to assess against.',
          );
        }

        const targets = schedule.emis.filter((emi) => {
          if (dto.emiId && emi.emiId !== dto.emiId) return false;
          if (emi.outstandingAmountPaise <= 0n) return false;
          return daysPastDue(toCivil(emi.dueDate), today) > 0;
        });

        const rows: PenaltySummary[] = [];

        for (const emi of targets) {
          const assessment = assessPenalty(rule.input, {
            outstandingPaise: emi.outstandingAmountPaise,
            emiAmountPaise: emi.totalDuePaise,
            daysPastDue: daysPastDue(toCivil(emi.dueDate), today),
          });

          // A zero charge is a legitimate answer — inside the grace period, or
          // nothing owed. Writing a zero row would clutter every borrower's
          // history with charges that are not charges.
          if (assessment.amountPaise <= 0n) continue;

          const existing = await tx.penalty.findFirst({
            where: {
              orgId: actor.orgId,
              loanId: loan.loanId,
              emiId: emi.emiId,
              penaltyRuleId: rule.penaltyRuleId,
              assessedDate: this.civilToDate(today),
              status: { notIn: ['CANCELLED', 'WAIVED'] },
            },
          });

          if (existing) {
            // Scenario 19: the retry resolves to the original rather than
            // charging again.
            rows.push(toPenaltySummary(existing));
            continue;
          }

          const penalty = await tx.penalty.create({
            data: {
              orgId: actor.orgId,
              loanId: loan.loanId,
              emiId: emi.emiId,
              penaltyRuleId: rule.penaltyRuleId,
              assessedDate: this.civilToDate(today),
              amountPaise: assessment.amountPaise,
              paidAmountPaise: 0n,
              outstandingAmountPaise: assessment.amountPaise,
              calculationType: rule.input.calculationType,
              // Cast because Prisma's `InputJsonValue` wants an index
              // signature and the snapshot is a closed interface — deliberately
              // so, since its fields are the replay contract (Rule 12). The
              // shape is validated by `penalty.test.ts`'s JSON round-trip
              // assertion, not by widening it here.
              calculationSnapshot: assessment.snapshot as unknown as Record<
                string,
                string | number | null
              >,
              status: 'ASSESSED',
              createdBy: actor.userId,
            },
          });

          await this.audit.record(
            {
              orgId: actor.orgId,
              action: AuditAction.PENALTY_ASSESSED,
              entityType: 'PENALTY',
              entityId: penalty.penaltyId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
              metadata: {
                loanId: loan.loanId,
                emiId: emi.emiId,
                amountPaise: assessment.amountPaise.toString(),
                daysPastDue: assessment.snapshot.daysPastDue,
                chargeableDays: assessment.snapshot.chargeableDays,
              },
            },
            tx,
          );

          rows.push(toPenaltySummary(penalty));
        }

        return rows;
      });

      return created;
    } catch (error) {
      // A concurrent assessment won the race. Its row is the authoritative one;
      // read it back rather than reporting a conflict the caller cannot act on.
      if (this.isUniqueViolation(error, 'penalties_accrual_basis_key')) {
        await this.audit
          .record({
            orgId: actor.orgId,
            action: AuditAction.PENALTY_DUPLICATE_IGNORED,
            entityType: 'PENALTY',
            entityId: dto.loanId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            metadata: { loanId: dto.loanId },
          })
          .catch(() => {});

        return this.listForLoan(actor.orgId, dto.loanId);
      }

      // A misconfigured rule cannot produce a figure. Surfaced as a 400 naming
      // the problem rather than as a silent zero charge, which would quietly
      // forgive every borrower under that rule.
      if (error instanceof PenaltyConfigurationError) {
        await this.audit
          .record({
            orgId: actor.orgId,
            action: AuditAction.PENALTY_ASSESSMENT_FAILED,
            entityType: 'PENALTY',
            entityId: dto.loanId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            metadata: { loanId: dto.loanId, code: error.code },
          })
          .catch(() => {});

        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  /**
   * Waives, adjusts or cancels an assessed penalty (Scenario 20).
   *
   * The original `Penalty` row is never edited away: `amountPaise` keeps the
   * contractual figure and a `PenaltyAction` records the decision, so the
   * history shows both what was charged and what was forgiven. That is the same
   * shape Rule 31 requires of the ledger, applied to the subsidiary record.
   */
  async act(
    actor: AuthContext,
    penaltyId: string,
    dto: PenaltyActionDto,
    meta: RequestMeta,
  ): Promise<PenaltySummary> {
    if (dto.action === 'ADJUST' && dto.amountPaise === undefined) {
      throw new BadRequestException(
        'An adjustment needs the amount to adjust to.',
      );
    }
    if (dto.action !== 'ADJUST' && dto.amountPaise !== undefined) {
      throw new BadRequestException('Only an adjustment carries an amount.');
    }

    return this.prisma.$transaction(async (tx) => {
      const penalty = await tx.penalty.findFirst({
        where: {
          orgId: actor.orgId,
          penaltyId,
          ...(actor.branchId ? { loan: { branchId: actor.branchId } } : {}),
        },
      });

      if (!penalty) {
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.PENALTY_SCOPE_DENIED,
          entityType: 'PENALTY',
          entityId: penaltyId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { actorBranchId: actor.branchId },
        });
        throw new NotFoundException(NOT_REACHABLE);
      }

      if (penalty.status === 'PAID') {
        throw new ConflictException(
          'This penalty has been paid. Correct it with a reversal on the collection, not a waiver.',
        );
      }
      if (penalty.status === 'WAIVED' || penalty.status === 'CANCELLED') {
        throw new ConflictException(
          'This penalty has already been resolved and cannot be changed again.',
        );
      }

      const adjusted =
        dto.amountPaise !== undefined ? BigInt(dto.amountPaise) : null;

      if (adjusted !== null && adjusted < penalty.paidAmountPaise) {
        throw new ConflictException(
          'A penalty cannot be adjusted below what has already been paid against it.',
        );
      }

      const status =
        dto.action === 'WAIVE'
          ? 'WAIVED'
          : dto.action === 'CANCEL'
            ? 'CANCELLED'
            : 'ADJUSTED';

      const outstanding =
        dto.action === 'ADJUST' && adjusted !== null
          ? adjusted - penalty.paidAmountPaise
          : 0n;

      const updated = await tx.penalty.update({
        where: {
          orgId_penaltyId: { orgId: actor.orgId, penaltyId },
        },
        data: { status, outstandingAmountPaise: outstanding },
      });

      await tx.penaltyAction.create({
        data: {
          orgId: actor.orgId,
          penaltyId,
          action: dto.action,
          ...(adjusted !== null ? { amountPaise: adjusted } : {}),
          reason: dto.reason,
          performedBy: actor.userId,
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action:
            dto.action === 'WAIVE'
              ? AuditAction.PENALTY_WAIVED
              : dto.action === 'CANCEL'
                ? AuditAction.PENALTY_CANCELLED
                : AuditAction.PENALTY_ADJUSTED,
          entityType: 'PENALTY',
          entityId: penaltyId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: {
            status: penalty.status,
            outstandingAmountPaise: penalty.outstandingAmountPaise.toString(),
          },
          newData: {
            status,
            outstandingAmountPaise: outstanding.toString(),
          },
          metadata: { reason: dto.reason },
        },
        tx,
      );

      return toPenaltySummary(updated);
    });
  }

  private async listForLoan(
    orgId: string,
    loanId: string,
  ): Promise<PenaltySummary[]> {
    const rows = await this.prisma.penalty.findMany({
      where: { orgId, loanId },
      orderBy: { assessedDate: 'asc' },
    });
    return rows.map(toPenaltySummary);
  }

  /**
   * Which rule applies: the loan's override, else the scheme's, else none.
   *
   * The loan-level override may also replace the grace period alone, which is
   * why `graceDays` is read from the override when present rather than always
   * from the rule.
   */
  private resolveRule(loan: RuleBearingLoan): ResolvedRule | null {
    const loanOverride = loan.penaltyRuleOverrides[0];
    if (loanOverride?.penaltyRule) {
      return {
        penaltyRuleId: loanOverride.penaltyRule.penaltyRuleId,
        input: {
          calculationType: loanOverride.penaltyRule
            .calculationType as PenaltyRuleInput['calculationType'],
          rateBps: loanOverride.penaltyRule.rateBps,
          fixedAmountPaise: loanOverride.penaltyRule.fixedAmountPaise,
          graceDays:
            loanOverride.graceDays ?? loanOverride.penaltyRule.graceDays,
        },
      };
    }

    const schemeOverride = loan.loanScheme?.penaltyRuleOverrides[0];
    if (schemeOverride?.penaltyRule) {
      return {
        penaltyRuleId: schemeOverride.penaltyRule.penaltyRuleId,
        input: {
          calculationType: schemeOverride.penaltyRule
            .calculationType as PenaltyRuleInput['calculationType'],
          rateBps: schemeOverride.penaltyRule.rateBps,
          fixedAmountPaise: schemeOverride.penaltyRule.fixedAmountPaise,
          graceDays: schemeOverride.penaltyRule.graceDays,
        },
      };
    }

    return null;
  }

  /**
   * Whether a Prisma error is a unique violation on a named constraint.
   *
   * Matches on the **message string**, not `meta.target`, which is unreliable
   * under Prisma 7 with the pg adapter — the same reason
   * `CollectionService.isUniqueViolation` does.
   */
  private isUniqueViolation(error: unknown, constraint: string): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as { code?: unknown; message?: unknown };
    if (candidate.code !== 'P2002') return false;
    const message =
      typeof candidate.message === 'string' ? candidate.message : '';
    return message.includes(constraint);
  }

  /** Midday, so no timezone conversion can move a DATE across a day boundary. */
  private civilToDate(date: CivilDate): Date {
    const month = String(date.month).padStart(2, '0');
    const day = String(date.day).padStart(2, '0');
    return new Date(`${date.year}-${month}-${day}T12:00:00+05:30`);
  }
}

function toCivil(value: Date): CivilDate {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

interface ResolvedRule {
  penaltyRuleId: string;
  input: PenaltyRuleInput;
}

type RuleRow = {
  penaltyRuleId: string;
  calculationType: string;
  rateBps: bigint | null;
  fixedAmountPaise: bigint | null;
  graceDays: number;
};

type RuleBearingLoan = {
  penaltyRuleOverrides: {
    graceDays: number | null;
    penaltyRule: RuleRow | null;
  }[];
  loanScheme: {
    penaltyRuleOverrides: { penaltyRule: RuleRow | null }[];
  } | null;
};
