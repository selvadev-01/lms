import { Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { TransitionTx } from '../applications/application-transition.service';

export const LOANS_VIEW_PERMISSION = 'loans.view';

/**
 * The most a single list read returns.
 *
 * The portfolio renders every row it is given, so this is what keeps that page
 * bounded. Newest-first ordering makes the cap fall on the oldest loans, which
 * are the least likely to be what a clerk opened the screen for.
 */
const LIST_LIMIT = 100;

const NOT_REACHABLE = 'Loan not found';

/**
 * The `Loan` row — created by Module 09, read by Modules 10 onwards.
 *
 * # Why this is separate from `DisbursementService`
 *
 * A loan outlives the disbursal that created it. Every later module —
 * repayment schedule, collections, overdue, recovery, closure — needs to reach
 * a loan in scope, and none of them should have to import the disbursal
 * service to do it. This file is what they will import.
 *
 * It is deliberately small for now: scope resolution and number allocation.
 * Module 09 is the only writer, so anything beyond that would be speculative.
 */
@Injectable()
export class LoanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The loans a caller may see, optionally for one customer.
   *
   * Added for the customer portfolio, which needed the one thing this module
   * had no route for: every loan route until now hung off a `loanId` the caller
   * already knew, so "what has this borrower taken" could not be asked.
   *
   * The branch clause is the same expression `findInScope` uses, deliberately —
   * a Branch Admin sees their branch's loans and nobody else's, and a second
   * hand-written scoping rule is how a list endpoint ends up wider than the
   * detail endpoint it summarises.
   *
   * No audit row: this is a list read, following `MasterDataService`'s reasoning
   * that auditing every list render buries the mutations that matter. Reaching
   * an individual loan still audits a denial.
   */
  async list(
    actor: AuthContext,
    query: { customerId?: string; loanId?: string },
  ): Promise<LoanWithRelations[]> {
    return this.prisma.loan.findMany({
      where: {
        orgId: actor.orgId,
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.loanId ? { loanId: query.loanId } : {}),
      },
      include: LOAN_INCLUDE,
      // Newest first: a portfolio is read top-down and the current loan is the
      // one being asked about.
      orderBy: { createdAt: 'desc' },
      // Capped because the caller renders every row. A seeded fixture already
      // has a customer with 1,663 loans, and while that is not a real book, a
      // long-standing borrower is on the same curve — an uncapped list is a page
      // that gets slower every year until it stops loading. The newest hundred
      // answers "what is this customer doing now", which is the question.
      take: LIST_LIMIT,
    });
  }

  /**
   * A loan the caller may reach, or a 404.
   *
   * The same four rules as `LoanApplicationService.findInScope`, and the shape
   * is copied from it deliberately rather than abstracted: every one of them is
   * a security property, and a shared helper that later grew an option to skip
   * one would be a hole nobody could see from the call site.
   *
   *   1. `orgId` on the query. The tenant boundary, non-negotiable.
   *   2. The branch spread — a caller carrying a branchId is confined to it; a
   *      null branchId (Super Admin) reaches the whole organization.
   *   3. 404 rather than 403. A 403 would confirm the id exists, which is the
   *      disclosure Scenarios 3 and 4 are about.
   *   4. Every denial is audited.
   */
  async findInScope(
    actor: AuthContext,
    loanId: string,
    meta: RequestMeta,
  ): Promise<LoanWithRelations> {
    const row = await this.prisma.loan.findFirst({
      where: {
        orgId: actor.orgId,
        loanId,
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
      },
      include: LOAN_INCLUDE,
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.LOAN_SCOPE_DENIED,
        entityType: 'LOAN',
        entityId: loanId,
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

  /**
   * Allocates the next loan number for the organization.
   *
   * Numeric maximum over the `LN-%` rows, never a lexical sort — the same
   * reasoning as `nextSanctionNumber` and `nextEntryNumber`. A lexical sort
   * would rank `LN-ZZ04` above `LN-000007` and propose a number that already
   * exists; the unique index would then fail the disbursal at the worst moment.
   */
  async nextLoanNumber(
    tx: Pick<TransitionTx, 'loan'>,
    orgId: string,
  ): Promise<string> {
    const rows = await tx.loan.findMany({
      where: { orgId, loanNumber: { startsWith: 'LN-' } },
      select: { loanNumber: true },
    });

    let highest = 0;
    for (const row of rows) {
      const match = /^LN-(\d+)$/.exec(row.loanNumber);
      if (!match?.[1]) continue;
      const value = Number.parseInt(match[1], 10);
      if (value > highest) highest = value;
    }

    return `LN-${String(highest + 1).padStart(6, '0')}`;
  }
}

export const LOAN_INCLUDE = {
  customer: { select: { fullName: true, customerCode: true } },
  branch: { select: { name: true } },
  loanProduct: { select: { code: true, loanType: true } },
  loanScheme: { select: { code: true, name: true } },
} as const;

export type LoanWithRelations = {
  orgId: string;
  loanId: string;
  loanNumber: string;
  branchId: string;
  customerId: string;
  applicationId: string;
  loanProductId: string;
  loanSchemeId: string;
  principalAmountPaise: bigint;
  interestRateBps: bigint;
  interestType: 'FLAT' | 'REDUCING' | 'CUSTOM_RATE';
  repaymentFrequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  durationCount: number;
  status: string;
  sanctionDate: Date | null;
  agreementDate: Date | null;
  disbursementDate: Date | null;
  closureDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  customer: { fullName: string; customerCode: string };
  branch: { name: string };
  loanProduct: { code: string; loanType: string };
  loanScheme: { code: string; name: string };
};
