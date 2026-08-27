import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { NotificationPreferences } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { UpdatePreferencesDto } from '../dto/notifications.dto';
import { PreferenceService } from './preference.service';

export const NOTIFICATIONS_PREFERENCES_MANAGE_PERMISSION =
  'notifications.preferences.manage';

/**
 * Personal notification preferences.
 *
 * # Look at what these routes do not have
 *
 * No `:userId`. Not on the GET, not on the PUT, not as a query parameter.
 * Scenario 19 requires that User A cannot update User B's preferences, and the
 * route offering nowhere to name another user is what makes that true — more
 * durably than a permission check, which a later refactor could remove without
 * anything failing visibly.
 *
 * `notifications.preferences.manage` therefore gates *whether you may change
 * your own*, not whose you may change. That is why the GET carries no
 * permission at all: reading your own settings is not a privilege, and a user
 * who cannot change them still needs to see what they are.
 *
 * # Why PUT and not PATCH
 *
 * The whole preference set is submitted together with the version it was read
 * at. A PATCH of one field would still need the version, and would still be
 * refused on a conflict — but it would invite a client to send a partial update
 * without having read the current state, which is the pattern Rules 65 and 66
 * exist to prevent.
 */
@Controller('notifications/preferences')
export class PreferenceController {
  constructor(private readonly preferences: PreferenceService) {}

  /**
   * The caller's own preferences.
   *
   * Unpermissioned on purpose — see the class comment. Creates the row with
   * defaults on first read so the client always has a `version` to send back.
   */
  @Get()
  get(@CurrentUser() user: AuthContext): Promise<NotificationPreferences> {
    return this.preferences.get(user);
  }

  /**
   * Scenario 18, and Scenarios 21 and 51 on the failure path.
   *
   * A stale `version` is a 409 carrying the current server state, so a client
   * that was behind can reconcile rather than guess or overwrite.
   */
  @Put()
  @RequirePermissions(NOTIFICATIONS_PREFERENCES_MANAGE_PERMISSION)
  update(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpdatePreferencesDto,
    @Req() req: Request,
  ): Promise<NotificationPreferences> {
    return this.preferences.update(user, dto, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }
}
