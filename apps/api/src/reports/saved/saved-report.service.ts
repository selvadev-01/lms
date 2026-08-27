import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  SavedReportDetail,
  SavedReportListResult,
  SavedReportSummary,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ListSavedReportsDto,
  SaveReportDto,
  UpdateSavedReportDto,
  VersionedDto,
} from '../dto/saved-report.dto';
import { PERMITTED_DATE_BASES } from '../report-date-basis';
import { resolveBranchScope } from '../report-scope';

export const REPORTS_SAVED_VIEW_PERMISSION = 'reports.saved.view';
export const REPORTS_SAVED_MANAGE_PERMISSION = 'reports.saved.manage';

/** One opaque message: out of scope and absent are indistinguishable to a caller. */
const NOT_REACHABLE = 'Saved report not found';

/**
 * Saved report definitions (Scenarios 38-44, 52, 59).
 *
 * # The only writes in Module 15
 *
 * A saved report is a stored *filter set*, not a stored result. Creating one
 * writes nothing about loans, collections or the ledger — which is why this is
 * the one place in the module with a write path, and why Rule 6 is not in
 * tension with it.
 *
 * # Saved scope narrows, it never widens
 *
 * Scenario 38 requires that a saved definition does not store unauthorized
 * expanded scope, and Scenario 43 requires current source authorization to
 * apply when it runs. Both are handled the same way: `resolveBranchScope`
 * validates the branch at save time *and* the caller re-resolves it at run
 * time. A definition saved by an organization-wide user and run by a
 * branch-confined one yields that branch's rows, never everything.
 *
 * This is why the branch lives in its own column rather than inside `filters`:
 * a column can be compared and constrained, a JSON blob has to be trusted.
 *
 * # Visibility is a query, not a display rule
 *
 * Scenario 39 returns only the reports visible to the caller. That is a WHERE
 * clause — owner or shared — rather than a filter applied after fetching, for
 * the same reason every scope rule in this codebase is: filtering in
 * JavaScript means the rows were already read, and the next refactor forgets.
 *
 * # Deactivate is the normal end of life
 *
 * Scenario 41 blocks new output from an inactive definition while preserving
 * history; Scenario 42 blocks deletion outright when anything references it.
 * Deletion is therefore only ever possible for a definition that has never been
 * run, and `ReportRun` rows are what make that determinable.
 */
