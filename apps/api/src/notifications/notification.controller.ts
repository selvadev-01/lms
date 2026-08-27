import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  NotificationDetail,
  NotificationListResult,
  NotificationUnreadCount,
} from '@lms/types';

import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ListNotificationsDto } from './dto/notifications.dto';
import { NotificationService } from './notification.service';

/**
 * The signed-in user's own notification centre.
 *
 * # Nothing here carries @RequirePermissions
 *
 * The only controller in this application without a permission on any handler,
 * and it is deliberate rather than an oversight.
 *
 * Rule 53 gives every user the notifications addressed to them. Rule 47 makes
 * some of them mandatory — operational alerts an organization has decided
 * nobody may switch off. Gating this surface would mean an unpermissioned user
 * silently missing exactly those, which inverts the rule it would appear to
 * enforce.
 *
 * Scope is not enforced by a permission here; it is enforced by the query.
 * `NotificationService` filters every read on `recipientUserId = actor.userId`,
 * taken from the JWT, and no DTO field can influence it. A caller cannot
 * construct a request that asks for anyone else's notifications, which is a
 * stronger guarantee than a permission check would give.
 *
 * # Why there is no DELETE
 *
 * Rules 69 to 71 and Scenario 47: notification history is retained for audit.
 * Archiving is the user-visible removal, and it is a timestamp. A delete
 * endpoint would be an endpoint whose only correct implementation is a refusal.
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  /**
   * Throttled because the bell polls this surface.
   *
   * 60 a minute is generous for a 60-second poll and still bounds a client
   * whose timer has run away. The web app polls `unread-count` rather than the
   * list for exactly that reason.
   */
  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListNotificationsDto,
    @Req() req: Request,
  ): Promise<NotificationListResult> {
    return this.notifications.list(user, query, this.meta(req));
  }

  /** The bell badge. Cheaper than the list, and what the web app polls. */
  @Get('unread-count')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  unreadCount(
    @CurrentUser() user: AuthContext,
  ): Promise<NotificationUnreadCount> {
    return this.notifications.unreadCount(user);
  }

  /**
   * Declared after `unread-count` on purpose.
   *
   * Nest matches routes in declaration order, so a `:notificationId` route
   * placed first would swallow `/notifications/unread-count` and try to parse
   * "unread-count" as a UUID.
   */
  @Get(':notificationId')
  detail(
    @CurrentUser() user: AuthContext,
    @Param('notificationId', new ParseUUIDPipe({ version: '4' }))
    notificationId: string,
    @Req() req: Request,
  ): Promise<NotificationDetail> {
    return this.notifications.detail(user, notificationId, this.meta(req));
  }

  /**
   * Scenarios 3 and 4.
   *
   * Changes only this recipient's row. The same event's notification to another
   * user is a different row and stays unread — structurally, not because this
   * handler is careful.
   */
  @Patch(':notificationId/read')
  markRead(
    @CurrentUser() user: AuthContext,
    @Param('notificationId', new ParseUUIDPipe({ version: '4' }))
    notificationId: string,
    @Req() req: Request,
  ): Promise<NotificationDetail> {
    return this.notifications.markRead(user, notificationId, this.meta(req));
  }

  @Patch(':notificationId/unread')
  markUnread(
    @CurrentUser() user: AuthContext,
    @Param('notificationId', new ParseUUIDPipe({ version: '4' }))
    notificationId: string,
    @Req() req: Request,
  ): Promise<NotificationDetail> {
    return this.notifications.markUnread(user, notificationId, this.meta(req));
  }

  /** Scenario 46. A timestamp, never a delete — see the class comment. */
  @Patch(':notificationId/archive')
  archive(
    @CurrentUser() user: AuthContext,
    @Param('notificationId', new ParseUUIDPipe({ version: '4' }))
    notificationId: string,
    @Req() req: Request,
  ): Promise<NotificationDetail> {
    return this.notifications.archive(user, notificationId, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }
}
