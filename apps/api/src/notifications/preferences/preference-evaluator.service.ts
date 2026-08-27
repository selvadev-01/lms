import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { preferenceCategoryFor } from '../notification-policy';

/** Why a notification will not be delivered on a channel. */
export type SuppressionReason =
  | 'USER_PREFERENCE'
  | 'INACTIVE_RECIPIENT'
  | 'INACTIVE_TEMPLATE'
  | 'NO_ELIGIBLE_RECIPIENT';

export interface DeliveryDecision {
  deliver: boolean;
  reason?: SuppressionReason;
}

/**
 * Decides whether one optional notification reaches one recipient.
 *
 * # Mandatory short-circuits before reading anything
 *
 * `isMandatory` returns `{ deliver: true }` without touching the preferences
 * table at all. That ordering is the whole of Rules 47 and 48 and Scenario 17,
 * and it is deliberately expressed as a short-circuit rather than as
 * read-then-override.
 *
 * The difference matters. Read-then-override works, until someone refactors the
 * two branches into one expression and inverts a condition — at which point a
 * user's opt-out silently suppresses a mandatory operational alert, and nothing
 * fails visibly. Short-circuiting makes that bug unreachable: there is no code
 * path where a preference is read for a mandatory notification, so there is
 * none where it can win.
 *
 * # A missing preference row means "everything on"
 *
 * A user who has never opened the preferences screen receives everything. The
 * alternative — defaulting to off — would mean a newly created user silently
 * receives nothing, which looks exactly like a broken pipeline and would be
 * diagnosed as one.
 *
 * # Suppression is recorded, not silent
 *
 * This service only decides. The caller creates the notification row anyway,
 * with `status: SUPPRESSED` and the reason below, because Scenario 20 asks for
 * the suppression outcome to be *recorded*. A silent drop would leave nothing
 * to inspect when a user asks why they did not hear about something.
 */
@Injectable()
export class PreferenceEvaluatorService {
  constructor(private readonly prisma: PrismaService) {}

  async shouldDeliver(input: {
    orgId: string;
    userId: string;
    channel: string;
    eventType: string;
    isMandatory: boolean;
  }): Promise<DeliveryDecision> {
    // Rules 47, 48; Scenario 17. Before any read — see the class comment.
    if (input.isMandatory) return { deliver: true };

    const preference = await this.prisma.notificationPreference.findUnique({
      where: { orgId_userId: { orgId: input.orgId, userId: input.userId } },
      select: {
        inAppEnabled: true,
        emailEnabled: true,
        smsEnabled: true,
        eventPreferences: true,
      },
    });

    // Default-on: a user who has never expressed a preference receives
    // everything.
    if (!preference) return { deliver: true };

    if (!this.channelEnabled(preference, input.channel)) {
      return { deliver: false, reason: 'USER_PREFERENCE' };
    }

    if (!this.categoryEnabled(preference.eventPreferences, input.eventType)) {
      return { deliver: false, reason: 'USER_PREFERENCE' };
    }

    return { deliver: true };
  }

  private channelEnabled(
    preference: {
      inAppEnabled: boolean;
      emailEnabled: boolean;
      smsEnabled: boolean;
    },
    channel: string,
  ): boolean {
    switch (channel) {
      case 'IN_APP':
        return preference.inAppEnabled;
      case 'EMAIL':
        return preference.emailEnabled;
      case 'SMS':
        return preference.smsEnabled;
      default:
        // A channel with no toggle cannot be opted out of. Unreachable today —
        // the CHECK constraint allows only the three above — and deliberately
        // fails open rather than silently suppressing a notification on a
        // channel the preferences screen never offered the user.
        return true;
    }
  }

  /**
   * Whether the category governing this event is enabled.
   *
   * A user toggles nine categories, not thirty-two events. An event whose
   * category is absent from the stored map is treated as enabled, for the same
   * reason a missing row is: the user has not expressed a preference about it,
   * and inferring "off" from silence would suppress notifications nobody
   * declined.
   *
   * `preferenceCategoryFor` throws for an unmapped event. That propagates
   * rather than being caught, because an event with no category is a
   * programming error — it would be ungovernable by preference while not being
   * marked mandatory, and failing loudly at the first such event is better than
   * shipping a notification users cannot turn off.
   */
  private categoryEnabled(stored: unknown, eventType: string): boolean {
    const category = preferenceCategoryFor(eventType);
    const map = (stored ?? {}) as Record<string, unknown>;
    const value = map[category];

    return value === undefined ? true : value !== false;
  }
}
