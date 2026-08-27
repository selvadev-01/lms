import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  AUDIT_EXPORT_PERMISSION,
  AUDIT_VIEW_PERMISSION,
  AuditQueryService,
  type AuditEventDetail,
  type AuditEventListResult,
} from './audit-query.service';
import { ListAuditDto } from './dto/audit.dto';

/**
 * The audit trail, read-only (Scenarios 36-43).
 *
 * # There is no write route here, and there must never be
 *
 * No POST, no PATCH, no DELETE. Rules 46 and 47 make the trail append-only and
 * immutable to application users, and the absence of a route is the first of
 * three layers enforcing it — the service exposes no write method either, and
 * `audit_logs` carries a database trigger that refuses UPDATE and DELETE
 * outright.
 *
 * # Route order matters
 *
 * `GET export` is declared BEFORE `GET :auditId`. Nest matches in declaration
 * order, so the parameterised route would otherwise swallow `/audit/export` and
 * treat "export" as an id — a 400 from `ParseUUIDPipe` that looks like a
 * validation bug rather than a routing one.
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly auditQuery: AuditQueryService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /** Filtered, paged, and scoped server-side (Rule 55). */
  @Get()
  @RequirePermissions(AUDIT_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListAuditDto,
  ): Promise<AuditEventListResult> {
    return this.auditQuery.list(user, query);
  }

  /**
   * Export to CSV.
   *
   * Rate-limited more tightly than the list: an export is the one audit
   * operation that removes a copy of the evidence from the system, and Rule 57
   * requires each attempt to be logged. A tight limit keeps that log meaningful.
   *
   * MUST stay above the `:auditId` route — see the class header.
   */
  @Get('export')
  @RequirePermissions(AUDIT_EXPORT_PERMISSION)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async export(
    @CurrentUser() user: AuthContext,
    @Query() query: ListAuditDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.auditQuery.exportCsv(user, query, this.meta(req));

    const filename = `audit-${query.from ?? 'start'}-to-${query.to ?? 'end'}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(csv);
  }

  /** One event. Read-only by construction — there is no counterpart write. */
  @Get(':auditId')
  @RequirePermissions(AUDIT_VIEW_PERMISSION)
  async get(
    @CurrentUser() user: AuthContext,
    @Param('auditId', ParseUUIDPipe) auditId: string,
  ): Promise<AuditEventDetail> {
    return this.auditQuery.get(user, auditId);
  }
}
