import type { AuditQueryService } from '../../audit/audit-query.service';
import type { AuthContext } from '../../common/auth-context';
import type { ResolvedPeriod } from '../widget-meta';
import { RecentActivityService } from './recent-activity.service';

/**
 * Recent activity.
 *
 * The service is a thin wrapper, so most of what makes it safe is proved
 * elsewhere: `AuditQueryService` confines rows to the caller's branch and
 * redacts what they may not read, and `sanitizeMetadata` kept secrets out at
 * write time. Two things are this file's own:
 *
 *  1. **It asks the audit service, rather than the table.** Querying
 *     `auditLog` directly would work and would silently drop every redaction
 *     rule, because the redaction lives in the service.
 *  2. **The dashboard's own rows are excluded.** Opening the home screen writes
 *     one row per widget, so without this the panel fills with its own
 *     footprints and pushes out the business activity it exists to show.
 */

const PERIOD: ResolvedPeriod = {
  periodType: 'THIS_MONTH',
  fromDate: '2026-08-01',
  toDate: '2026-08-26',
};

function actor(): AuthContext {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    orgId: '22222222-2222-4222-8222-222222222222',
    orgCode: 'DEMO',
    sessionId: '33333333-3333-4333-8333-333333333333',
    branchId: null,
    roles: [],
    permissions: ['dashboard.view', 'audit.view'],
  };
}

/** An audit row shaped the way `AuditQueryService.list` returns one. */
interface AuditRow {
  auditId: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  branchId: string | null;
  actorUserId: string | null;
  /** Null for a system actor, or a name this reader may not see. */
  actorName: string | null;
}

function row(action: string, index: number): AuditRow {
  return {
    auditId: `audit-${index}`,
    occurredAt: '2026-08-26T10:00:00.000Z',
    action,
    entityType: 'LOAN',
    entityId: `loan-${index}`,
    branchId: null,
    actorUserId: 'user-1',
    actorName: 'RBAC Super Admin',
  };
}

function build(rows: AuditRow[]) {
  const calls: Record<string, unknown>[] = [];

  const auditQuery = {
    list: (_actor: AuthContext, filters: Record<string, unknown>) => {
      calls.push(filters);
      return Promise.resolve({
        items: rows,
        total: rows.length,
        page: 1,
        pageSize: rows.length,
      });
    },
  } as unknown as AuditQueryService;

  return { service: new RecentActivityService(auditQuery), calls };
}

describe('RecentActivityService', () => {
  it('bounds the panel to ten rows', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => row('LOAN_CREATED', i));
    const { service } = build(rows);

    const result = await service.run(actor(), PERIOD);

    expect(result.items).toHaveLength(10);
  });

  it('passes the selected period through to the audit query', async () => {
    const { service, calls } = build([]);

    await service.run(actor(), PERIOD);

    expect(calls[0]).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-26',
      page: 1,
    });
  });

  it("excludes the dashboard's own audit rows", async () => {
    // Opening the home screen writes one row per widget. Without the filter the
    // panel would show nothing but the previous page load.
    const rows = [
      row('DASHBOARD_VIEWED', 1),
      row('DASHBOARD_WIDGET_VIEWED', 2),
      row('DASHBOARD_WIDGET_DENIED', 3),
      row('LOAN_CREATED', 4),
      row('COLLECTION_POSTED', 5),
    ];
    const { service } = build(rows);

    const result = await service.run(actor(), PERIOD);

    expect(result.items.map((item) => item.action)).toEqual([
      'LOAN_CREATED',
      'COLLECTION_POSTED',
    ]);
  });

  it('over-fetches so the panel still fills after the exclusion', async () => {
    // Asking for exactly ten would come back mostly empty once the dashboard's
    // own rows are dropped.
    const { service, calls } = build([]);

    await service.run(actor(), PERIOD);

    expect(calls[0].pageSize).toBeGreaterThan(10);
  });

  it('returns an empty list rather than failing when nothing matched', async () => {
    // No-data is a valid state; the caller turns this into NO_DATA.
    const { service } = build([]);

    const result = await service.run(actor(), PERIOD);

    expect(result.items).toEqual([]);
  });

  it('carries the actor name through unchanged, including when absent', async () => {
    // Null means a system actor, or a name this reader may not see. Either way
    // it is the audit service's decision, not this one's, to reproduce.
    const rows = [{ ...row('LOAN_CREATED', 1), actorName: null }];
    const { service } = build(rows);

    const result = await service.run(actor(), PERIOD);

    expect(result.items[0].actorName).toBeNull();
  });
});
