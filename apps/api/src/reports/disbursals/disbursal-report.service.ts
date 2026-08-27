import { Injectable } from '@nestjs/common';
import type { DisbursalReport, DisbursalReportRow } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReportQueryDto } from '../dto/reports.dto';
import { resolveDateBasis } from '../report-date-basis';
import {
  assertDateRange,
  buildMeta,
  canSeePii,
  civilToDate,
  civilToExclusiveEnd,
  maskName,
  orgBranchWhere,
  resolveBranchScope,
} from '../report-scope';

export const REPORTS_DISBURSALS_VIEW_PERMISSION = 'reports.disbursals.view';

/**
 * The Disbursal report.
 *
 * # Two dates, and the report uses the one that means "money moved"
 *
 * `Disbursement` carries `scheduledDate` (when it was planned) and
 * `transferDate` (when the transfer actually happened). The declared basis is
 * disbursal date, and the transfer date is what that means — a report filtered
 * on the scheduled date would count a disbursal in the month it was planned,
 * which for anything that slipped is not the month the money left. Rows with no
 * transfer date yet fall back to the scheduled date so a pending disbursal is
 * still visible, and the status column says which it is.
 *
 * # Sanctioned versus disbursed
 *
 * Both are shown. They differ whenever a loan is disbursed in tranches or a
 * transfer partially failed, and collapsing them into one column would hide
 * exactly the gap a disbursal report is run to find.
 */
@Injectable()
export class DisbursalReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(
    actor: AuthContext,
    query: ReportQueryDto,
    meta: RequestMeta,
  ): Promise<DisbursalReport> {
    const branchId = resolveBranchScope(actor, query.branchId);
    const dateBasis = resolveDateBasis('DISBURSALS', query.dateBasis);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const piiAllowed = canSeePii(actor);

    if (query.fromDate && query.toDate) {
      assertDateRange(query.fromDate, query.toDate);
    }

    const range = {
      ...(query.fromDate ? { gte: civilToDate(query.fromDate) } : {}),
      ...(query.toDate ? { lt: civilToExclusiveEnd(query.toDate) } : {}),
    };

    const where = {
      ...orgBranchWhere(actor, query.branchId),
      ...(query.fromDate || query.toDate
        ? {
            // Transfer date when there is one, scheduled date otherwise — see
            // the note at the top. Expressed as an OR rather than a computed
            // column so the index on each is still usable.
            OR: [
              { transferDate: range },
              { transferDate: null, scheduledDate: range },
            ],
          }
        : {}),
      ...(query.search
        ? {
            loan: {
              OR: [
                {
                  loanNumber: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  customer: {
                    fullName: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              ],
            },
          }
        : {}),
    };

    const [rows, total, sums] = await Promise.all([
      this.prisma.disbursement.findMany({
        where,
        include: DISBURSAL_REPORT_INCLUDE,
        orderBy: [{ transferDate: 'desc' }, { scheduledDate: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.disbursement.count({ where }),
      // Only what actually completed counts toward money disbursed. A scheduled
      // or failed row still appears — the reader needs to see it — but adding
      // it to the total would report money that never left.
      this.prisma.disbursement.aggregate({
        where: { ...where, status: 'COMPLETED' },
        _sum: { amountPaise: true },
      }),
    ]);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.REPORT_GENERATED,
      entityType: 'REPORT',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        category: 'DISBURSALS',
        dateBasis,
        branchId,
        actorBranchId: actor.branchId,
        rowCount: total,
        piiMasked: !piiAllowed,
      },
    });

    return {
      meta: buildMeta({
        category: 'DISBURSALS',
        dateBasis,
        fromDate: query.fromDate ?? '',
        toDate: query.toDate ?? '',
        branchId,
        piiMasked: !piiAllowed,
      }),
      rows: rows.map((row) => this.toRow(row, piiAllowed)),
      total,
      page,
      pageSize,
      totals: {
        disbursedAmountPaise: (sums._sum.amountPaise ?? BigInt(0)).toString(),
        disbursals: total,
      },
    };
  }

  private toRow(
    row: DisbursalReportRecord,
    piiAllowed: boolean,
  ): DisbursalReportRow {
    const effectiveDate = row.transferDate ?? row.scheduledDate;

    return {
      disbursementId: row.disbursementId,
      loanId: row.loanId,
      loanNumber: row.loan.loanNumber,
      customerName: maskName(row.loan.customer.fullName, piiAllowed),
      branchId: row.branchId,
      branchName: row.branch?.name ?? '',
      loanProductName: row.loan.loanProduct?.name ?? '',
      ...(effectiveDate
        ? { disbursalDate: effectiveDate.toISOString().slice(0, 10) }
        : {}),
      sanctionedAmountPaise: row.loan.principalAmountPaise.toString(),
      disbursedAmountPaise: row.amountPaise.toString(),
      status: row.status,
      paymentMode: row.paymentMode,
      ...(row.transactionReference
        ? { referenceNumber: row.transactionReference }
        : {}),
    };
  }
}

const DISBURSAL_REPORT_INCLUDE = {
  branch: { select: { name: true } },
  loan: {
    select: {
      loanNumber: true,
      principalAmountPaise: true,
      customer: { select: { fullName: true } },
      loanProduct: { select: { name: true } },
    },
  },
} as const;

interface DisbursalReportRecord {
  disbursementId: string;
  loanId: string;
  branchId: string;
  scheduledDate: Date;
  transferDate: Date | null;
  amountPaise: bigint;
  paymentMode: string;
  transactionReference: string | null;
  status: string;
  branch: { name: string } | null;
  loan: {
    loanNumber: string;
    principalAmountPaise: bigint;
    customer: { fullName: string };
    loanProduct: { name: string } | null;
  };
}
