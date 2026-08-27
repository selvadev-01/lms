import type { AuthContext } from '../common/auth-context';

export interface QuickActionSpec {
  code: string;
  label: string;
  /**
   * The permission the *destination* requires. Empty means the destination is
   * open to every authenticated user.
   */
  permissions: readonly string[];
  href: string;
}

/**
 * The shortcuts offered on the home screen.
 *
 * # A quick action is a link, and nothing more
 *
 * Rule 25 is explicit: an action may navigate to or initiate an authorized
 * workflow, and must not bypass validation, approval, idempotency, branch
 * scoping or audit. The strongest way to honour that is to make bypassing
 * structurally impossible, so this list holds no behaviour — only a label and a
 * URL. The destination performs its own checks because it is the same screen
 * the user would have reached through the menu.
 *
 * That is also why Scenarios 16 and 30 need no code here. The Collect EMI
 * action cannot skip the payment workflow's `Idempotency-Key` requirement,
 * because it does not post a payment; it opens the form that does.
 *
 * # The permission is the destination's
 *
 * Each entry names what the *target screen* requires, so Rule 26 ("a quick
 * action must not be shown if the user lacks permission for the destination
 * action") is satisfied by construction rather than by a parallel list someone
 * has to keep in step. Hiding an action the user could not have used is a
 * courtesy; the destination refusing them is the security boundary, and it
 * holds whether or not the action was ever displayed (Scenario 10).
 *
 * # Fixed, not configurable
 *
 * // TODO(open-question): Question 29 — whether quick actions are fixed by role
 * // or configurable through settings is unresolved. They are fixed here.
 * // Making them configurable is a settings surface and a table; making them
 * // role-specific would mean a role could be granted an action whose
 * // destination it may not open, which is the contradiction Rule 26 forbids.
 * // Permission-derived is the reading that cannot produce that state.
 */
export const QUICK_ACTIONS: readonly QuickActionSpec[] = [
  {
    code: 'ADD_CUSTOMER',
    label: 'Add Customer',
    permissions: ['customers.create'],
    href: '/customers/new',
  },
  {
    code: 'NEW_LOAN_APPLICATION',
    label: 'New Loan Application',
    permissions: ['loans.applications.create'],
    href: '/loans/applications/new',
  },
  {
    code: 'REVIEW_APPROVALS',
    label: 'Review Approvals',
    permissions: ['loans.applications.review'],
    href: '/loans/applications',
  },
  {
    code: 'COLLECT_EMI',
    label: 'Collect EMI',
    permissions: ['collections.post'],
    href: '/loans/collections/new',
  },
  {
    code: 'OPEN_FIELD_COLLECTION',
    label: 'Open Field Collection',
    permissions: ['field.collections.view'],
    href: '/field/collections',
  },
  {
    code: 'VIEW_OVERDUES',
    label: 'View Overdues',
    permissions: ['overdue.view'],
    href: '/overdues',
  },
  {
    code: 'RUN_REPORT',
    label: 'Run Report',
    permissions: ['reports.dashboard.view'],
    href: '/reports/dashboard',
  },
  {
    // No permission: a notification is addressed to one user, and the centre
    // shows only their own. There is nothing here to withhold.
    code: 'OPEN_NOTIFICATIONS',
    label: 'Open Notifications',
    permissions: [],
    href: '/notifications',
  },
];

/** The actions whose destinations this actor may open. */
export function visibleQuickActions(actor: AuthContext): QuickActionSpec[] {
  return QUICK_ACTIONS.filter((action) =>
    action.permissions.every((code) => actor.permissions.includes(code)),
  );
}
