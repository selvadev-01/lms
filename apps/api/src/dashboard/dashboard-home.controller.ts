import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { DashboardLayout, DashboardWidget } from '@lms/types';
import type { Request } from 'express';

import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { DashboardHomeService } from './dashboard-home.service';
// A value import, not `import type`. These are validation classes: Nest reads
// their decorator metadata at runtime to build the ValidationPipe's schema, and
// a type-only import is erased at compile time — leaving the pipe with no
// metadata, `forbidNonWhitelisted` stripping every query parameter, and every
// dashboard request refused with "property periodType should not exist".
import {
  DashboardLayoutQueryDto,
  DashboardWidgetQueryDto,
} from './dto/dashboard.dto';
import { DASHBOARD_VIEW_PERMISSION } from './widget-registry';

/**
 * The home screen's HTTP surface (Scenarios 1, 8, 23, 37, 40).
 *
 * # Every handler is a `@Get`
 *
 * Rules 10, 33, 44 and 47 make the dashboard a read and navigation layer: it
 * must not create or edit loans, collections, ledger entries or penalties, must
 * not delete a referenced record, and must not offer a direct ledger edit. The
 * surest way to honour that is to expose no way to attempt it. Scenarios 23 and
 * 40 are satisfied by there being no `@Post`, `@Patch` or `@Delete` here at
 * all, rather than by a check inside one.
 *
 * # `dashboard.view` gates the class, the widget gates itself
 *
 * The guard refuses anyone without `dashboard.view` and audits it (Scenario 8).
 * It cannot know which widget was requested, so the owning module's permission
 * is checked in the service — and *that* is the check Scenario 9 turns on.
 *
 * # Route order
 *
 * `layout` is declared before `widgets/:widgetCode`. Their segment counts
 * differ, so nothing is shadowed today; the rule is followed anyway, because a
 * future literal `widgets/summary` declared after the parameterised route would
 * be swallowed by it and fail with a message blaming the caller for sending a
 * bad widget code. Module 16 shipped exactly that bug.
 */
/**
 * One page view costs eight requests: the layout plus one per widget.
 *
 * The global default is 60 a minute, which independent widget fetching exhausts
 * in about seven page loads — and the requests it drops are the *last* ones in
 * the fan-out, so the same widgets fail every time while their neighbours
 * render. That reads as "Recent Activity is broken" rather than as a rate
 * limit, which is the worst possible way for a limit to present.
 *
 * Raised rather than removed. These handlers are reads over rows the caller has
 * already proven they may see, and each is a bounded aggregate — but
 * `positionKpis` pages the whole loan book, so an unlimited dashboard would be
 * a comfortable way to load the database. 240 covers thirty page loads a
 * minute, well beyond a person clicking Refresh and well short of a loop.
 *
 * The alternative — collapsing the seven requests into one — would cost the
 * independent failure and per-widget Retry that Rules 33 and 37 require.
 */
@Controller('dashboard')
@RequirePermissions(DASHBOARD_VIEW_PERMISSION)
@Throttle({ default: { limit: 240, ttl: 60_000 } })
export class DashboardHomeController {
  constructor(private readonly dashboard: DashboardHomeService) {}

  /** What this caller may see, and which branches they may look at. */
  @Get('layout')
  layout(
    @CurrentUser() user: AuthContext,
    @Query() query: DashboardLayoutQueryDto,
    @Req() req: Request,
  ): Promise<DashboardLayout> {
    return this.dashboard.layout(user, query.branchId, this.meta(req));
  }

  /**
   * One widget's data.
   *
   * Separate requests per widget are what make Rule 33 and Scenario 37 real:
   * one failing source produces one failed panel, and Retry reloads only that
   * panel rather than the whole screen.
   */
  @Get('widgets/:widgetCode')
  widget(
    @CurrentUser() user: AuthContext,
    @Param('widgetCode') widgetCode: string,
    @Query() query: DashboardWidgetQueryDto,
    @Req() req: Request,
  ): Promise<DashboardWidget<unknown>> {
    return this.dashboard.widget(user, widgetCode, query, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }
}
