import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  GeneralLedgerPage,
  GeneralLedgerRow,
  TrialBalance,
  TrialBalanceRow,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  GeneralLedgerQueryDto,
  TrialBalanceQueryDto,
} from './dto/ledger.dto';

/**
 * The statuses that count toward a balance.
 *
 * DRAFT is excluded because a draft is a form being filled in, not a posting.
 * REVERSED is *included* because its own lines are still real — what unwound it
 * is the separate reversing entry, whose opposite lines net it to zero.
 * Excluding REVERSED would count the reversal without counting what it reversed.
 *
 * Not `as const`: Prisma's `in` filter takes a mutable array, and a readonly
 * tuple is rejected by the generated types.
 */
const POSTED_STATUSES: ('POSTED' | 'REVERSED')[] = ['POSTED', 'REVERSED'];

export const LEDGER_VIEW_PERMISSION = 'accounting.ledger.view';
export const LEDGER_RECONCILE_PERMISSION = 'accounting.ledger.reconcile';

/**
 * The general ledger and the trial balance (Module 14 Scenarios 32-34).
 *
 * # Read-only, and derived rather than stored
 *
 * There is no balances table. Every figure here is computed from
 * `journal_lines` at query time, which is what makes Rule 48's "reconciliation
 * must be deterministic" true by construction: a materialized balance is a
 * second source of truth, and the failure mode of a second source of truth is
 * that it drifts silently. At current volumes the aggregation is milliseconds
 * against the `[orgId, accountId]` index; if that ever stops being true, a
 * materialized view is an additive change, whereas a denormalized table with a
 * drift bug is not.
 *
 * # Only POSTED entries count
 *
 * Every query filters on `POSTED_STATUSES` — see the note on that constant for
 * why a REVERSED entry still counts.
 *
 * # Signed balances
 *
 * A balance is a difference, so it carries a sign. For a DEBIT-normal account
 * it is debits minus credits; for a CREDIT-normal account the reverse. The
 * alternative — an unsigned magnitude plus a side discriminator — would force
 * every consumer to branch before it could render a number, and `formatPaise`
 * already parses a leading minus correctly.
 */
