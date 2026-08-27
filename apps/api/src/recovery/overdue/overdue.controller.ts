import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { OverdueDetail, OverdueListResult } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ListOverdueDto } from '../dto/overdue.dto';
import { OverdueService, OVERDUE_VIEW_PERMISSION } from './overdue.service';

/**
 * Module 13 — the overdue book.
 *
 * Read-only by design. There is no POST here and no `PATCH`: overdue status is
 * derived from authoritative obligations and the business date (Rule 4), so
 * there is nothing to write. Rule 8 puts it directly — a recovery user must not
 * be able to mark an EMI overdue when the schedule does not support it — and
 * the surest way to honour that is to expose no way to try.
 */
@Controller('recovery/overdues')
export class OverdueController {
  constructor(private readonly overdue: OverdueService) {}

  @Get()
  @RequirePermissions(OVERDUE_VIEW_PERMISSION)
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListOverdueDto,
    @Req() req: Request,
  ): Promise<OverdueListResult> {
    return this.overdue.list(user, query, this.meta(req));
  }

  /**
   * Keyed by loan, not by an overdue-case id.
   *
   * There is no overdue case row to have an id — the position is derived. The
   * loan is the only thing with an identity here, which is why the source's
   * suggested route is `/overdues/:loanId`.
   */
  @Get(':loanId')
  @RequirePermissions(OVERDUE_VIEW_PERMISSION)
  detail(
    @CurrentUser() user: AuthContext,
    @Param('loanId', new ParseUUIDPipe({ version: '4' })) loanId: string,
    @Req() req: Request,
  ): Promise<OverdueDetail> {
    return this.overdue.detail(user, loanId, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }
}
