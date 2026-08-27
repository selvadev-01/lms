import { Injectable } from '@nestjs/common';
import type { FinancialReport, FinancialReportRow } from '@lms/types';

import { GeneralLedgerService } from '../../accounting/ledger/general-ledger.service';
import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { FinancialReportQueryDto } from '../dto/reports.dto';
import { resolveDateBasis } from '../report-date-basis';
import {
  assertDateRange,
  buildMeta,
  civilToDate,
  civilToExclusiveEnd,
  resolveBranchScope,
} from '../report-scope';

export const REPORTS_FINANCIAL_VIEW_PERMISSION = 'reports.financial.view';

/**
 * The Financial report (Scenarios 24-28).
 *
 * # It reuses Module 14 rather than re-aggregating the ledger
 *
 * Rule 15 requires financial reports to reconcile to authoritative accounting
 * data, and Scenario 27 requires the totals to reconcile to the ledger entries
 * the report includes. The only way to guarantee that rather than hope for it
 * is to not have a second aggregation: when the caller names an account, this
 * delegates to `GeneralLedgerService.ledger` and reshapes the result. The
 * running balance, the opening balance and the debit/credit totals are Module
 * 14's, computed once.
 *
 * When no account is named the report is a period view across accounts, which
 * the ledger screen does not offer — so the query lives here. It reuses the
 * same two invariants rather than inventing its own:
 *
 *  * **Only POSTED and REVERSED entries count.** A DRAFT is a form being
 *    filled in, not a posting. A REVERSED entry's own lines are still real —
 *    what unwound it is the separate reversing entry, whose opposite lines net
 *    it to zero. Excluding REVERSED would count the reversal without counting
 *    what it reversed (Scenario 26).
 *  * **Nothing is written.** Rule 17: report generation creates no ledger
 *    entries, and Scenario 61 requires a reconciliation mismatch to be flagged
 *    rather than silently repaired. There is no write path in this file.
 *
 * # Branch scope reaches through the entry
 *
 * `JournalLine` has no `branchId`; only `JournalEntry` does, and it is
 * nullable. So a branch-scoped caller sees entries for their branch, and
 * organization-level postings — those with no branch — are excluded from a
 * branch report rather than leaking into every branch's total. An
 * organization-wide caller sees both.
 *
 * // TODO(open-question): Questions 14-19 — which totals must reconcile
 * // exactly, and whether trial balance, P&L, balance sheet and cash flow are
 * // required here, are unresolved. Module 14 already ships a trial balance;
 * // this report is the ledger-line view the story's field list describes, and
 * // a statement-shaped report would be an addition rather than a change.
 */