@Injectable()
export class GeneralLedgerService {
  private readonly logger = new Logger(GeneralLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * One account's postings, with a running balance (Scenario 32).
   *
   * The running balance is carried forward **server-side** from the opening
   * balance. Computing it in the browser would produce a number that looks like
   * the same figure but is really the client marking its own homework — and it
   * would be wrong on any page but the first, because a page of rows does not
   * know what came before it.
   */
  async ledger(
    actor: AuthContext,
    dto: GeneralLedgerQueryDto,
    meta: RequestMeta,
  ): Promise<GeneralLedgerPage> {
    const account = await this.prisma.account.findFirst({
      where: { orgId: actor.orgId, accountId: dto.accountId },
      select: {
        accountId: true,
        accountCode: true,
        accountName: true,
        normalBalance: true,
      },
    });

    if (!account) {
      this.logger.warn(
        `Account ${dto.accountId} not reachable for org ${actor.orgId}`,
      );
      throw new NotFoundException('Account not found');
    }

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 50;

    const entryWhere = {
      orgId: actor.orgId,
      status: { in: POSTED_STATUSES },
      ...(actor.branchId ? { branchId: actor.branchId } : {}),
      ...(dto.sourceType ? { sourceType: dto.sourceType } : {}),
    };

    // Everything before `fromDate`, so the first row on screen continues a real
    // balance rather than starting from zero.
    const opening = dto.fromDate
      ? await this.sumLines(actor, dto.accountId, {
          ...entryWhere,
          entryDate: { lt: new Date(`${dto.fromDate}T00:00:00Z`) },
        })
      : { debit: 0n, credit: 0n };

    const windowWhere = {
      ...entryWhere,
      ...(dto.fromDate || dto.toDate
        ? {
            entryDate: {
              ...(dto.fromDate
                ? { gte: new Date(`${dto.fromDate}T00:00:00Z`) }
                : {}),
              ...(dto.toDate
                ? { lte: new Date(`${dto.toDate}T00:00:00Z`) }
                : {}),
            },
          }
        : {}),
    };

    const lineWhere = {
      orgId: actor.orgId,
      accountId: dto.accountId,
      journalEntry: windowWhere,
    };

    const [rows, total, windowTotals] = await Promise.all([
      this.prisma.journalLine.findMany({
        where: lineWhere,
        include: {
          journalEntry: {
            select: {
              journalEntryId: true,
              entryNumber: true,
              entryDate: true,
              description: true,
              sourceType: true,
              sourceId: true,
              postedAt: true,
            },
          },
        },
        orderBy: [
          { journalEntry: { entryDate: 'asc' } },
          { journalEntry: { entryNumber: 'asc' } },
          { lineNumber: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.journalLine.count({ where: lineWhere }),
      this.sumLines(actor, dto.accountId, windowWhere),
    ]);

    // Rows before this page, so the running balance is right on page 2 as well
    // as page 1.
    const priorOnPage =
      page > 1
        ? await this.sumFirstN(
            actor,
            dto.accountId,
            windowWhere,
            (page - 1) * pageSize,
          )
        : { debit: 0n, credit: 0n };

    const sign = account.normalBalance === 'DEBIT' ? 1n : -1n;
    const openingBalance =
      sign * (opening.debit - opening.credit) +
      sign * (priorOnPage.debit - priorOnPage.credit);

    let running = openingBalance;
    const ledgerRows: GeneralLedgerRow[] = rows.map((line) => {
      running += sign * (line.debitPaise - line.creditPaise);
      return {
        journalLineId: line.journalLineId,
        journalEntryId: line.journalEntry.journalEntryId,
        entryNumber: line.journalEntry.entryNumber,
        entryDate: line.journalEntry.entryDate.toISOString().slice(0, 10),
        ...(line.journalEntry.description
          ? { description: line.journalEntry.description }
          : {}),
        ...(line.journalEntry.sourceType
          ? { sourceType: line.journalEntry.sourceType }
          : {}),
        ...(line.journalEntry.sourceId
          ? { sourceId: line.journalEntry.sourceId }
          : {}),
        debitPaise: line.debitPaise.toString(),
        creditPaise: line.creditPaise.toString(),
        runningBalancePaise: running.toString(),
        postedAt: (line.journalEntry.postedAt ?? new Date(0)).toISOString(),
      };
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LEDGER_VIEWED,
      entityType: 'ACCOUNT',
      entityId: dto.accountId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        accountCode: account.accountCode,
        fromDate: dto.fromDate ?? null,
        toDate: dto.toDate ?? null,
        rowCount: total,
      },
    });

    const closing =
      sign * (opening.debit - opening.credit) +
      sign * (windowTotals.debit - windowTotals.credit);

    return {
      accountId: account.accountId,
      accountCode: account.accountCode,
      accountName: account.accountName,
      normalBalance: account.normalBalance,
      ...(dto.fromDate ? { fromDate: dto.fromDate } : {}),
      ...(dto.toDate ? { toDate: dto.toDate } : {}),
      openingBalancePaise: (sign * (opening.debit - opening.credit)).toString(),
      closingBalancePaise: closing.toString(),
      totalDebitPaise: windowTotals.debit.toString(),
      totalCreditPaise: windowTotals.credit.toString(),
      rows: ledgerRows,
      total,
    };
  }

  /**
   * Every account's balance, and the assertion that they sum to zero.
   *
   * `balanced: false` here does not mean a form was filled in wrongly — it
   * means the ledger itself is broken, because every posted entry balances
   * individually and a sum of balanced entries cannot be unbalanced. It is
   * reported rather than thrown so the report still renders and shows *which*
   * accounts are involved.
   */
  async trialBalance(
    actor: AuthContext,
    dto: TrialBalanceQueryDto,
    meta: RequestMeta,
  ): Promise<TrialBalance> {
    const asOfDate = dto.asOfDate ?? this.businessDate();

    const grouped = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        orgId: actor.orgId,
        journalEntry: {
          orgId: actor.orgId,
          status: { in: POSTED_STATUSES },
          ...(actor.branchId ? { branchId: actor.branchId } : {}),
          entryDate: {
            lte: new Date(`${asOfDate}T00:00:00Z`),
            ...(dto.fromDate
              ? { gte: new Date(`${dto.fromDate}T00:00:00Z`) }
              : {}),
          },
        },
      },
      _sum: { debitPaise: true, creditPaise: true },
    });

    const accounts = await this.prisma.account.findMany({
      where: { orgId: actor.orgId },
      select: {
        accountId: true,
        accountCode: true,
        accountName: true,
        accountType: true,
        normalBalance: true,
      },
      orderBy: { accountCode: 'asc' },
    });

    const sums = new Map(
      grouped.map((row) => [
        row.accountId,
        {
          debit: row._sum.debitPaise ?? 0n,
          credit: row._sum.creditPaise ?? 0n,
        },
      ]),
    );

    let totalDebit = 0n;
    let totalCredit = 0n;
    const rows: TrialBalanceRow[] = [];

    for (const account of accounts) {
      const sum = sums.get(account.accountId) ?? { debit: 0n, credit: 0n };
      const net = sum.debit - sum.credit;

      if (net === 0n && sum.debit === 0n && !dto.includeZero) continue;

      totalDebit += sum.debit;
      totalCredit += sum.credit;

      // The side a balance sits on is decided by its sign, not by the
      // account's normal balance: an asset account that has gone into credit
      // belongs in the credit column, and reporting it as a negative debit
      // would make the columns fail to add up.
      const side = net >= 0n ? 'DEBIT' : 'CREDIT';
      const magnitude = net >= 0n ? net : -net;

      rows.push({
        accountId: account.accountId,
        accountCode: account.accountCode,
        accountName: account.accountName,
        accountType: account.accountType,
        normalBalance: account.normalBalance,
        debitPaise: sum.debit.toString(),
        creditPaise: sum.credit.toString(),
        balancePaise: magnitude.toString(),
        balanceSide: side,
      });
    }

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.TRIAL_BALANCE_VIEWED,
      entityType: 'ORGANIZATION',
      entityId: actor.orgId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { asOfDate, accountCount: rows.length },
    });

