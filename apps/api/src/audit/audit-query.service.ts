import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { csvDocument, csvField } from '../common/export/csv';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertDateRange,
  civilToDate,
  civilToExclusiveEnd,
} from '../reports/report-scope';
import { AuditAction, AuditService } from './audit.service';

export const AUDIT_VIEW_PERMISSION = 'audit.view';
export const AUDIT_EXPORT_PERMISSION = 'audit.export';
export const AUDIT_SENSITIVE_VIEW_PERMISSION = 'audit.sensitive.view';

const NOT_REACHABLE = 'Audit event not found';

/** Replaces before/after values for a reader without `audit.sensitive.view`. */
const REDACTED = '[redacted]';

/** Rows above this in one export are refused, never truncated (Rule 56). */
const MAX_EXPORT_ROWS = 10_000;

/** The widest range one export may cover, in days. */
const MAX_EXPORT_DAYS = 366;

const DEFAULT_PAGE_SIZE = 50;

export interface AuditEventSummary {
  auditId: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  branchId: string | null;
  actorUserId: string | null;
  actorName: string | null;
}

export interface AuditEventDetail extends AuditEventSummary {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  oldData: unknown;
  newData: unknown;
  metadata: unknown;
  /** True when this reader is seeing redactions rather than the stored values. */
  isRedacted: boolean;
}

