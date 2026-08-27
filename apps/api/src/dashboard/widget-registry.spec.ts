import type { AuthContext } from '../common/auth-context';
import { ALL_PERMISSION_CODES } from '../users/rbac/permission-catalog';
import { QUICK_ACTIONS, visibleQuickActions } from './quick-actions';
import {
  DASHBOARD_ALERTS,
  DASHBOARD_VIEW_PERMISSION,
  DASHBOARD_WIDGETS,
  findWidget,
  visibleAlerts,
  visibleWidgets,
} from './widget-registry';

/**
 * The dashboard's registries.
 *
 * Module 18 deliberately introduces no permission code of its own: a widget is
 * gated by the code of the module that owns the data, so that a user who may
 * see the loan book may see a summary of it and a user who may not, may not.
 * That decision is only worth anything if it is *enforced*, and this file is
 * what enforces it — a typo like `loans.veiw` would otherwise produce a widget
 * that silently never renders for anyone, with no error anywhere.
 *
 * The second thing proved here is the shape of the filtering. Scenario 27
 * requires that a caller cannot infer a restricted count from an aggregate, and
 * the design's answer is that unauthorized rows are *omitted* rather than
 * zeroed. Asserting the absence is the only way to catch a later change that
 * "helpfully" returns a zero instead.
 */

function actor(permissions: string[] = []): AuthContext {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    orgId: '22222222-2222-4222-8222-222222222222',
    orgCode: 'DEMO',
    sessionId: '33333333-3333-4333-8333-333333333333',
    branchId: null,
    roles: [],
    permissions,
  };
}

describe('permission codes are real', () => {
  it('gates the dashboard on a code that exists', () => {
    expect(ALL_PERMISSION_CODES).toContain(DASHBOARD_VIEW_PERMISSION);
  });

  it.each(DASHBOARD_WIDGETS.map((w) => [w.code, w.permissions] as const))(
    'widget %s requires only codes in the catalogue',
    (_code, permissions) => {
      for (const permission of permissions) {
        expect(ALL_PERMISSION_CODES).toContain(permission);
      }
    },
  );

  it.each(DASHBOARD_ALERTS.map((a) => [a.alertType, a.permission] as const))(
    'alert %s requires a code in the catalogue',
    (_type, permission) => {
      expect(ALL_PERMISSION_CODES).toContain(permission);
    },
  );

  it.each(QUICK_ACTIONS.map((a) => [a.code, a.permissions] as const))(
    'quick action %s requires only codes in the catalogue',
    (_code, permissions) => {
      for (const permission of permissions) {
        expect(ALL_PERMISSION_CODES).toContain(permission);
      }
    },
  );

  it('introduces no permission code of its own', () => {
    // The whole point of decision 5. A code here that the catalogue does not
    // have is caught above; this catches the reverse mistake — someone adding a
    // `dashboard.widget.*` family and wiring it in.
    const declared = [
      ...DASHBOARD_WIDGETS.flatMap((w) => w.permissions),
      ...DASHBOARD_ALERTS.map((a) => a.permission),
      ...QUICK_ACTIONS.flatMap((a) => a.permissions),
    ];

    expect(declared.filter((code) => code.startsWith('dashboard.'))).toEqual(
      [],
    );
  });
});