    return {
      asOfDate,
      rows,
      totalDebitPaise: totalDebit.toString(),
      totalCreditPaise: totalCredit.toString(),
      balanced: totalDebit === totalCredit,
    };
  }

  // --- internals -----------------------------------------------------------

  private async sumLines(
    actor: AuthContext,
    accountId: string,
    entryWhere: Record<string, unknown>,
  ): Promise<{ debit: bigint; credit: bigint }> {
    const result = await this.prisma.journalLine.aggregate({
      where: {
        orgId: actor.orgId,
        accountId,
        journalEntry: entryWhere,
      },
      _sum: { debitPaise: true, creditPaise: true },
    });

    return {
      debit: result._sum.debitPaise ?? 0n,
      credit: result._sum.creditPaise ?? 0n,
    };
  }

  /**
   * The first `take` rows of the same ordered window, summed.
   *
   * Needed so the running balance is correct on page 2 onward. A cheaper
   * approach would be to have the client carry the previous page's closing
   * balance, but that is the client computing money again, and it breaks the
   * moment somebody links directly to page 3.
   */
  private async sumFirstN(
    actor: AuthContext,
    accountId: string,
    entryWhere: Record<string, unknown>,
    take: number,
  ): Promise<{ debit: bigint; credit: bigint }> {
    if (take <= 0) return { debit: 0n, credit: 0n };

    const rows = await this.prisma.journalLine.findMany({
      where: {
        orgId: actor.orgId,
        accountId,
        journalEntry: entryWhere,
      },
      select: { debitPaise: true, creditPaise: true },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { journalEntry: { entryNumber: 'asc' } },
        { lineNumber: 'asc' },
      ],
      take,
    });

    let debit = 0n;
    let credit = 0n;
    for (const row of rows) {
      debit += row.debitPaise;
      credit += row.creditPaise;
    }
    return { debit, credit };
  }

  /** Today in Asia/Kolkata — the authoritative accounting business date. */
  private businessDate(): string {
    return new Date(Date.now() + 5.5 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }
}
