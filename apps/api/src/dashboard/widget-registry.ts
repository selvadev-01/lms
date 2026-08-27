import type { DashboardScopeType, DashboardWidgetCode } from '@lms/types';

import type { AuthContext } from '../common/auth-context';

/**
 * The permission that opens the dashboard at all (Scenario 8).
 *
 * Declared next to the registry rather than imported from the catalogue, the
 * same way each report service declares its own — the catalogue is the list of
 * codes that exist, not the binding between a code and the thing it guards.
 */
export const DASHBOARD_VIEW_PERMISSION = 'dashboard.view';

export interface WidgetSpec {
  code: DashboardWidgetCode;
  title: string;
  /**
   * Every code must be held, in addition to `dashboard.view`. Empty means the
   * widget is visible to anyone who can open the dashboard — true only for the
   * two widgets that filter their own contents row by row.
   */
  permissions: readonly string[];
  scopeType: DashboardScopeType;
  /** The owning module, named in the caption so Rule 8 is visible to a reader. */
  source: string;
  /** Where the heading navigates. Re-authorized at the destination (Rule 30). */
  drillDownHref: string;
  /** Why the period filter does or does not apply, in the words shown. */
  periodNote: string;
}

/**
 * The widgets the operational home screen is built from.
 *
 * # Why a constant and not a table
 *
 * The specification lists a `dashboard_widget_code` table. There is none. A
 * widget's permission and data source are decided by the code that queries it,
 * so a row that disagreed with the service would be a lie the database told
 * about the application — and the failure mode is silent: an administrator
 * "enables" a widget by editing a row, and the widget still refuses because the
 * service checks something else. Module 13 reaches the same conclusion about
 * overdue status for the same reason: a stored copy needs a writer, and a
 * writer can be wrong.
 *
 * A widget is added by adding an entry here and a service to match, which is a
 * deployment. That is the honest cost of the feature.
 *
 * # Permissions are the owning module's, not the dashboard's
 *
 * There is no `dashboard.widget.loans` code. A user who may see the loan book
 * may see a summary of it; a user who may not, may not — and expressing that
 * twice is how the two drift. Rule 6 makes widgets permission-controlled and
 * Rule 7 makes the check server-side; neither asks for a *separate* permission,
 * and inventing one would create a state where a user holds the widget code but
 * not the drill-down it links to, which Scenario 9 would then fail.
 *
 * `widget-registry.spec.ts` asserts every code named here exists in the
 * permission catalogue, so a typo is a failing test rather than a widget that
 * silently never renders.
 *
 * # Two widgets carry no permission of their own
 *
 * `OPERATIONAL_ALERTS` and `QUICK_ACTIONS` are lists whose *rows* are gated
 * individually. Gating the container as well would hide the whole panel from a
 * user entitled to one row of it. Scenario 27 turns on this: an alert the
 * caller may not see is omitted from the list rather than summarised into a
 * total, so there is no aggregate from which a restricted count could be
 * inferred.
 */
export const DASHBOARD_WIDGETS: readonly WidgetSpec[] = [
  {
    code: 'LOAN_SUMMARY',
    title: 'Loan Summary',
    // Both: the widget shows application counts and loan counts side by side,
    // and a caller holding only one of the two would see the other's figures.
    permissions: ['loans.view', 'loans.applications.view'],
    scopeType: 'AS_OF_NOW',
    source: 'Loan Applications & Loans',
    // `/loans` is not a route — the loan book is reached through applications.
    drillDownHref: '/loans/applications',
    periodNote: 'Current position — not affected by the selected period.',
  },
  {
    code: 'COLLECTION_SUMMARY',
    title: 'Collection Summary',
    permissions: ['collections.view'],
    scopeType: 'RANGE_BOUNDED',
    source: 'EMI Collection',
    periodNote: 'Posted collections within the selected period.',
    drillDownHref: '/loans/collections',
  },
  {
    code: 'OVERDUE_RECOVERY',
    title: 'Overdue & Recovery',
    permissions: ['overdue.view'],
    scopeType: 'AS_OF_NOW',
    source: 'Overdue & Recovery',
    drillDownHref: '/overdues',
    periodNote: 'Overdue as at today — not affected by the selected period.',
  },
  {
    code: 'CASH_SUMMARY',
    title: 'Cash Position',
    permissions: ['cash.reconciliation.view'],
    // The business date, not the selected period. Cash is counted and handed
    // over per day; a range would sum custody positions that never coexisted.
    scopeType: 'AS_OF_NOW',
    source: 'Field Collection & Cash Reconciliation',
    drillDownHref: '/field/cash-reconciliation',
    periodNote: "Today's business date — not affected by the selected period.",
  },
  {
    code: 'OPERATIONAL_ALERTS',
    title: 'Operational Alerts',
    permissions: [],
    scopeType: 'AS_OF_NOW',
    source: 'Multiple modules',
    drillDownHref: '/overdues',
    periodNote: 'Outstanding now — not affected by the selected period.',
  },
  {
    code: 'QUICK_ACTIONS',
    title: 'Quick Actions',
    permissions: [],
    scopeType: 'AS_OF_NOW',
    source: 'Navigation only',
    drillDownHref: '/',
    periodNote: 'Navigation only.',
  },
  {
    code: 'RECENT_ACTIVITY',
    title: 'Recent Activity',
    permissions: ['audit.view'],
    scopeType: 'RANGE_BOUNDED',
    source: 'Settings, Audit & Maintenance',
    drillDownHref: '/admin/audit',
    periodNote: 'Audited activity within the selected period.',
  },
];

