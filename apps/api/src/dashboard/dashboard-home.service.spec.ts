import { ForbiddenException } from '@nestjs/common';

import { AuditAction } from '../audit/audit.service';
import type { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import type { PrismaService } from '../prisma/prisma.service';
import { DashboardHomeService } from './dashboard-home.service';
import type { CashSummaryService } from './widgets/cash-summary.service';
import type { CollectionSummaryService } from './widgets/collection-summary.service';
import type { LoanSummaryService } from './widgets/loan-summary.service';
import type { OperationalAlertsService } from './widgets/operational-alerts.service';
import type { OverdueSummaryService } from './widgets/overdue-summary.service';
import type { RecentActivityService } from './widgets/recent-activity.service';

/**
 * The home screen orchestrator.
 *
 * Four properties are worth pinning, and each is a way the dashboard could be
 * quietly wrong rather than visibly broken:
 *
 *  1. **A failed widget carries no `data` key at all.** Scenario 36. The union
 *     already makes it impossible to *read* one, but a service that returned
 *     `{status:'FAILED', data: someZeroes}` would satisfy the type and hand a
 *     renderer a plausible zero. Asserting the key's absence is what catches it.
 *  2. **`NO_DATA` and `AVAILABLE` are decided by emptiness, not by luck.**
 *     Scenario 35 makes an empty result valid; a zero *rate* against a real
 *     amount due is a performance figure and must stay `AVAILABLE`.
 *  3. **A refusal stays a refusal.** A missing permission or an unreachable
 *     branch must propagate as `ForbiddenException` — never be swallowed into
 *     a failed widget, which would turn a 403 into a 200 with an error card.
 *  4. **Widget isolation is real.** One widget throwing leaves the others
 *     answering, because each is a separate request (Rule 33).
 *
 * No database. Every collaborator is a stub.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const BRANCH_A = '44444444-4444-4444-8444-444444444444';
const BRANCH_B = '55555555-5555-4555-8555-555555555555';

const META: RequestMeta = {
  requestId: 'req-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

const ALL_PERMISSIONS = [
  'dashboard.view',
  'loans.view',
  'loans.applications.view',
  'collections.view',
  'overdue.view',
  'cash.reconciliation.view',
  'audit.view',
];

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    orgId: ORG,
    orgCode: 'DEMO',
    sessionId: '33333333-3333-4333-8333-333333333333',
    branchId: null,
    roles: [],
    permissions: ALL_PERMISSIONS,
    ...overrides,
  };
}

interface Overrides {
  loans?: () => Promise<unknown>;
  collections?: () => Promise<unknown>;
  overdue?: () => Promise<unknown>;
  cash?: () => Promise<unknown>;
  alerts?: () => Promise<unknown>;
  activity?: () => Promise<unknown>;
}

function build(overrides: Overrides = {}) {
  const audited: { action: string; metadata: unknown }[] = [];

  const prisma = {
    branch: {
      findMany: () =>
        Promise.resolve([{ branchId: BRANCH_A, name: 'Central' }]),
      findFirst: () => Promise.resolve({ name: 'Central' }),
    },
  } as unknown as PrismaService;

  const audit = {
    record: (input: { action: string; metadata: unknown }) => {
      audited.push({ action: input.action, metadata: input.metadata });
      return Promise.resolve();
    },
  } as unknown as AuditService;

  const service = new DashboardHomeService(
    prisma,
    audit,
    {
      run:
        overrides.loans ??
        (() =>
          Promise.resolve({
            totalApplications: 4,
            pendingApproval: 1,
            approved: 1,
            activeLoans: 2,
            closedLoans: 1,
            overdueLoans: 1,
            totalOutstandingPaise: '500000',
          })),
    } as unknown as LoanSummaryService,
    {
      run:
        overrides.collections ??
        (() =>
          Promise.resolve({
            duePaise: '100000',
            collectedPaise: '75000',
            pendingPaise: '25000',
            collectionRateBps: '7500',
            fieldCollectedPaise: '25000',
          })),
    } as unknown as CollectionSummaryService,
    {
      run:
        overrides.overdue ??
        (() =>
          Promise.resolve({
            overdueAccounts: 0,
            overdueAmountPaise: '0',
            penaltyOutstandingPaise: '0',
            escalatedToField: 0,
            pendingBranchReview: 0,
            legalCases: null,
          })),
    } as unknown as OverdueSummaryService,
    {
      run:
        overrides.cash ??
        (() =>
          Promise.resolve({
            cashInPaise: '0',
            cashOutPaise: '0',
            expectedClosingPaise: '0',
            actualCashPaise: null,
            differencePaise: null,
            reconciliationStatus: null,
            dayClosingStatus: null,
          })),
    } as unknown as CashSummaryService,
    {
      run:
        overrides.alerts ??
        (() => Promise.resolve({ alerts: [], droppedTypes: [] })),
    } as unknown as OperationalAlertsService,
    {
      run: overrides.activity ?? (() => Promise.resolve({ items: [] })),
    } as unknown as RecentActivityService,
  );

  return { service, audited };
}

describe('layout', () => {
  it('offers only the widgets the caller may see', async () => {
    const { service } = build();

    const layout = await service.layout(
      actor({ permissions: ['dashboard.view', 'overdue.view'] }),
      undefined,
      META,
    );

    const codes = layout.widgets.map((w) => w.widgetCode).sort();
    expect(codes).toEqual([
      'OPERATIONAL_ALERTS',
      'OVERDUE_RECOVERY',
      'QUICK_ACTIONS',
    ]);
  });

  it('reports an org-level caller as unlocked and branch-wide', async () => {
    const { service } = build();

    const layout = await service.layout(actor(), undefined, META);

    expect(layout.scope.branchLocked).toBe(false);
    expect(layout.scope.branchId).toBeNull();
  });

  it('locks a branch-confined caller to their own branch', async () => {
    const { service } = build();

    const layout = await service.layout(
      actor({ branchId: BRANCH_A }),
      undefined,
      META,
    );

    expect(layout.scope.branchLocked).toBe(true);
    expect(layout.scope.branchId).toBe(BRANCH_A);
  });

  it('audits the access (Scenario 45)', async () => {
    const { service, audited } = build();

    await service.layout(actor(), undefined, META);

    expect(audited.map((row) => row.action)).toContain(
      AuditAction.DASHBOARD_VIEWED,
    );
  });

  it('refuses and audits a branch the caller cannot reach (Scenario 7)', async () => {
    const { service, audited } = build();

    await expect(
      service.layout(actor({ branchId: BRANCH_A }), BRANCH_B, META),
    ).rejects.toThrow(ForbiddenException);

    expect(audited.map((row) => row.action)).toContain(
      AuditAction.DASHBOARD_SCOPE_DENIED,
    );
  });

  it('carries a business date it derived itself', async () => {
    const { service } = build();

    const layout = await service.layout(actor(), undefined, META);

    expect(layout.scope.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('widget authorization', () => {
  it('refuses an unknown widget code', async () => {
    const { service } = build();

    await expect(
      service.widget(actor(), 'NOT_A_WIDGET', {}, META),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a widget whose owning permission is missing (Scenario 9)', async () => {
    const { service, audited } = build();

    await expect(
      service.widget(
        actor({ permissions: ['dashboard.view'] }),
        'CASH_SUMMARY',
        {},
        META,
      ),
    ).rejects.toThrow(ForbiddenException);

    const denial = audited.find(
      (row) => row.action === AuditAction.DASHBOARD_WIDGET_DENIED,
    );
    expect(denial).toBeDefined();
    // The missing code is recorded, so an operator can tell which grant is
    // absent rather than guessing from the widget name.
    expect(denial?.metadata).toMatchObject({
      widgetCode: 'CASH_SUMMARY',
      missingPermissions: ['cash.reconciliation.view'],
    });
  });

  it('requires every code a widget names, not just one', async () => {
    const { service } = build();

    await expect(
      service.widget(
        actor({ permissions: ['dashboard.view', 'loans.view'] }),
        'LOAN_SUMMARY',
        {},
        META,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does not trust the layout as the authorization', async () => {
    // The layout omits this widget for this caller. Requesting it directly
    // still reaches the permission check and is refused.
    const { service } = build();
    const caller = actor({ permissions: ['dashboard.view'] });

    const layout = await service.layout(caller, undefined, META);
    expect(layout.widgets.map((w) => w.widgetCode)).not.toContain(
      'RECENT_ACTIVITY',
    );

    await expect(
      service.widget(caller, 'RECENT_ACTIVITY', {}, META),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a branch the caller cannot reach before loading anything', async () => {
    let loaded = false;
    const { service } = build({
      loans: () => {
        loaded = true;
        return Promise.resolve({});
      },
    });

    await expect(
      service.widget(
        actor({ branchId: BRANCH_A }),
        'LOAN_SUMMARY',
        { branchId: BRANCH_B },
        META,
      ),
    ).rejects.toThrow(ForbiddenException);

    // Scenario 7: no data for the other branch was read, not merely withheld.
    expect(loaded).toBe(false);
  });
});

describe('widget failure (Scenario 36)', () => {
  it('returns FAILED with no data key when the source throws', async () => {
    const { service } = build({
      loans: () => Promise.reject(new Error('database is down')),
    });

    const result = await service.widget(actor(), 'LOAN_SUMMARY', {}, META);

    expect(result.status).toBe('FAILED');
    // The assertion that matters. A `data` key here — even holding zeroes —
    // would let a renderer display a confident zero for a query that failed.
    expect('data' in result).toBe(false);
  });

  it('marks a failed widget unavailable rather than live', async () => {
    const { service } = build({
      cash: () => Promise.reject(new Error('timeout')),
    });

    const result = await service.widget(actor(), 'CASH_SUMMARY', {}, META);

    expect(result.meta.freshness).toBe('UNAVAILABLE');
  });

  it('marks the failure retryable, because the permission checks passed', async () => {
    const { service } = build({
      loans: () => Promise.reject(new Error('transient')),
    });

    const result = await service.widget(actor(), 'LOAN_SUMMARY', {}, META);

    expect(result.status === 'FAILED' && result.retryable).toBe(true);
  });

  it('audits the failure', async () => {
    const { service, audited } = build({
      loans: () => Promise.reject(new Error('boom')),
    });

    await service.widget(actor(), 'LOAN_SUMMARY', {}, META);

    expect(audited.map((row) => row.action)).toContain(
      AuditAction.DASHBOARD_WIDGET_FAILED,
    );
  });

  it('never turns a refusal into a failed widget', async () => {
    // A ForbiddenException raised deeper down keeps its meaning: a 403, not a
    // 200 carrying an error card.
    const { service } = build({
      loans: () => Promise.reject(new ForbiddenException('nope')),
    });

    await expect(
      service.widget(actor(), 'LOAN_SUMMARY', {}, META),
    ).rejects.toThrow(ForbiddenException);
  });

  it('leaves other widgets answering when one fails (Rule 33)', async () => {
    const { service } = build({
      cash: () => Promise.reject(new Error('down')),
    });
    const caller = actor();

    const failed = await service.widget(caller, 'CASH_SUMMARY', {}, META);
    const healthy = await service.widget(caller, 'LOAN_SUMMARY', {}, META);

    expect(failed.status).toBe('FAILED');
    expect(healthy.status).toBe('AVAILABLE');
  });
});

describe('no-data versus available (Scenario 35)', () => {
  it('reports an empty loan book as NO_DATA, not as zeroes', async () => {
    const { service } = build({
      loans: () =>
        Promise.resolve({
          totalApplications: 0,
          pendingApproval: 0,
          approved: 0,
          activeLoans: 0,
          closedLoans: 0,
          overdueLoans: 0,
          totalOutstandingPaise: '0',
        }),
    });

    const result = await service.widget(actor(), 'LOAN_SUMMARY', {}, META);

    expect(result.status).toBe('NO_DATA');
    expect('data' in result).toBe(false);
    expect(result.status === 'NO_DATA' && result.message).toContain('No loans');
  });

  it('keeps a real portfolio AVAILABLE', async () => {
    const { service } = build();

    const result = await service.widget(actor(), 'LOAN_SUMMARY', {}, META);

    expect(result.status).toBe('AVAILABLE');
    expect(result.status === 'AVAILABLE' && result.data).toMatchObject({
      activeLoans: 2,
    });
  });

  it('keeps a zero collection rate AVAILABLE when money was due', async () => {
    // Nothing collected against a real amount due is a *performance figure*,
    // and the worst possible thing to hide behind an empty panel.
    const { service } = build({
      collections: () =>
        Promise.resolve({
          duePaise: '100000',
          collectedPaise: '0',
          pendingPaise: '100000',
          collectionRateBps: '0',
          fieldCollectedPaise: '0',
        }),
    });

    const result = await service.widget(
      actor(),
      'COLLECTION_SUMMARY',
      {},
      META,
    );

    expect(result.status).toBe('AVAILABLE');
  });

  it('reports a period with nothing due and nothing collected as NO_DATA', async () => {
    const { service } = build({
      collections: () =>
        Promise.resolve({
          duePaise: '0',
          collectedPaise: '0',
          pendingPaise: '0',
          collectionRateBps: '0',
          fieldCollectedPaise: '0',
        }),
    });

    const result = await service.widget(
      actor(),
      'COLLECTION_SUMMARY',
      {},
      META,
    );

    expect(result.status).toBe('NO_DATA');
  });

  it('keeps a clean overdue book AVAILABLE, never NO_DATA', async () => {
    // Zero overdue accounts is the best possible state. Reporting it as "no
    // data" would hide the good news behind an empty panel.
    const { service } = build();

    const result = await service.widget(actor(), 'OVERDUE_RECOVERY', {}, META);

    expect(result.status).toBe('AVAILABLE');
  });

  it('reports an empty alert list as NO_DATA', async () => {
    const { service } = build();

    const result = await service.widget(
      actor(),
      'OPERATIONAL_ALERTS',
      {},
      META,
    );

    expect(result.status).toBe('NO_DATA');
  });
});

describe('partial alert failure (Scenario 38)', () => {
  it('degrades to STALE and names what could not be checked', async () => {
    const { service } = build({
      alerts: () =>
        Promise.resolve({
          alerts: [
            {
              alertType: 'EMIS_OVERDUE',
              severity: 'CRITICAL',
              count: 3,
              label: 'Loans overdue',
              href: '/overdues',
            },
          ],
          droppedTypes: ['FAILED_JOBS'],
        }),
    });

    const result = await service.widget(
      actor(),
      'OPERATIONAL_ALERTS',
      {},
      META,
    );

    expect(result.status).toBe('STALE');
    // STALE is the one status besides AVAILABLE that carries data: the list is
    // real, just incomplete, and the reader is told which part is missing.
    expect('data' in result).toBe(true);
    expect(result.status === 'STALE' && result.staleReason).toContain(
      'FAILED_JOBS',
    );
    expect(result.meta.freshness).toBe('STALE');
  });
});

describe('period handling', () => {
  it('reports the range on a range-bounded widget', async () => {
    const { service } = build();

    const result = await service.widget(
      actor(),
      'COLLECTION_SUMMARY',
      { periodType: 'CUSTOM', fromDate: '2026-01-01', toDate: '2026-01-31' },
      META,
    );

    expect(result.meta.periodApplied).toBe(true);
    expect(result.meta.fromDate).toBe('2026-01-01');
  });

  it('omits the range on an as-of-now widget even when one was sent', async () => {
    // Scenario 4: the filter is not applied, and the response must not imply
    // that it was.
    const { service } = build();

    const result = await service.widget(
      actor(),
      'LOAN_SUMMARY',
      { periodType: 'CUSTOM', fromDate: '2026-01-01', toDate: '2026-01-31' },
      META,
    );

    expect(result.meta.periodApplied).toBe(false);
    expect(result.meta).not.toHaveProperty('fromDate');
  });

  it('refuses an inverted custom range (Scenario 5)', async () => {
    const { service } = build();

    await expect(
      service.widget(
        actor(),
        'COLLECTION_SUMMARY',
        { periodType: 'CUSTOM', fromDate: '2026-01-31', toDate: '2026-01-01' },
        META,
      ),
    ).rejects.toThrow('To Date must be on or after From Date');
  });
});

describe('audit', () => {
  it('records each widget view with its code and status (Scenario 45)', async () => {
    const { service, audited } = build();

    await service.widget(actor(), 'LOAN_SUMMARY', {}, META);

    const viewed = audited.find(
      (row) => row.action === AuditAction.DASHBOARD_WIDGET_VIEWED,
    );
    expect(viewed?.metadata).toMatchObject({
      widgetCode: 'LOAN_SUMMARY',
      status: 'AVAILABLE',
    });
  });
});
