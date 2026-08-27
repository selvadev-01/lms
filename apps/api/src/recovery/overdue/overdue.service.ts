import { Injectable } from '@nestjs/common';
import {
  daysPastDue,
  summarizeOverdue,
  todayInKolkata,
  type CivilDate,
  type OverdueObligation,
} from '@lms/emi';
import type {
  LoanStatus,
  OverdueDetail,
  OverdueInstallment,
  OverdueListResult,
  OverdueSummary,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { LoanService } from '../../loans/shared/loan.service';
import { toPenaltySummary } from '../recovery.mapper';
import type { ListOverdueDto } from '../dto/overdue.dto';

export const OVERDUE_VIEW_PERMISSION = 'overdue.view';

/**
 * Module 13 — overdue identification.
 *
 * # Nothing here is stored
 *
 * There is no overdue table and no overdue sweep. Every figure this service
 * returns — days past due, the ageing bucket, the NPA eligibility, the four
 * component totals — is derived on each read from the active repayment
 * schedule, the posted payments and the Asia/Kolkata business date.
 *
 * That is Rule 4 ("overdue status is derived from authoritative repayment
 * obligations") and it is the same decision `deriveEmiStatus` already makes one
 * level down. A stored copy would need a writer, and a writer is a thing that
 * can fail to run: a nightly sweep that missed a night would show a borrower as
 * current for a day, and nobody would know which day. Deriving costs a query
 * and cannot be stale.
 *
 * It is also what makes Scenario 8 true. The same schedule, payments and
 * business date always produce the same answer, because there is no cache
 * between the data and the arithmetic.
 *
 * # Why the business date is never a parameter from the client
 *
 * `todayInKolkata()` reads the server clock in a fixed zone. Rule 14 forbids
 * recovery calculations depending on client device time, and an `asOf` query
 * parameter would be exactly that — a device with a wrong clock, or a curious
 * user, could move a borrower into or out of the overdue book.
 *
 * # Why penalties are read but never assessed here
 *
 * A read must not have a side effect. Assessing on read would mean opening the
 * overdue list charged every borrower on it, and refreshing the page charged
 * them again. `PenaltyService` owns assessment and is called explicitly.
 */
@Injectable()
export class OverdueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly loans: LoanService,
  ) {}

  /**
   * The overdue book for the caller's scope.
   *
   * # Why the filtering happens after the derivation
   *
   * Days past due and the bucket are derived, so they cannot appear in a SQL
   * `WHERE`. The query narrows to loans that *could* be overdue — the right
   * statuses, in scope, with an active schedule carrying an unsettled
   * installment already past its due date — and the derived predicates are
   * applied to the computed rows.
   *
   * The database predicate is deliberately the same boundary the arithmetic
   * uses (`dueDate < today`, outstanding > 0), so it narrows without ever
   * excluding a row the derivation would have kept. A cheaper-but-looser filter
   * would be safe; a tighter one would silently drop overdue borrowers.
   */
  async list(
    actor: AuthContext,
    query: ListOverdueDto,
    meta: RequestMeta,
  ): Promise<OverdueListResult> {
    const today = todayInKolkata();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const loans = await this.prisma.loan.findMany({
      where: {
        orgId: actor.orgId,
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
        status: { in: OVERDUE_ELIGIBLE_LOAN_STATUSES },
        ...(query.search
          ? {
              OR: [
                { loanNumber: { contains: query.search, mode: 'insensitive' } },
                {
                  customer: {
                    fullName: { contains: query.search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
        // Narrows to loans with at least one installment already past due and
        // still owing. The same boundary `summarizeOverdue` applies.
        emis: {
          some: {
            dueDate: { lt: this.civilToDate(today) },
            outstandingAmountPaise: { gt: 0 },
            status: { notIn: ['PAID', 'WAIVED', 'CANCELLED'] },
          },
        },
      },
      include: OVERDUE_LOAN_INCLUDE,
      orderBy: { loanNumber: 'asc' },
    });

    const rows = loans
      .map((loan) => this.deriveSummary(loan, today))
      // A loan can pass the SQL narrowing and still derive to nothing overdue —
      // an installment whose penalties and principal are all settled while the
      // row's own status lags. Dropping them here keeps the list honest.
      .filter((row) => row.daysPastDue > 0)
      .filter((row) => this.matchesDerivedFilters(row, query));

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.OVERDUE_LISTED,
      entityType: 'OVERDUE',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { count: rows.length, actorBranchId: actor.branchId },
    });

    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
    };
  }

  /**
   * One loan's overdue position, with its installments and penalties.
   *
   * Scope is resolved through `LoanService.findInScope`, which gives the 404
   * and audits the denial. Reaching a loan by id is the same security property
   * everywhere, so it uses the same helper rather than repeating the query.
   */
  async detail(
    actor: AuthContext,
    loanId: string,
    meta: RequestMeta,
  ): Promise<OverdueDetail> {
    await this.loans.findInScope(actor, loanId, meta);

    const loan = await this.prisma.loan.findFirstOrThrow({
      where: { orgId: actor.orgId, loanId },
      include: OVERDUE_LOAN_INCLUDE,
    });

    const today = todayInKolkata();
    const summary = this.deriveSummary(loan, today);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.OVERDUE_VIEWED,
      entityType: 'OVERDUE',
      entityId: loanId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const schedule = this.activeSchedule(loan);
    const emis = schedule?.emis ?? [];

    return {
      ...summary,
      installments: emis
        .filter((emi) => emi.outstandingAmountPaise > 0n)
        .filter((emi) => this.isPastDue(emi.dueDate, today))
        .map((emi) => this.toInstallment(emi, loan.penalties, today)),
      penalties: loan.penalties.map(toPenaltySummary),
      totalOutstandingPaise: emis
        .reduce((sum, emi) => sum + emi.outstandingAmountPaise, 0n)
        .toString(),
    };
  }

  /**
   * Derives one loan's overdue position.
   *
   * Public so `RecoveryCaseService` can render the same figures on a case
   * without a second, subtly different derivation — the drift `LoansModule`'s
   * comment about `deriveEmiStatus` warns of, one level up.
   */
  deriveSummary(loan: OverdueLoan, today: CivilDate): OverdueSummary {
    const schedule = this.activeSchedule(loan);
    const position = summarizeOverdue(
      this.toObligations(schedule?.emis ?? [], loan.penalties),
      today,
    );

    const openCase = loan.recoveryCases.find((row) => row.status !== 'CLOSED');

    return {
      loanId: loan.loanId,
      loanNumber: loan.loanNumber,
      customerId: loan.customerId,
      customerName: loan.customer.fullName,
      branchId: loan.branchId,
      ...(loan.branch?.name ? { branchName: loan.branch.name } : {}),
      loanStatus: loan.status,
      ...(position.oldestDueDate
        ? { oldestDueDate: formatCivil(position.oldestDueDate) }
        : {}),
      daysPastDue: position.daysPastDue,
      bucket: position.bucket,
      npaEligibility: position.npaEligibility,
      overduePrincipalPaise: position.overduePrincipalPaise.toString(),
      overdueInterestPaise: position.overdueInterestPaise.toString(),
      overduePenaltyPaise: position.overduePenaltyPaise.toString(),
      overdueFeesPaise: position.overdueFeesPaise.toString(),
      totalOverduePaise: position.totalOverduePaise.toString(),
      ...(openCase
        ? {
            recoveryCaseId: openCase.recoveryCaseId,
            recoveryCaseStatus: openCase.status,
          }
        : {}),
    };
  }

  /**
   * Turns installments and penalties into the obligations the arithmetic sees.
   *
   * # Why an installment's interest and principal are split
   *
   * `Emi.outstandingAmountPaise` is one figure covering both. The source's
   * money identity wants them apart, so the outstanding is apportioned against
   * the contractual split: what has been paid settles interest before principal
   * within an installment, mirroring the appropriation order Module 11 applies,
   * so what remains is principal-heavy in exactly the way the ledger will show.
   *
   * Deriving rather than reading a stored split is deliberate — there is no
   * per-component outstanding column on `Emi`, and adding one would be a second
   * figure to keep in step with `paidAmountPaise`.
   */
  private toObligations(
    emis: readonly OverdueEmi[],
    penalties: readonly OverduePenalty[],
  ): OverdueObligation[] {
    const penaltyByEmi = new Map<string, bigint>();
    let loanLevelPenalty = 0n;

    for (const penalty of penalties) {
      if (
        penalty.status !== 'ASSESSED' &&
        penalty.status !== 'PARTIALLY_PAID'
      ) {
        continue;
      }
      if (penalty.emiId) {
        penaltyByEmi.set(
          penalty.emiId,
          (penaltyByEmi.get(penalty.emiId) ?? 0n) +
            penalty.outstandingAmountPaise,
        );
      } else {
        loanLevelPenalty += penalty.outstandingAmountPaise;
      }
    }

    const obligations: OverdueObligation[] = emis.map((emi) => {
      const paid = emi.paidAmountPaise;
      // Interest is settled first within an installment, so the interest still
      // owing is what the payment did not reach.
      const interestOutstanding =
        emi.interestDuePaise > paid ? emi.interestDuePaise - paid : 0n;
      const principalPaid =
        paid > emi.interestDuePaise ? paid - emi.interestDuePaise : 0n;
      const principalOutstanding =
        emi.principalDuePaise > principalPaid
          ? emi.principalDuePaise - principalPaid
          : 0n;

      return {
        dueDate: toCivil(emi.dueDate),
        principalOutstandingPaise: principalOutstanding,
        interestOutstandingPaise: interestOutstanding,
        penaltyOutstandingPaise: penaltyByEmi.get(emi.emiId) ?? 0n,
        feesOutstandingPaise: 0n,
      };
    });

    // A loan-level penalty rides on the oldest overdue installment so it ages
    // with the debt it belongs to. Attaching it to a synthetic obligation of
    // its own would give it an assessment date the borrower never agreed to a
    // due date for.
    if (loanLevelPenalty > 0n && obligations[0]) {
      const oldest = obligations.reduce((earliest, candidate) =>
        compareCivil(candidate.dueDate, earliest.dueDate) < 0
          ? candidate
          : earliest,
      );
      oldest.penaltyOutstandingPaise += loanLevelPenalty;
    }

    return obligations;
  }

  private toInstallment(
    emi: OverdueEmi,
    penalties: readonly OverduePenalty[],
    today: CivilDate,
  ): OverdueInstallment {
    const penaltyOutstanding = penalties
      .filter((penalty) => penalty.emiId === emi.emiId)
      .filter(
        (penalty) =>
          penalty.status === 'ASSESSED' || penalty.status === 'PARTIALLY_PAID',
      )
      .reduce((sum, penalty) => sum + penalty.outstandingAmountPaise, 0n);

    const due = toCivil(emi.dueDate);

    return {
      emiId: emi.emiId,
      installmentNumber: emi.installmentNumber,
      dueDate: formatCivil(due),
      // The shared helper, not a local day count: an installment reported 31
      // days late while the loan is reported 30 is a discrepancy nobody can
      // explain, and one implementation is what stops the two drifting.
      daysPastDue: daysPastDue(due, today),
      totalDuePaise: emi.totalDuePaise.toString(),
      paidAmountPaise: emi.paidAmountPaise.toString(),
      outstandingAmountPaise: emi.outstandingAmountPaise.toString(),
      penaltyOutstandingPaise: penaltyOutstanding.toString(),
    };
  }

  private matchesDerivedFilters(
    row: OverdueSummary,
    query: ListOverdueDto,
  ): boolean {
    if (query.bucket && row.bucket !== query.bucket) return false;
    if (query.npaStatus && row.npaEligibility !== query.npaStatus) return false;
    if (
      query.minDaysPastDue !== undefined &&
      row.daysPastDue < query.minDaysPastDue
    ) {
      return false;
    }
    return true;
  }

  /**
   * The one ACTIVE schedule, or none.
   *
   * A loan has exactly one at a time; superseded versions carry the history and
   * must never contribute to a current overdue figure.
   */
  private activeSchedule(loan: OverdueLoan): OverdueSchedule | undefined {
    return loan.repaymentSchedules.find(
      (schedule) => schedule.status === 'ACTIVE',
    );
  }

  private isPastDue(dueDate: Date, today: CivilDate): boolean {
    return compareCivil(toCivil(dueDate), today) < 0;
  }

  /**
   * A `CivilDate` as a `Date` for a `@db.Date` comparison.
   *
   * Midday, so no timezone conversion can move it across a day boundary — the
   * same idiom every service in this codebase uses for a DATE column.
   */
  private civilToDate(date: CivilDate): Date {
    return new Date(`${formatCivil(date)}T12:00:00+05:30`);
  }
}

/**
 * Loan statuses whose borrower can be behind on payments.
 *
 * Mutable rather than `as const`, because Prisma's generated `in` filter takes
 * a mutable array. Closed, written-off and foreclosed loans are absent: they
 * have their own lifecycle and an ordinary overdue reading of them would
 * contradict it (Scenario 41).
 */
export const OVERDUE_ELIGIBLE_LOAN_STATUSES: LoanStatus[] = [
  'ACTIVE',
  'OVERDUE',
  'NPA',
  'LEGAL_ESCALATION',
];

export const OVERDUE_LOAN_INCLUDE = {
  customer: { select: { fullName: true, customerCode: true } },
  branch: { select: { name: true, code: true } },
  repaymentSchedules: {
    where: { status: 'ACTIVE' as const },
    include: { emis: { orderBy: { installmentNumber: 'asc' as const } } },
  },
  penalties: true,
  recoveryCases: {
    select: { recoveryCaseId: true, status: true },
  },
} as const;

/** Formats a `CivilDate` as `YYYY-MM-DD` without going through `Date`. */
function formatCivil(date: CivilDate): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${month}-${day}`;
}

/**
 * A `@db.Date` column as a `CivilDate`.
 *
 * Reads the UTC parts, never the local ones. Prisma returns a DATE as midnight
 * UTC, so `getFullYear()` on a machine west of Greenwich would report the
 * previous day — the exact failure `dates.ts` exists to prevent.
 */
function toCivil(value: Date): CivilDate {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function compareCivil(a: CivilDate, b: CivilDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

type OverdueEmi = {
  emiId: string;
  installmentNumber: number;
  dueDate: Date;
  principalDuePaise: bigint;
  interestDuePaise: bigint;
  totalDuePaise: bigint;
  paidAmountPaise: bigint;
  outstandingAmountPaise: bigint;
  status: string;
};

type OverduePenalty = {
  penaltyId: string;
  loanId: string;
  emiId: string | null;
  assessedDate: Date;
  amountPaise: bigint;
  paidAmountPaise: bigint;
  outstandingAmountPaise: bigint;
  status: string;
  calculationType: string;
  calculationSnapshot: unknown;
  createdAt: Date;
};

type OverdueSchedule = {
  status: string;
  emis: OverdueEmi[];
};

export type OverdueLoan = {
  loanId: string;
  loanNumber: string;
  branchId: string;
  customerId: string;
  status: OverdueSummary['loanStatus'];
  customer: { fullName: string };
  branch: { name: string; code: string } | null;
  repaymentSchedules: OverdueSchedule[];
  penalties: OverduePenalty[];
  recoveryCases: {
    recoveryCaseId: string;
    status: OverdueSummary['recoveryCaseStatus'] & string;
  }[];
};