/**
 * One alert, and what it takes to see it.
 *
 * Each alert names its own permission because they come from six different
 * modules. A branch manager who may see overdue EMIs but not maintenance jobs
 * gets the first row and not the second, in the same panel.
 */
export interface AlertSpec {
  alertType: string;
  permission: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  label: string;
  href: string;
}

/**
 * The operational alerts, in the order they are shown.
 *
 * Ordered by how soon someone must act, not by module: money due today comes
 * before a failed job, because the first has a deadline and the second has a
 * retry. Severity is the widget's own judgement about urgency and is
 * deliberately not read from the source — a source that had an opinion about
 * its own urgency would be describing the dashboard rather than itself.
 */
export const DASHBOARD_ALERTS: readonly AlertSpec[] = [
  {
    alertType: 'EMIS_DUE_TODAY',
    permission: 'loans.schedules.view',
    severity: 'INFO',
    label: 'EMIs due today',
    href: '/loans/collections',
  },
  {
    alertType: 'EMIS_OVERDUE',
    permission: 'overdue.view',
    severity: 'CRITICAL',
    label: 'Loans overdue',
    href: '/overdues',
  },
  {
    alertType: 'PENDING_APPROVALS',
    permission: 'loans.applications.view',
    severity: 'WARNING',
    label: 'Applications awaiting approval',
    href: '/loans/applications',
  },
  {
    alertType: 'COLLECTION_EXCEPTIONS',
    permission: 'collections.view',
    severity: 'WARNING',
    label: 'Collections needing attention',
    href: '/loans/collections',
  },
  {
    alertType: 'CASH_RECON_EXCEPTIONS',
    permission: 'cash.reconciliation.view',
    severity: 'CRITICAL',
    label: 'Cash reconciliations with an unresolved difference',
    href: '/field/cash-reconciliation',
  },
  {
    alertType: 'FIELD_ESCALATIONS',
    permission: 'recovery.cases.view',
    severity: 'WARNING',
    label: 'Recovery cases escalated to field',
    href: '/recovery-cases',
  },
  {
    alertType: 'FAILED_JOBS',
    permission: 'maintenance.jobs.view',
    severity: 'WARNING',
    label: 'Maintenance jobs needing recovery',
    href: '/admin/maintenance/jobs',
  },
];

/** Whether the actor holds every code a spec requires. */
export function holdsAll(
  actor: AuthContext,
  permissions: readonly string[],
): boolean {
  return permissions.every((code) => actor.permissions.includes(code));
}

export function findWidget(code: string): WidgetSpec | undefined {
  return DASHBOARD_WIDGETS.find((widget) => widget.code === code);
}

/**
 * The widgets this actor may see.
 *
 * Used to build the layout, and *not* trusted as the authorization: each widget
 * re-checks its own permissions when it is actually requested. This function
 * decides what to offer; the widget decides what to serve. A caller who guesses
 * a widget code the layout did not name gains nothing.
 */
export function visibleWidgets(actor: AuthContext): WidgetSpec[] {
  return DASHBOARD_WIDGETS.filter((widget) =>
    holdsAll(actor, widget.permissions),
  );
}

/** The alerts this actor may see. The rest are omitted, never zeroed. */
export function visibleAlerts(actor: AuthContext): AlertSpec[] {
  return DASHBOARD_ALERTS.filter((alert) =>
    actor.permissions.includes(alert.permission),
  );
}