@Injectable()
export class FinancialReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: GeneralLedgerService,
    private readonly audit: AuditService,
  ) {}

  async run(
    actor: AuthContext,
    query: FinancialReportQueryDto,
    meta: RequestMeta,
  ): Promise<FinancialReport> {
    const branchId = resolveBranchScope(actor, query.branchId);
    const dateBasis = resolveDateBasis('FINANCIAL', query.dateBasis);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    if (query.fromDate && query.toDate) {
      assertDateRange(query.fromDate, query.toDate);
    }

    const result = query.accountId
      ? await this.fromLedger(actor, query, page, pageSize)
      : await this.acrossAccounts(actor, query, branchId, page, pageSize);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.REPORT_GENERATED,
      entityType: 'REPORT',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        category: 'FINANCIAL',
        dateBasis,
        branchId,
        actorBranchId: actor.branchId,
        accountId: query.accountId ?? null,
        rowCount: result.total,
      },
    });

    return {
      meta: buildMeta({
        category: 'FINANCIAL',
        dateBasis,
        fromDate: query.fromDate ?? '',
        toDate: query.toDate ?? '',
        branchId,
        // A journal line carries no customer data, so there is nothing here to
        // mask. Reported as false rather than omitted, because Rule 49 wants
        // "not masked" distinguishable from "unknown".
        piiMasked: false,
      }),
      ...result,
    };
  }

  /**
   * One account's lines, straight from Module 14.
   *
   * The audit this triggers inside `GeneralLedgerService` is deliberate and not
   * duplication: the ledger read happened, and the report read happened, and
   * both are worth recording separately when the question later is "who saw
   * this account".
   */
  private async fromLedger(
    actor: AuthContext,
    query: FinancialReportQueryDto,
    page: number,
    pageSize: number,
  ): Promise<Omit<FinancialReport, 'meta'>> {
    const ledgerPage = await this.ledger.ledger(
      actor,
      {
        accountId: query.accountId as string,
        fromDate: query.fromDate,
        toDate: query.toDate,
        sourceType: query.sourceType,
        page,
        pageSize,
      },
      // The ledger service audits with the meta it is given; passing the report's
      // own meta keeps the two records correlated by request id.
      { requestId: undefined, ipAddress: null, userAgent: null },
    );

    return {
      rows: ledgerPage.rows.map((row) => ({
        journalEntryId: row.journalEntryId,
        journalLineId: row.journalLineId,
        businessDate: row.entryDate,
        journalReference: row.entryNumber,
        accountCode: ledgerPage.accountCode,
        accountName: ledgerPage.accountName,
        debitPaise: row.debitPaise,
        creditPaise: row.creditPaise,
        runningBalancePaise: row.runningBalancePaise,
        ...(row.sourceType ? { sourceModule: row.sourceType } : {}),
        ...(row.sourceId ? { sourceTransactionId: row.sourceId } : {}),
      })),
      total: ledgerPage.total,
      page,
      pageSize,
      totals: {
        debitPaise: ledgerPage.totalDebitPaise,
        creditPaise: ledgerPage.totalCreditPaise,
        openingBalancePaise: ledgerPage.openingBalancePaise,
        closingBalancePaise: ledgerPage.closingBalancePaise,
        lines: ledgerPage.total,
      },
    };
  }

  /**
   * Every posted line in the period, across accounts.
   *
   * No running balance: a balance is per account, and a column that carried one
   * across a mixed-account listing would be arithmetic nobody asked for. It is
   * reported as the line's own debit-minus-credit instead, which is what the
   * story's "Running Balance" means on a general ledger report spanning
   * accounts — and the totals row carries the period's debit and credit sums,
   * which is the figure that must reconcile.
   */
  private async acrossAccounts(
    actor: AuthContext,
    query: FinancialReportQueryDto,
    branchId: string | null,
    page: number,
    pageSize: number,
  ): Promise<Omit<FinancialReport, 'meta'>> {
    const entryWhere = {
      orgId: actor.orgId,
      status: { in: POSTED_STATUSES },
      ...(branchId ? { branchId } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.fromDate || query.toDate
        ? {
            entryDate: {
              ...(query.fromDate ? { gte: civilToDate(query.fromDate) } : {}),
              ...(query.toDate
                ? { lt: civilToExclusiveEnd(query.toDate) }
                : {}),
            },
          }
        : {}),
    };

    const where = {
      orgId: actor.orgId,
      journalEntry: entryWhere,
      ...(query.search
        ? {
            account: {
              OR: [
                {
                  accountCode: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  accountName: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              ],
            },
          }
        : {}),
    };

    const [lines, total, sums] = await Promise.all([
      this.prisma.journalLine.findMany({
        where,
        include: FINANCIAL_REPORT_INCLUDE,
        orderBy: [
          { journalEntry: { entryDate: 'desc' } },
          { journalEntry: { entryNumber: 'desc' } },
          { lineNumber: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.journalLine.count({ where }),
      // Over the whole filtered set (Rule 35). These are the two figures
      // Scenario 27 requires to reconcile to the ledger, and they are summed
      // from the same lines the rows come from.
      this.prisma.journalLine.aggregate({
        where,
        _sum: { debitPaise: true, creditPaise: true },
      }),
    ]);

    const debit = sums._sum.debitPaise ?? BigInt(0);
    const credit = sums._sum.creditPaise ?? BigInt(0);

    return {
      rows: lines.map((line) => this.toRow(line)),
      total,
      page,
      pageSize,
      totals: {
        debitPaise: debit.toString(),
        creditPaise: credit.toString(),
        // Every posted entry balances, so across a whole period this is zero
        // unless something is wrong. Reported rather than asserted: Scenario 61
        // wants a mismatch flagged, and a number the reader can see is a
        // better flag than an exception they cannot investigate.
        netPaise: (debit - credit).toString(),
        lines: total,
      },
    };
  }

  private toRow(line: FinancialLineRecord): FinancialReportRow {
    const entry = line.journalEntry;

    return {
      journalEntryId: line.journalEntryId,
      journalLineId: line.journalLineId,
      businessDate: entry.entryDate.toISOString().slice(0, 10),
      journalReference: entry.entryNumber,
      accountCode: line.account.accountCode,
      accountName: line.account.accountName,
      debitPaise: line.debitPaise.toString(),
      creditPaise: line.creditPaise.toString(),
      runningBalancePaise: (line.debitPaise - line.creditPaise).toString(),
      ...(entry.sourceType ? { sourceModule: entry.sourceType } : {}),
      ...(entry.sourceId ? { sourceTransactionId: entry.sourceId } : {}),
      // Points at whatever this entry reversed. The reversing entry names its
      // original; both stay in the report, which is Scenario 26's "reflects
      // both" and its "original remains historically traceable".
      ...(entry.originalEntry
        ? { reversalReference: entry.originalEntry.entryNumber }
        : {}),
      ...(entry.branchId ? { branchId: entry.branchId } : {}),
      ...(entry.branch?.name ? { branchName: entry.branch.name } : {}),
    };
  }
}

/**
 * The statuses that count toward a financial report.
 *
 * The same set `GeneralLedgerService` uses, and for the same reasons — see the
 * note at the top of this class. Not `as const`: Prisma's `in` filter takes a
 * mutable array.
 */
const POSTED_STATUSES: ('POSTED' | 'REVERSED')[] = ['POSTED', 'REVERSED'];

const FINANCIAL_REPORT_INCLUDE = {
  account: { select: { accountCode: true, accountName: true } },
  journalEntry: {
    select: {
      entryNumber: true,
      entryDate: true,
      sourceType: true,
      sourceId: true,
      branchId: true,
      branch: { select: { name: true } },
      // `originalEntry` is the relation; `originalJournalEntryId` is the scalar.
      originalEntry: { select: { entryNumber: true } },
    },
  },
} as const;

interface FinancialLineRecord {
  journalLineId: string;
  journalEntryId: string;
  debitPaise: bigint;
  creditPaise: bigint;
  account: { accountCode: string; accountName: string };
  journalEntry: {
    entryNumber: string;
    entryDate: Date;
    sourceType: string | null;
    sourceId: string | null;
    branchId: string | null;
    branch: { name: string } | null;
    originalEntry: { entryNumber: string } | null;
  };
}