@Injectable()
export class SavedReportService {
  private readonly logger = new Logger(SavedReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthContext,
    query: ListSavedReportsDto,
    meta: RequestMeta,
  ): Promise<SavedReportListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const where = {
      orgId: actor.orgId,
      // Visible means: mine, or shared with the organization. Enforced in SQL.
      OR: [{ ownerUserId: actor.userId }, { visibility: 'SHARED' as const }],
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.reportDefinition.findMany({
        where,
        include: SAVED_REPORT_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.reportDefinition.count({ where }),
    ]);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.SAVED_REPORT_LISTED,
      entityType: 'SAVED_REPORT',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { count: total },
    });

    return {
      items: rows.map((row) => toSummary(row)),
      total,
      page,
      pageSize,
    };
  }

  async detail(
    actor: AuthContext,
    reportDefinitionId: string,
  ): Promise<SavedReportDetail> {
    const row = await this.findInScope(actor, reportDefinitionId);
    return toDetail(row);
  }

  async create(
    actor: AuthContext,
    dto: SaveReportDto,
    meta: RequestMeta,
  ): Promise<SavedReportDetail> {
    // Validated at save time as well as at run time. Saving a scope the caller
    // could not read would store a definition that can never legitimately run.
    const branchId = resolveBranchScope(actor, dto.branchId);
    this.assertDateBasis(dto.category, dto.dateBasis);

    const created = await this.prisma.reportDefinition
      .create({
        data: {
          orgId: actor.orgId,
          code: await this.nextCode(actor.orgId),
          name: dto.name,
          reportType: `CATEGORY_${dto.category}` as never,
          status: 'ACTIVE',
          ownerUserId: actor.userId,
          visibility: dto.visibility,
          branchId,
          filters: (dto.search ? { search: dto.search } : {}) as never,
          dateBasis: dto.dateBasis,
          fromDate: dto.fromDate ? new Date(dto.fromDate) : null,
          toDate: dto.toDate ? new Date(dto.toDate) : null,
        },
        include: SAVED_REPORT_INCLUDE,
      })
      .catch((error: unknown) => this.translateWriteError(error));

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.SAVED_REPORT_CREATED,
      entityType: 'SAVED_REPORT',
      entityId: created.reportDefinitionId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      newData: {
        name: created.name,
        category: dto.category,
        visibility: dto.visibility,
        branchId,
      },
    });

    return toDetail(created);
  }

  async update(
    actor: AuthContext,
    reportDefinitionId: string,
    dto: UpdateSavedReportDto,
    meta: RequestMeta,
  ): Promise<SavedReportDetail> {
    const existing = await this.findInScope(actor, reportDefinitionId);
    this.assertCanManage(actor, existing);
    const branchId = resolveBranchScope(actor, dto.branchId);
    this.assertDateBasis(dto.category, dto.dateBasis);

    // Optimistic concurrency in the WHERE clause rather than a read-then-write
    // check: a compare done in application code cannot stop a concurrent edit
    // that lands between the read and the write (Scenario 59).
    const result = await this.prisma.reportDefinition.updateMany({
      where: {
        orgId: actor.orgId,
        reportDefinitionId,
        version: dto.expectedVersion,
      },
      data: {
        name: dto.name,
        reportType: `CATEGORY_${dto.category}` as never,
        visibility: dto.visibility,
        branchId,
        filters: (dto.search ? { search: dto.search } : {}) as never,
        dateBasis: dto.dateBasis,
        fromDate: dto.fromDate ? new Date(dto.fromDate) : null,
        toDate: dto.toDate ? new Date(dto.toDate) : null,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.SAVED_REPORT_CONCURRENT_ATTEMPT_REJECTED,
        entityType: 'SAVED_REPORT',
        entityId: reportDefinitionId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          expectedVersion: dto.expectedVersion,
          actualVersion: existing.version,
        },
      });
      throw new ConflictException(
        'This form is out of date. Reload and try again.',
      );
    }

    const updated = await this.findInScope(actor, reportDefinitionId);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.SAVED_REPORT_UPDATED,
      entityType: 'SAVED_REPORT',
      entityId: reportDefinitionId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      oldData: { name: existing.name, visibility: existing.visibility },
      newData: { name: updated.name, visibility: updated.visibility },
    });

    return toDetail(updated);
  }

  /**
   * Deactivate.
   *
   * Scenario 41: an inactive definition cannot produce new output, and its
   * history stays. Nothing is deleted, so there is nothing to preserve
   * separately — the row itself is the history.
   */
  async deactivate(
    actor: AuthContext,
    reportDefinitionId: string,
    dto: VersionedDto,
    meta: RequestMeta,
  ): Promise<SavedReportDetail> {
    const existing = await this.findInScope(actor, reportDefinitionId);
    this.assertCanManage(actor, existing);

    const result = await this.prisma.reportDefinition.updateMany({
      where: {
        orgId: actor.orgId,
        reportDefinitionId,
        version: dto.expectedVersion,
      },
      data: { status: 'INACTIVE', version: { increment: 1 } },
    });

    if (result.count === 0) {
      throw new ConflictException(
        'This form is out of date. Reload and try again.',
      );
    }

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.SAVED_REPORT_DEACTIVATED,
      entityType: 'SAVED_REPORT',
      entityId: reportDefinitionId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.detail(actor, reportDefinitionId);
  }

  /**
   * Delete, when nothing downstream references it.
   *
   * Scenario 42: deletion is blocked where a run, delivery or other dependency
   * exists, and deactivation is required instead. The blocker list is returned
   * rather than a bare refusal, in the shape Modules 11 and 13 already use — a
   * caller who is told only "no" has to guess what to fix.
   */
  async remove(
    actor: AuthContext,
    reportDefinitionId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const existing = await this.findInScope(actor, reportDefinitionId);
    this.assertCanManage(actor, existing);

    const runs = await this.prisma.reportRun.count({
      where: { orgId: actor.orgId, reportDefinitionId },
    });

    if (runs > 0) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.SAVED_REPORT_DELETE_BLOCKED,
        entityType: 'SAVED_REPORT',
        entityId: reportDefinitionId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { runs },
      });

      throw new ConflictException({
        message:
          'This report has been run before and cannot be deleted. Deactivate it instead.',
        blockedBy: [
          {
            key: 'REPORT_RUNS',
            reason: `${runs} execution record${runs === 1 ? '' : 's'} reference this definition.`,
          },
        ],
      });
    }

    await this.prisma.reportDefinition.deleteMany({
      where: { orgId: actor.orgId, reportDefinitionId },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.SAVED_REPORT_DELETED,
      entityType: 'SAVED_REPORT',
      entityId: reportDefinitionId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      oldData: { name: existing.name },
    });
  }

  /**
   * Reachability, in the shape every service in this codebase uses.
   *
   * One opaque message for both "not yours" and "does not exist": telling the
   * two apart would let a caller enumerate other people's private definitions
   * by id.
   */
  private async findInScope(
    actor: AuthContext,
    reportDefinitionId: string,
  ): Promise<SavedReportRow> {
    const row = await this.prisma.reportDefinition.findFirst({
      where: {
        orgId: actor.orgId,
        reportDefinitionId,
        OR: [{ ownerUserId: actor.userId }, { visibility: 'SHARED' }],
      },
      include: SAVED_REPORT_INCLUDE,
    });

    if (!row) {
      this.logger.warn(
        `Saved report ${reportDefinitionId} not reachable for user ${actor.userId}`,
      );
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  /**
   * Who may change a shared definition.
   *
   * Scenario 52: a user without saved-report administration cannot edit,
   * deactivate or delete another user's shared report. Holding
   * `reports.saved.manage` lets you manage your own; changing someone else's
   * needs you to be the owner.
   *
   * // TODO(open-question): Question 41 — whether shared reports may be edited
   * // by users other than the owner is unresolved. Owner-only is the
   * // conservative reading: widening it later cannot break anything, while
   * // narrowing it would take away an ability people had come to rely on.
   */
  private assertCanManage(actor: AuthContext, row: SavedReportRow): void {
    if (row.ownerUserId && row.ownerUserId !== actor.userId) {
      throw new NotFoundException(NOT_REACHABLE);
    }
  }

  /** The same per-category whitelist the live reports enforce (Rule 11). */
  private assertDateBasis(category: string, dateBasis: string): void {
    const permitted =
      PERMITTED_DATE_BASES[category as keyof typeof PERMITTED_DATE_BASES];

    if (!permitted || !permitted.includes(dateBasis as never)) {
      throw new BadRequestException(
        'This report cannot be filtered by that date basis',
      );
    }
  }

  /**
   * The next `SR-000001`.
   *
   * Numeric max rather than a lexical sort, the same allocation every numbered
   * entity in this system uses: `SR-000010` sorts before `SR-000009` as text.
   */
  private async nextCode(orgId: string): Promise<string> {
    const rows = await this.prisma.reportDefinition.findMany({
      where: { orgId, code: { startsWith: 'SR-' } },
      select: { code: true },
    });

    const highest = rows.reduce((max, row) => {
      const digits = Number.parseInt(row.code.slice(3), 10);
      return Number.isFinite(digits) && digits > max ? digits : max;
    }, 0);

    return `SR-${String(highest + 1).padStart(6, '0')}`;
  }

  /** Prisma write errors, translated so a unique violation is not a 503. */
  private translateWriteError(error: unknown): never {
    const code = (error as { code?: string })?.code;

    if (code === 'P2002') {
      throw new ConflictException(
        'A saved report with that identifier already exists. Try again.',
      );
    }

    throw error as Error;
  }
}

const SAVED_REPORT_INCLUDE = {
  owner: { select: { name: true } },
  branch: { select: { name: true } },
} as const;

interface SavedReportRow {
  reportDefinitionId: string;
  code: string;
  name: string;
  reportType: string;
  status: string;
  ownerUserId: string | null;
  visibility: string;
  branchId: string | null;
  filters: unknown;
  dateBasis: string | null;
  fromDate: Date | null;
  toDate: Date | null;
  lastRunAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  owner: { name: string } | null;
  branch: { name: string } | null;
}

/** `CATEGORY_PORTFOLIO` back to `PORTFOLIO`. */
function toCategory(reportType: string): SavedReportSummary['category'] {
  return reportType.replace(/^CATEGORY_/, '') as SavedReportSummary['category'];
}

function toSummary(row: SavedReportRow): SavedReportSummary {
  return {
    reportDefinitionId: row.reportDefinitionId,
    code: row.code,
    name: row.name,
    category: toCategory(row.reportType),
    visibility: row.visibility as SavedReportSummary['visibility'],
    status: row.status as SavedReportSummary['status'],
    ownerUserId: row.ownerUserId ?? '',
    ...(row.owner?.name ? { ownerName: row.owner.name } : {}),
    ...(row.branchId ? { branchId: row.branchId } : {}),
    ...(row.branch?.name ? { branchName: row.branch.name } : {}),
    ...(row.lastRunAt ? { lastRunAt: row.lastRunAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toDetail(row: SavedReportRow): SavedReportDetail {
  return {
    ...toSummary(row),
    ...(row.dateBasis
      ? { dateBasis: row.dateBasis as SavedReportDetail['dateBasis'] }
      : {}),
    ...(row.fromDate
      ? { fromDate: row.fromDate.toISOString().slice(0, 10) }
      : {}),
    ...(row.toDate ? { toDate: row.toDate.toISOString().slice(0, 10) } : {}),
    filters: (row.filters ?? {}) as SavedReportDetail['filters'],
  };
}