export interface AuditEventListResult {
  items: AuditEventSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditListFilters {
  actorUserId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  branchId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Reading the audit trail (Scenarios 36-43).
 *
 * Deliberately separate from `AuditService`, which stays the sole WRITER. One
 * class holding both would make it easy for a future change to reach for
 * `prisma.auditLog.update` from a read path; here there is no write method to
 * misuse, and the database refuses the statement regardless — `audit_logs`
 * carries an append-only trigger.
 *
 * # Branch confinement has a NULL fallback, and that is not a bug
 *
 * `audit_logs.branch_id` was added by Module 17. Every row written before it,
 * and every row from a call site that does not yet pass a branch, carries NULL.
 * A branch-confined reader therefore matches:
 *
 *     branch_id = theirs  OR  (branch_id IS NULL AND the actor is in their branch)
 *
 * Collapsing that to `branchId: actor.branchId` would silently hide every legacy
 * event — and an empty list looks like a working filter rather than a fault,
 * which is why this is spelled out here and pinned by a test.
 *
 * # Sensitive values are masked twice over
 *
 * `AuditService.sanitizeMetadata` already drops credential-shaped keys at WRITE
 * time, so no plaintext password or token was ever stored (Rule 50). The
 * redaction here is the second layer: it narrows what an ordinary reader sees of
 * what *was* stored (Rule 49, Scenario 39). Neither layer can be removed by the
 * other's presence — the first bounds the blast radius, the second bounds the
 * audience.
 */
@Injectable()
export class AuditQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthContext,
    filters: AuditListFilters,
  ): Promise<AuditEventListResult> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(
      200,
      Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE),
    );

    const where = await this.buildWhere(actor, filters);

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actorUser: { select: { name: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toSummary(row)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * One event, with its change detail (Scenario 37).
   *
   * There is no corresponding update or delete method, and there never should
   * be: viewing an audit event must not permit modifying it (Rule 54).
   */
  async get(actor: AuthContext, auditId: string): Promise<AuditEventDetail> {
    const row = await this.prisma.auditLog.findFirst({
      where: { orgId: actor.orgId, auditId },
      include: { actorUser: { select: { name: true, branchId: true } } },
    });
    if (!row) throw new NotFoundException(NOT_REACHABLE);

    // Same confinement as the list, applied to the direct fetch so an id guessed
    // from elsewhere does not bypass it (Scenario 46).
    if (actor.branchId) {
      const eventBranch = row.branchId ?? row.actorUser?.branchId ?? null;
      if (eventBranch !== null && eventBranch !== actor.branchId) {
        throw new NotFoundException(NOT_REACHABLE);
      }
    }

    const redact = !this.has(actor, AUDIT_SENSITIVE_VIEW_PERMISSION);

    return {
      ...this.toSummary(row),
      requestId: row.requestId,
      ipAddress: redact ? null : row.ipAddress,
      userAgent: row.userAgent,
      oldData: redact ? REDACTED : row.oldData,
      newData: redact ? REDACTED : row.newData,
      metadata: row.metadata,
      isRedacted: redact,
    };
  }

  /**
   * Export to CSV (Scenario 41).
   *
   * Two properties are load-bearing:
   *
   *  * The audit row is written BEFORE any data is serialised (Rule 57). An
   *    export that fails halfway still leaves the evidence that it was
   *    attempted, which is the point of auditing an export at all.
   *  * The same scope and redaction rules as the UI apply (Rule 56). An export
   *    that widened either would be a way to read past the screen's limits.
   */
  async exportCsv(
    actor: AuthContext,
    filters: AuditListFilters,
    meta: RequestMeta,
  ): Promise<string> {
    if (!filters.from || !filters.to) {
      throw new BadRequestException(
        'From Date and To Date are required for an audit export',
      );
    }
    assertDateRange(filters.from, filters.to);
    this.assertExportSpan(filters.from, filters.to, actor, meta);

    const where = await this.buildWhere(actor, filters);
    const total = await this.prisma.auditLog.count({ where });

    if (total > MAX_EXPORT_ROWS) {
      await this.auditExportDenied(
        actor,
        filters,
        `${total} rows exceeds the ${MAX_EXPORT_ROWS} an export can carry`,
        meta,
      );
      // Refused rather than truncated: a truncated export is indistinguishable
      // from a complete one once it is open in a spreadsheet.
      throw new BadRequestException(
        `This export has ${total} rows, which is more than the ${MAX_EXPORT_ROWS} an export can carry. Narrow the date range or add a filter.`,
      );
    }

    // Before a byte is written.
    await this.audit.record({
      orgId: actor.orgId,
      branchId: actor.branchId,
      actorUserId: actor.userId,
      action: AuditAction.AUDIT_EXPORTED,
      entityType: 'audit_log',
      metadata: {
        from: filters.from,
        to: filters.to,
        rowCount: total,
        filters: {
          action: filters.action ?? null,
          entityType: filters.entityType ?? null,
          actorUserId: filters.actorUserId ?? null,
          branchId: filters.branchId ?? null,
        },
      },
      ...meta,
    });

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: MAX_EXPORT_ROWS,
      include: { actorUser: { select: { name: true } } },
    });

    const redact = !this.has(actor, AUDIT_SENSITIVE_VIEW_PERMISSION);

    const header = [
      'Occurred At',
      'Action',
      'Entity Type',
      'Entity Id',
      'Actor',
      'Branch Id',
      'Before',
      'After',
    ]
      .map(csvField)
      .join(',');

    const lines = rows.map((row) =>
      [
        row.occurredAt.toISOString(),
        row.action,
        row.entityType,
        row.entityId ?? '',
        row.actorUser?.name ?? '',
        row.branchId ?? '',
        redact ? REDACTED : this.stringify(row.oldData),
        redact ? REDACTED : this.stringify(row.newData),
      ]
        .map(csvField)
        .join(','),
    );

    return csvDocument([header, ...lines]);
  }

  // --- internals ----------------------------------------------------------

  /**
   * The scope and filter clause.
   *
   * `orgId` comes from the JWT and is never accepted from the request — that is
   * the tenant boundary (Scenario 46). Everything else narrows within it.
   */
  private async buildWhere(
    actor: AuthContext,
    filters: AuditListFilters,
  ): Promise<Record<string, unknown>> {
    if (filters.from && filters.to) {
      assertDateRange(filters.from, filters.to);
    }

    const where: Record<string, unknown> = { orgId: actor.orgId };

    if (filters.action)
      where.action = { contains: filters.action, mode: 'insensitive' };
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.actorUserId) where.actorUserId = filters.actorUserId;

    if (filters.from || filters.to) {
      where.occurredAt = {
        ...(filters.from ? { gte: civilToDate(filters.from) } : {}),
        ...(filters.to ? { lt: civilToExclusiveEnd(filters.to) } : {}),
      };
    }

    // See the class header: NULL-branch rows fall back to the actor's branch
    // rather than being hidden.
    if (actor.branchId) {
      if (filters.branchId && filters.branchId !== actor.branchId) {
        // Narrowing to another branch is not a filter, it is a scope escape.
        throw new BadRequestException(
          'You are not authorized to read that branch',
        );
      }
      where.OR = [
        { branchId: actor.branchId },
        { branchId: null, actorUser: { branchId: actor.branchId } },
      ];
    } else if (filters.branchId) {
      where.branchId = filters.branchId;
    }

    return where;
  }

  private assertExportSpan(
    from: string,
    to: string,
    actor: AuthContext,
    meta: RequestMeta,
  ): void {
    const span =
      Math.round(
        (civilToDate(to).getTime() - civilToDate(from).getTime()) / 86_400_000,
      ) + 1;
    if (span > MAX_EXPORT_DAYS) {
      void this.auditExportDenied(
        actor,
        { from, to },
        `range of ${span} days exceeds ${MAX_EXPORT_DAYS}`,
        meta,
      );
      throw new BadRequestException(
        `An audit export cannot cover more than ${MAX_EXPORT_DAYS} days`,
      );
    }
  }

  private async auditExportDenied(
    actor: AuthContext,
    filters: { from?: string; to?: string },
    reason: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.audit
      .record({
        orgId: actor.orgId,
        branchId: actor.branchId,
        actorUserId: actor.userId,
        action: AuditAction.AUDIT_EXPORT_DENIED,
        entityType: 'audit_log',
        metadata: { from: filters.from, to: filters.to, reason },
        ...meta,
      })
      .catch(() => undefined);
  }

  private has(actor: AuthContext, permission: string): boolean {
    return actor.permissions.includes(permission);
  }

  private stringify(value: unknown): string {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  private toSummary(row: {
    auditId: string;
    occurredAt: Date;
    action: string;
    entityType: string;
    entityId: string | null;
    branchId: string | null;
    actorUserId: string | null;
    actorUser?: { name: string } | null;
  }): AuditEventSummary {
    return {
      auditId: row.auditId,
      occurredAt: row.occurredAt.toISOString(),
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      branchId: row.branchId,
      actorUserId: row.actorUserId,
      actorName: row.actorUser?.name ?? null,
    };
  }
}
