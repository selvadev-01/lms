import { ConflictException, Injectable } from '@nestjs/common';
import type { NotificationPreferences } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePreferencesDto } from '../dto/notifications.dto';

/**
 * A user's own notification preferences.
 *
 * # There is no `userId` parameter on any method
 *
 * Every method takes `actor` and reads `actor.userId` from the JWT. Rules 49
 * and 50 scope preferences to the authenticated user, and Scenario 19 requires
 * that User A cannot modify User B's.
 *
 * A permission check would satisfy the scenario; an absent parameter satisfies
 * it more strongly. There is no argument to pass another user's id in, so the
 * refusal cannot be removed by deleting a guard — the capability does not
 * exist. `notifications.preferences.manage` gates *whether you may change your
 * own*, not whose you may change.
 *
 * # Reading creates the row
 *
 * A user who has never opened the screen has no row, and the evaluator treats
 * that as "everything on". `get` upserts defaults so the client always has a
 * `version` to send back — without one, the first update would have nothing to
 * compare against and optimistic concurrency would start a step behind.
 */
@Injectable()
export class PreferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The caller's own preferences, creating defaults on first read. */
  async get(actor: AuthContext): Promise<NotificationPreferences> {
    const row = await this.prisma.notificationPreference.upsert({
      where: { orgId_userId: { orgId: actor.orgId, userId: actor.userId } },
      create: { orgId: actor.orgId, userId: actor.userId },
      update: {},
    });

    return this.toView(row);
  }

  /**
   * Update the caller's own preferences.
   *
   * # The conflict path is the point of this method
   *
   * Rules 65 and 66 require a stale update be *detected* rather than applied.
   * The update is conditional on the version the client read, expressed as a
   * predicate in the WHERE clause rather than a read-then-write — two devices
   * saving at once would both pass a read-then-compare check and the second
   * would silently win.
   *
   * On mismatch this throws a 409 **carrying the current server state**
   * (Scenarios 21, 51). Returning the state rather than a bare error is what
   * lets a client that was behind reconcile and re-submit, instead of guessing
   * what it missed or blindly overwriting.
   */
  async update(
    actor: AuthContext,
    dto: UpdatePreferencesDto,
    meta: RequestMeta,
  ): Promise<NotificationPreferences> {
    // Ensures a row exists, so a first-time save is an update rather than a
    // conflict against nothing.
    const before = await this.get(actor);

    const result = await this.prisma.notificationPreference.updateMany({
      where: {
        orgId: actor.orgId,
        userId: actor.userId,
        // The guard. Not a read-then-compare: two concurrent saves would both
        // pass that, and the later one would silently overwrite the earlier.
        version: dto.version,
      },
      data: {
        inAppEnabled: dto.inAppEnabled,
        emailEnabled: dto.emailEnabled,
        smsEnabled: dto.smsEnabled,
        ...(dto.eventPreferences
          ? { eventPreferences: { ...dto.eventPreferences } }
          : {}),
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      const current = await this.get(actor);

      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.NOTIFICATION_PREFERENCE_CONFLICT,
          entityType: 'NOTIFICATION_PREFERENCE',
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            submittedVersion: dto.version,
            currentVersion: current.version,
          },
        })
        .catch(() => undefined);

      throw new ConflictException({
        message:
          'These preferences were changed elsewhere. Review the current settings and try again.',
        code: 'PREFERENCE_CONFLICT',
        current,
      });
    }

    const after = await this.get(actor);

    // Scenario 18: the change is audit logged.
    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.NOTIFICATION_PREFERENCES_UPDATED,
        entityType: 'NOTIFICATION_PREFERENCE',
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        oldData: {
          inAppEnabled: before.inAppEnabled,
          emailEnabled: before.emailEnabled,
          smsEnabled: before.smsEnabled,
        },
        newData: {
          inAppEnabled: after.inAppEnabled,
          emailEnabled: after.emailEnabled,
          smsEnabled: after.smsEnabled,
        },
      })
      .catch(() => undefined);

    return after;
  }

  private toView(row: {
    inAppEnabled: boolean;
    emailEnabled: boolean;
    smsEnabled: boolean;
    eventPreferences: unknown;
    version: number;
    updatedAt: Date;
  }): NotificationPreferences {
    return {
      inAppEnabled: row.inAppEnabled,
      emailEnabled: row.emailEnabled,
      smsEnabled: row.smsEnabled,
      eventPreferences: row.eventPreferences ?? {},
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
