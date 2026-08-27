import { Injectable } from '@nestjs/common';
import type { ApplicationReport, ApplicationReportRow } from '@lms/types';

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

export const REPORTS_APPLICATIONS_VIEW_PERMISSION = 'reports.applications.view';

/**
 * The Application report (Scenarios 5, 6).
 *
 * # Why the basis is fixed to the application date
 *
 * Filtering applications by disbursal date would silently exclude every
 * application that was never disbursed — rejected, withdrawn, still in review —
 * which is most of what an application report exists to show. The registry in
 * `report-date-basis.ts` permits only `APPLICATION_DATE` here for that reason
 * (Rule 11, Scenario 12).
 *
 * An application that has not been submitted has no `submittedAt`, so a range
 * filter excludes drafts. That is the right behaviour for a report about
 * application volume: a draft is not an application anyone made.
 *
 * # Rejected stays distinguishable
 *
 * Scenario 6 requires rejected applications to remain distinct from approved
 * and disbursed ones. `status` is the canonical `ApplicationStatus` verbatim,
 * never collapsed into a coarser reporting bucket, and `rejectionReason` rides
 * alongside it.
 *
 * # Approved amount comes from the sanction letter
 *
 * The application row carries what was *requested*. What was approved is the
 * sanctioned amount, snapshotted on `SanctionLetter` at issue — so the two
 * columns cannot silently become the same number when terms were modified
 * during approval.
 */
@Injectable()
export class ApplicationReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(
    actor: AuthContext,
    query: ReportQueryDto,
    meta: RequestMeta,
  ): Promise<ApplicationReport> {
    const branchId = resolveBranchScope(actor, query.branchId);
    const dateBasis = resolveDateBasis('APPLICATIONS', query.dateBasis);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const piiAllowed = canSeePii(actor);

    if (query.fromDate && query.toDate) {
      assertDateRange(query.fromDate, query.toDate);
    }

    const where = {
      ...orgBranchWhere(actor, query.branchId),
      ...(query.fromDate || query.toDate
        ? {
            submittedAt: {
              ...(query.fromDate ? { gte: civilToDate(query.fromDate) } : {}),
              ...(query.toDate
                ? { lt: civilToExclusiveEnd(query.toDate) }
                : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              {
                applicationNumber: {
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
          }
        : {}),
    };

    const [rows, total, requested] = await Promise.all([
      this.prisma.loanApplication.findMany({
        where,
        include: APPLICATION_REPORT_INCLUDE,
        orderBy: { applicationNumber: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.loanApplication.count({ where }),
      // Over the whole filtered set (Rule 35), not the page.
      this.prisma.loanApplication.aggregate({
        where,
        _sum: { requestedAmountPaise: true },
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
        category: 'APPLICATIONS',
        dateBasis,
        branchId,
        actorBranchId: actor.branchId,
        rowCount: total,
        piiMasked: !piiAllowed,
      },
    });

    return {
      meta: buildMeta({
        category: 'APPLICATIONS',
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
        requestedAmountPaise: (
          requested._sum.requestedAmountPaise ?? BigInt(0)
        ).toString(),
        applications: total,
      },
    };
  }

  private toRow(
    row: ApplicationReportRecord,
    piiAllowed: boolean,
  ): ApplicationReportRow {
    return {
      applicationId: row.applicationId,
      applicationNumber: row.applicationNumber,
      customerId: row.customerId,
      customerName: maskName(row.customer.fullName, piiAllowed),
      branchId: row.branchId,
      branchName: row.branch?.name ?? '',
      loanProductName: row.loanProduct?.name ?? '',
      ...(row.submittedAt
        ? { applicationDate: row.submittedAt.toISOString().slice(0, 10) }
        : {}),
      requestedAmountPaise: row.requestedAmountPaise.toString(),
      ...(row.sanctionLetter
        ? {
            approvedAmountPaise:
              row.sanctionLetter.sanctionedAmountPaise.toString(),
          }
        : {}),
      status: row.status,
      // The stage a live application is sitting at.
      //
      // Module 08 stores no separate stage column: the application's own status
      // *is* its position in the workflow, and the assessment is the one thing
      // that can be pending underneath a non-terminal status. So the stage is
      // reported as "awaiting assessment" only when there is genuinely no
      // current assessment and the application has not yet reached a terminal
      // state. Inventing a richer stage vocabulary here would be report-only
      // logic contradicting the authoritative state (Rule 14).
      ...(this.currentStage(row)
        ? { currentApprovalStage: this.currentStage(row) }
        : {}),
      ...(row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
    };
  }

  /** See the note at the call site. Undefined when the application is terminal. */
  private currentStage(row: ApplicationReportRecord): string | undefined {
    if (TERMINAL_APPLICATION_STATUSES.has(row.status)) return undefined;

    const hasCurrentAssessment = row.creditAssessments.length > 0;
    return hasCurrentAssessment ? row.status : 'AWAITING_ASSESSMENT';
  }
}

/**
 * Statuses past which there is no stage left to be at.
 *
 * Read from the canonical `ApplicationStatus` rather than inferred from dates:
 * an application can carry `approvedAt` and still have been rejected later, and
 * a date-based reading would report the wrong stage for exactly those rows.
 */
const TERMINAL_APPLICATION_STATUSES = new Set([
  'REJECTED',
  'DISBURSED',
  'CLOSED',
  'CANCELLED',
  'WITHDRAWN',
]);

const APPLICATION_REPORT_INCLUDE = {
  customer: { select: { fullName: true } },
  branch: { select: { name: true } },
  loanProduct: { select: { name: true } },
  sanctionLetter: { select: { sanctionedAmountPaise: true } },
  // Only the current assessment; a superseded one is history, not a stage.
  creditAssessments: {
    where: { supersededAt: null },
    select: { assessmentId: true },
    take: 1,
  },
} as const;

interface ApplicationReportRecord {
  applicationId: string;
  applicationNumber: string;
  customerId: string;
  branchId: string;
  requestedAmountPaise: bigint;
  status: string;
  rejectionReason: string | null;
  submittedAt: Date | null;
  customer: { fullName: string };
  branch: { name: string } | null;
  loanProduct: { name: string } | null;
  sanctionLetter: { sanctionedAmountPaise: bigint } | null;
  creditAssessments: { assessmentId: string }[];
}
