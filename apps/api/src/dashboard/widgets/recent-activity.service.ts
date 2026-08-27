import { Injectable } from '@nestjs/common';
import type { RecentActivityWidget } from '@lms/types';

import { AuditQueryService } from '../../audit/audit-query.service';
import type { AuthContext } from '../../common/auth-context';
import type { ResolvedPeriod } from '../widget-meta';

/** How many rows the panel shows. A home screen is a glance, not a log. */
const RECENT_ACTIVITY_LIMIT = 10;

/**
 * Every audit action this module writes shares this prefix.
 *
 * They are excluded from the panel below. Opening the dashboard writes one
 * `DASHBOARD_VIEWED` and one `DASHBOARD_WIDGET_VIEWED` per widget, so on a
 * quiet day the ten most recent events are *all* from the previous page load —
 * the widget reports its own footprints and pushes out the business activity it
 * exists to show. The rows are still written and still visible in the audit
 * trail proper; they are just not news.
 */
const DASHBOARD_ACTION_PREFIX = 'DASHBOARD_';

/**
 * How many rows to ask for so that ten survive the filter above.
 *
 * A Super Admin's own page load contributes eight rows. Three pages' worth of
 * headroom keeps the panel full through a couple of refreshes without asking
 * the audit trail for an unbounded window.
 */
const OVER_FETCH = 4;

/**
 * Recent activity (Scenarios 32-34).
 *
 * # A wrapper, deliberately thin
 *
 * Everything that makes this safe already exists in `AuditQueryService`: it
 * confines rows to the caller's branch, it redacts values the caller may not
 * read, and `AuditService.sanitizeMetadata` removed secrets before the row was
 * ever written. Scenario 34 — no plaintext passwords, secrets or tokens — is
 * therefore satisfied by *not* reimplementing any of it.
 *
 * The temptation this file exists to resist is querying `auditLog` directly for
 * speed. That would work, and it would silently drop every redaction rule,
 * because the redaction lives in the service rather than the table.
 *
 * # Bounded by the selected period
 *
 * The audit trail is the one widget where a period is both meaningful and
 * cheap, so it is `RANGE_BOUNDED`. Ten rows are shown regardless; the period
 * decides which ten.
 *
 * # One exclusion, and its limit
 *
 * The dashboard's own audit rows are dropped — see `DASHBOARD_ACTION_PREFIX`.
 * The over-fetch that makes room for them is bounded, so a user who reloads the
 * home screen many times in a row without anything else happening can still see
 * a short or empty panel. That is the honest outcome: nothing else *did*
 * happen. The alternative, an unbounded scan backwards until ten non-dashboard
 * rows are found, would make one widget's cost depend on how often the page had
 * been refreshed.
 *
 * // TODO(open-question): Question 19 — which activity types belong on the home
 * // screen is unresolved. Beyond the dashboard's own noise no action filter is
 * // applied: filtering to a chosen subset would silently hide the one event a
 * // reader was looking for, and the audit trail's own screen is where a
 * // narrower question gets asked.
 */
@Injectable()
export class RecentActivityService {
  constructor(private readonly auditQuery: AuditQueryService) {}

  async run(
    actor: AuthContext,
    period: ResolvedPeriod,
  ): Promise<RecentActivityWidget> {
    const result = await this.auditQuery.list(actor, {
      from: period.fromDate,
      to: period.toDate,
      page: 1,
      // Over-fetched because the dashboard's own audit rows are dropped below,
      // and a page of exactly ten would come back mostly empty after that.
      pageSize: RECENT_ACTIVITY_LIMIT * OVER_FETCH,
    });

    return {
      items: result.items
        .filter((row) => !row.action.startsWith(DASHBOARD_ACTION_PREFIX))
        .slice(0, RECENT_ACTIVITY_LIMIT)
        .map((row) => ({
          auditId: row.auditId,
          occurredAt: row.occurredAt,
          actorName: row.actorName,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          branchId: row.branchId,
        })),
    };
  }
}