describe('registry shape', () => {
  it('declares every widget exactly once', () => {
    const codes = DASHBOARD_WIDGETS.map((w) => w.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('declares every alert type exactly once', () => {
    const types = DASHBOARD_ALERTS.map((a) => a.alertType);
    expect(new Set(types).size).toBe(types.length);
  });

  it('declares every quick action exactly once', () => {
    const codes = QUICK_ACTIONS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each(DASHBOARD_WIDGETS.map((w) => [w.code, w] as const))(
    'widget %s carries a caption explaining the period',
    (_code, widget) => {
      // `periodNote` is rendered to the reader. A blank one would leave a user
      // unable to tell whether the filter they set applied — Scenario 4.
      expect(widget.periodNote.trim().length).toBeGreaterThan(0);
      expect(widget.title.trim().length).toBeGreaterThan(0);
    },
  );

  it.each(
    [
      ...DASHBOARD_WIDGETS.map((w) => [w.code, w.drillDownHref] as const),
      ...DASHBOARD_ALERTS.map((a) => [a.alertType, a.href] as const),
      ...QUICK_ACTIONS.map((a) => [a.code, a.href] as const),
    ].map(([name, href]) => [name, href] as const),
  )('%s links to an absolute in-app path', (_name, href) => {
    // A relative href would resolve against whatever page rendered it, and an
    // absolute URL would navigate out of the application entirely.
    expect(href.startsWith('/')).toBe(true);
    expect(href.startsWith('//')).toBe(false);
  });

  it('finds a widget by code and refuses an unknown one', () => {
    expect(findWidget('LOAN_SUMMARY')?.title).toBe('Loan Summary');
    // Undefined, not a default widget: the controller turns this into a 404
    // rather than serving something the caller did not ask for.
    expect(findWidget('NOT_A_WIDGET')).toBeUndefined();
  });

  it('marks exactly the two list widgets as ungated', () => {
    // These two filter their own rows, so gating the container as well would
    // hide the whole panel from a user entitled to one row of it.
    const ungated = DASHBOARD_WIDGETS.filter(
      (w) => w.permissions.length === 0,
    ).map((w) => w.code);

    expect(ungated.sort()).toEqual(['OPERATIONAL_ALERTS', 'QUICK_ACTIONS']);
  });

  it('applies the period only to range-bounded widgets', () => {
    const ranged = DASHBOARD_WIDGETS.filter(
      (w) => w.scopeType === 'RANGE_BOUNDED',
    ).map((w) => w.code);

    // Cash is AS_OF_NOW deliberately: it is counted per business date, and a
    // range would sum custody positions that never coexisted.
    expect(ranged.sort()).toEqual(['COLLECTION_SUMMARY', 'RECENT_ACTIVITY']);
  });
});

describe('visibleWidgets', () => {
  it('offers only the ungated widgets to a caller holding nothing', () => {
    expect(
      visibleWidgets(actor())
        .map((w) => w.code)
        .sort(),
    ).toEqual(['OPERATIONAL_ALERTS', 'QUICK_ACTIONS']);
  });

  it('requires every code a widget names, not just one', () => {
    // Loan Summary shows application counts beside loan counts. A caller with
    // only one of the two would otherwise see the other's figures.
    expect(
      visibleWidgets(actor(['loans.view'])).map((w) => w.code),
    ).not.toContain('LOAN_SUMMARY');

    expect(
      visibleWidgets(actor(['loans.view', 'loans.applications.view'])).map(
        (w) => w.code,
      ),
    ).toContain('LOAN_SUMMARY');
  });

  it('offers every widget to a caller holding everything', () => {
    const all = DASHBOARD_WIDGETS.flatMap((w) => [...w.permissions]);
    expect(visibleWidgets(actor(all))).toHaveLength(DASHBOARD_WIDGETS.length);
  });
});

describe('visibleAlerts', () => {
  it('omits an unauthorized alert rather than reporting it as zero', () => {
    // Scenario 27. A zero would tell an unauthorized reader there is nothing
    // there, which is a claim about data they may not see.
    const alerts = visibleAlerts(actor(['overdue.view']));

    expect(alerts.map((a) => a.alertType)).toEqual(['EMIS_OVERDUE']);
    expect(alerts.some((a) => a.alertType === 'FAILED_JOBS')).toBe(false);
  });

  it('returns an empty list, not an error, for a caller holding nothing', () => {
    // No-data is a valid state (Rule 36). An empty alert panel is the correct
    // rendering for a user who may see no alert source.
    expect(visibleAlerts(actor())).toEqual([]);
  });
});

describe('visibleQuickActions', () => {
  it('always offers notifications, which need no permission', () => {
    // A notification is addressed to one user and the centre shows only their
    // own, so there is nothing to withhold.
    expect(visibleQuickActions(actor()).map((a) => a.code)).toEqual([
      'OPEN_NOTIFICATIONS',
    ]);
  });

  it('offers an action only when its destination is reachable', () => {
    // Rule 26 and Scenario 29: the permission named is the destination screen's
    // own, so an offered action can always be opened.
    const actions = visibleQuickActions(actor(['customers.create']));

    expect(actions.map((a) => a.code).sort()).toEqual([
      'ADD_CUSTOMER',
      'OPEN_NOTIFICATIONS',
    ]);
  });
});
