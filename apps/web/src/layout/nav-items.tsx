import React from "react";
import { PERMISSIONS } from "@lms/constants";
import {
  BellIcon,
  BoxCubeIcon,
  GridIcon,
  GroupIcon,
  PieChartIcon,
  TableIcon,
  UserCircleIcon,
} from "@lms/ui/icons";

/**
 * The navigation tree, separated from the component that renders it.
 *
 * It lives here rather than inside `AppSidebar` so it can be tested: a link
 * pointing at a route that does not exist is invisible in a render test of the
 * pages themselves, and the sidebar entry for Branch Settings shipped pointing
 * at a 404 for exactly that reason. `nav-items.test.ts` walks this tree and
 * resolves every path against the app directory.
 */

export type NavSubItem = {
  name: string;
  path: string;
  /**
   * Hide this entry unless the caller holds the permission. UX only: the route's
   * own guard is what actually refuses access, and the API refuses again beneath
   * that. Hiding a link the caller cannot follow keeps the menu honest, it is not
   * what makes it safe.
   */
  permission?: string;
  /**
   * Treat the entry as active on this prefix rather than on `path`.
   *
   * Only needed where the detail routes do not sit beneath the list route —
   * `/customers` already covers `/customers/{id}` without help. Set it where a
   * group's screens are spread across unrelated prefixes.
   */
  matchPrefix?: string;
  /**
   * Never prefix-match; this entry is active only on an exact pathname.
   *
   * For a destination that is a parent of unrelated screens, where matching the
   * subtree would light up the wrong entry.
   */
  exact?: boolean;
};

export type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  permission?: string;
  subItems?: NavSubItem[];
  matchPrefix?: string;
  exact?: boolean;
};

/**
 * A labelled band of groups in the sidebar.
 *
 * Four sections ordered by how often the work in them happens, configuration
 * last. `visibleSections` drops a section whose groups all filter away, so a
 * Field Employee sees Operations and Account and no headings for the rest.
 */
export type NavSection = {
  id: string;
  title: string;
  items: NavItem[];
};

const operations: NavItem[] = [
  {
    icon: <GridIcon />,
    name: "Dashboard",
    path: "/",
    // Exact, or the landing page is highlighted on every screen in the app.
    exact: true,
  },
  {
    name: "Customer Management",
    icon: <GroupIcon />,
    // Module 04's KYC and documents remain tabs on the customer profile: a
    // sidebar link to either would be a link to a customer nobody has chosen
    // yet.
    //
    // Guarantors are the exception, added by Module 05. GUA-001 is a directory
    // in its own right — searchable across the organization by guarantor name,
    // mobile or borrower — so it answers "who guaranteed anything for us"
    // without a customer having been chosen first. Adding and editing still
    // happen on the customer profile tab, where the relationship is defined.
    subItems: [
      {
        name: "Customers",
        path: "/customers",
        permission: PERMISSIONS.CUSTOMERS_VIEW,
      },
      {
        name: "Guarantors",
        path: "/guarantors",
        permission: PERMISSIONS.CUSTOMERS_GUARANTORS_VIEW,
      },
    ],
  },
  {
    name: "Loan Management",
    icon: <TableIcon />,
    // Applications first: it is the daily surface. Products and schemes are
    // configuration a Super Admin touches occasionally, and a Branch Admin only
    // reads — `visibleItems` drops whichever of the three a caller lacks, and
    // drops the whole group if that leaves nothing.
    subItems: [
      {
        name: "Loan Applications",
        path: "/loans/applications",
        permission: PERMISSIONS.LOANS_APPLICATIONS_VIEW,
      },
      {
        name: "Disbursement",
        path: "/loans/disbursements",
        permission: PERMISSIONS.LOANS_DISBURSEMENTS_VIEW,
      },
      // After Disbursement and before the configuration entries: collection is
      // the daily surface once a loan is live, and it follows disbursal in the
      // lifecycle.
      {
        name: "EMI Collection",
        path: "/loans/collections",
        permission: PERMISSIONS.COLLECTIONS_VIEW,
      },
      {
        name: "Loan Products",
        path: "/loans/products",
        permission: PERMISSIONS.LOANS_PRODUCTS_VIEW,
      },
      {
        name: "Loan Schemes",
        path: "/loans/schemes",
        permission: PERMISSIONS.LOANS_SCHEMES_VIEW,
      },
    ],
  },
  {
    name: "Overdue & Recovery",
    icon: <TableIcon />,
    // After Loan Management, matching the flow: a loan falls overdue, a case is
    // worked, and only a settlement or write-off reaches the ledger.
    //
    // Gated on the *view* permission of each surface rather than the acting
    // one, as Module 12's entries are: a Recovery Officer who can read the
    // worklist should see the menu even though assignment and closure are
    // withheld from them. The route guard and the API are the real boundary;
    // this is UX.
    subItems: [
      {
        name: "Overdue Accounts",
        path: "/overdues",
        permission: PERMISSIONS.OVERDUE_VIEW,
      },
      {
        name: "Recovery Cases",
        path: "/recovery-cases",
        permission: PERMISSIONS.RECOVERY_CASES_VIEW,
        // `/recovery-actions/{id}` is opened from a case and has no list route
        // of its own, so it belongs to this entry rather than going unhighlighted.
        matchPrefix: "/recovery-",
      },
    ],
  },
  {
    name: "Field Operations",
    icon: <BoxCubeIcon />,
    subItems: [
      // Gated on `field.checkin`, the permission the API's check-in controller
      // requires and which only Field Employees hold. Both routes now enforce
      // it themselves, so the menu and the guard agree: an admin is not offered
      // a link that would only bounce them back to the dashboard.
      {
        name: "GPS Check-in",
        path: "/field/check-in",
        permission: PERMISSIONS.FIELD_CHECKIN,
      },
      {
        name: "Field Dashboard",
        path: "/field",
        exact: true,
        permission: PERMISSIONS.FIELD_CHECKIN,
      },
      // `dashboardPathFor` sends a Branch Admin here on sign-in, so the menu
      // has to offer a way back to it. Gated on `dashboard.view` — the same
      // code the route now requires; see that page for why no branch-specific
      // permission is used.
      {
        name: "Branch Dashboard",
        path: "/branch",
        permission: PERMISSIONS.DASHBOARD_VIEW,
      },
      // Module 12, gated on the *view* permission of each surface rather than
      // the acting one — the same choice Master Data documents. A Branch Admin
      // who cannot reverse a handover still needs to see handovers, and hiding
      // the link would leave them unable to reach a screen they can legitimately
      // read. The route guard and the API are the real boundary; this is UX.
      {
        name: "Field Collections",
        path: "/field/collections",
        permission: PERMISSIONS.FIELD_COLLECTIONS_VIEW,
      },
      {
        name: "Cash Handover",
        path: "/field/cash-handovers",
        permission: PERMISSIONS.CASH_HANDOVERS_VIEW,
      },
      {
        // Deliberately not under Finance beside "/finance/reconciliation":
        // that one compares every source transaction in the organization
        // against the journal, while this counts one agent's physical cash at
        // one branch. Same word, different question, different permission.
        name: "Cash Reconciliation",
        path: "/field/cash-reconciliation",
        permission: PERMISSIONS.CASH_RECONCILIATION_VIEW,
      },
      {
        name: "Sync Queue",
        path: "/field/sync-queue",
        permission: PERMISSIONS.FIELD_COLLECTIONS_VIEW,
      },
      // `/field/offline` is deliberately absent: the check-in panel's own
      // network detection is what sends a user there, and a menu entry would
      // offer it to someone whose network is fine.
    ],
  },
];

const finance: NavItem[] = [
  {
    name: "Finance",
    icon: <PieChartIcon />,
    // After Loan Management, because accounting is downstream of it: every
    // entry in this group was caused by something in that one. Reading comes
    // before writing within the group — the ledger and its reports are the
    // daily surface, while authoring a journal by hand is the exception.
    //
    // `visibleItems` drops whichever entries a caller lacks and drops the whole
    // group if that leaves nothing, so a Field Employee sees no Finance menu at
    // all and a Branch Admin sees four of the five.
    subItems: [
      {
        name: "Chart of Accounts",
        path: "/finance/accounts",
        permission: PERMISSIONS.ACCOUNTING_ACCOUNTS_VIEW,
      },
      {
        name: "Journal Entries",
        path: "/finance/journals",
        permission: PERMISSIONS.ACCOUNTING_JOURNALS_VIEW,
      },
      {
        name: "General Ledger",
        path: "/finance/ledger",
        permission: PERMISSIONS.ACCOUNTING_LEDGER_VIEW,
      },
      {
        name: "Trial Balance",
        path: "/finance/trial-balance",
        permission: PERMISSIONS.ACCOUNTING_LEDGER_VIEW,
      },
      {
        name: "Reconciliation",
        path: "/finance/reconciliation",
        // A control function spanning every branch, so it is withheld from the
        // Branch Admin and this entry does not render for them.
        permission: PERMISSIONS.ACCOUNTING_LEDGER_RECONCILE,
      },
    ],
  },
  {
    name: "Reports",
    icon: <PieChartIcon />,
    // Last of the business groups, because a report is downstream of every
    // other one: each entry here summarises something another module owns.
    //
    // Every entry is gated on its own category's view permission rather than a
    // single `reports.view`, mirroring the API. That is what lets a Branch
    // Admin see seven of these nine and not the financial one — and
    // `visibleItems` drops the whole group for a Field Employee, who holds none
    // of them.
    subItems: [
      {
        // "Reporting KPIs", not "Dashboard": Module 18 put an operational
        // dashboard at `/`, and two menu entries both called Dashboard would
        // leave a user unable to tell which one they were about to open.
        name: "Reporting KPIs",
        path: "/reports/dashboard",
        permission: PERMISSIONS.REPORTS_DASHBOARD_VIEW,
      },
      {
        name: "Loan Portfolio",
        path: "/reports/portfolio",
        permission: PERMISSIONS.REPORTS_PORTFOLIO_VIEW,
      },
      {
        name: "Applications",
        path: "/reports/applications",
        permission: PERMISSIONS.REPORTS_APPLICATIONS_VIEW,
      },
      {
        name: "Disbursal",
        path: "/reports/disbursals",
        permission: PERMISSIONS.REPORTS_DISBURSALS_VIEW,
      },
      {
        name: "Repayment & Collections",
        path: "/reports/collections",
        permission: PERMISSIONS.REPORTS_COLLECTIONS_VIEW,
      },
      {
        name: "Field Collection",
        path: "/reports/field-collections",
        permission: PERMISSIONS.REPORTS_FIELD_VIEW,
      },
      {
        name: "Overdue & Recovery",
        path: "/reports/overdue-recovery",
        permission: PERMISSIONS.REPORTS_OVERDUE_VIEW,
      },
      {
        name: "Financial",
        path: "/reports/financial",
        // The organization's ledger rather than one branch's operations, so it
        // is withheld from the Branch Admin and this entry does not render for
        // them (Scenarios 28, 49).
        permission: PERMISSIONS.REPORTS_FINANCIAL_VIEW,
      },
      {
        name: "Saved Reports",
        path: "/reports/saved",
        permission: PERMISSIONS.REPORTS_SAVED_VIEW,
      },
    ],
  },
];

const administration: NavItem[] = [
  {
    name: "User & Access Management",
    icon: <UserCircleIcon />,
    // Module 03. Gated because the difference matters here in a way it does not
    // elsewhere: a Field Employee must not be shown "Roles & Permissions" at
    // all, and a Branch Admin holding `employees.view` but not `users.view`
    // should see Employee Management without Admin Management.
    subItems: [
      {
        name: "Admin Management",
        path: "/users",
        permission: PERMISSIONS.USERS_VIEW,
      },
      {
        name: "Employee Management",
        path: "/employees",
        permission: PERMISSIONS.EMPLOYEES_VIEW,
      },
      {
        name: "Roles & Permissions",
        path: "/roles",
        permission: PERMISSIONS.ROLES_VIEW,
      },
    ],
  },
  {
    name: "Company Settings",
    icon: <GridIcon />,
    // A Branch Admin following "Branch Management" reaches a real screen
    // confined to their own branch; one following "Add Branch" would be
    // redirected by the route guard, which is why that link is not offered here.
    subItems: [
      {
        name: "Organization",
        path: "/company-settings",
        permission: PERMISSIONS.ORGANIZATIONS_VIEW,
      },
      {
        name: "Branch Management",
        path: "/branches",
        permission: PERMISSIONS.BRANCHES_VIEW,
      },
      {
        // Gated on view, not manage: a Branch Admin reaches a real read-only
        // screen here, so offering the link leads somewhere useful rather than
        // into a refusal.
        name: "Master Data",
        path: "/settings/master-data",
        permission: PERMISSIONS.MASTER_DATA_VIEW,
      },
      // Module 17. Every entry is gated on its `*.view` code, never on a write
      // permission — a Branch Admin reaches each of these screens and is refused
      // at the specific act. That is what makes the scope and authority denials
      // observable rather than a link that simply is not there.
      {
        // "Organization Settings", not "Settings": this group already holds an
        // "Organization" entry (Module 02's org profile), and a bare "Settings"
        // beside it gives no clue which of the two a reader wants.
        name: "Organization Settings",
        path: "/admin/settings/organization",
        permission: PERMISSIONS.SETTINGS_VIEW,
      },
      {
        name: "Branch Settings",
        path: "/admin/settings/branch",
        permission: PERMISSIONS.SETTINGS_VIEW,
      },
      {
        name: "Configuration Changes",
        path: "/admin/settings/changes",
        permission: PERMISSIONS.SETTINGS_CHANGES_VIEW,
      },
      {
        name: "Operational Controls",
        path: "/admin/settings/operational",
        permission: PERMISSIONS.MAINTENANCE_JOBS_VIEW,
      },
      {
        name: "Maintenance Jobs",
        path: "/admin/maintenance/jobs",
        permission: PERMISSIONS.MAINTENANCE_JOBS_VIEW,
      },
      {
        name: "Configuration Transfer",
        path: "/admin/settings/transfer",
        permission: PERMISSIONS.SETTINGS_EXPORT,
      },
      {
        name: "Data Retention",
        path: "/admin/settings/retention",
        permission: PERMISSIONS.RETENTION_POLICIES_VIEW,
      },
      {
        name: "Audit Trail",
        path: "/admin/audit",
        permission: PERMISSIONS.AUDIT_VIEW,
      },
    ],
  },
];

const account: NavItem[] = [
  {
    name: "Notifications",
    icon: <BellIcon />,
    // The first two entries carry NO permission, and that is deliberate rather
    // than an omission. Rule 53 gives every user the notifications addressed to
    // them and Rule 47 makes some of them mandatory, so gating the menu would
    // hide the screen where an unpermissioned user reads an alert they are not
    // allowed to miss. The route guards on authentication alone for the same
    // reason.
    //
    // There is no "Unread" entry. It pointed at `/notifications?readStatus=UNREAD`,
    // which `usePathname()` can never match — it excludes the query string — so
    // the entry was permanently unhighlighted while stealing a menu row. A read
    // filter is a control on the notifications screen, not a destination.
    //
    // The three administrative entries are gated on the *view* permission of
    // each surface rather than the acting one, as every other group here is: a
    // Branch Admin sees Templates and is refused Save, which is what makes
    // Scenario 43 provable through the UI.
    subItems: [
      {
        name: "All Notifications",
        path: "/notifications",
        // Exact: `/notifications/preferences` is its own entry below, and the
        // subtree match would light both.
        exact: true,
      },
      { name: "Preferences", path: "/notifications/preferences" },
      {
        name: "Templates",
        path: "/admin/notifications/templates",
        permission: PERMISSIONS.NOTIFICATIONS_TEMPLATES_VIEW,
      },
      {
        name: "Event Rules",
        path: "/admin/notifications/rules",
        permission: PERMISSIONS.NOTIFICATIONS_RULES_VIEW,
      },
      {
        name: "Delivery Monitoring",
        path: "/admin/notifications/deliveries",
        permission: PERMISSIONS.NOTIFICATIONS_DELIVERIES_VIEW,
      },
    ],
  },
  {
    icon: <UserCircleIcon />,
    name: "User Profile",
    // Sub-items only, no `path`: renderMenuItems branches on `subItems` first,
    // so a parent carrying both would have its link silently ignored.
    subItems: [
      { name: "My Profile", path: "/profile" },
      { name: "Change Password", path: "/change-password" },
      { name: "Active Sessions", path: "/active-sessions" },
    ],
  },
];

export const navSections: NavSection[] = [
  { id: "operations", title: "Operations", items: operations },
  { id: "finance", title: "Finance", items: finance },
  { id: "administration", title: "Administration", items: administration },
  { id: "account", title: "Account", items: account },
];

/**
 * Drops entries the caller cannot use, then any parent left with no children.
 *
 * An ungated entry stays visible, so every menu that predates Module 03 behaves
 * exactly as before rather than silently vanishing for want of a permission
 * nobody has assigned it.
 */
export function visibleItems(
  items: NavItem[],
  permissions: string[],
): NavItem[] {
  const held = new Set(permissions);
  const allowed = (permission?: string) => !permission || held.has(permission);

  return items
    .filter((nav) => allowed(nav.permission))
    .map((nav) =>
      nav.subItems
        ? {
            ...nav,
            subItems: nav.subItems.filter((s) => allowed(s.permission)),
          }
        : nav,
    )
    .filter((nav) => !nav.subItems || nav.subItems.length > 0);
}

/**
 * The same rule one level up: a section whose groups all filtered away has no
 * heading, rather than a heading with nothing beneath it.
 */
export function visibleSections(
  sections: NavSection[],
  permissions: string[],
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: visibleItems(section.items, permissions),
    }))
    .filter((section) => section.items.length > 0);
}

/** How much of `pathname` an entry claims, or 0 if it does not match at all. */
function matchLength(
  pathname: string,
  entry: { path?: string; matchPrefix?: string; exact?: boolean },
): number {
  if (!entry.path) return 0;
  if (entry.path === pathname) return entry.path.length;
  if (entry.exact) return 0;

  const base = entry.matchPrefix ?? entry.path;

  // The root would otherwise prefix-match every route in the app.
  if (base === "/") return 0;

  // `startsWith(base + "/")` and not a bare `startsWith`: `/loans/collections`
  // must not claim `/loans/collections-archive`.
  //
  // A `matchPrefix` ending in a non-separator (`/recovery-`) is matched as a
  // literal prefix, since there is no segment boundary to require.
  if (base.endsWith("-") || base.endsWith("/")) {
    return pathname.startsWith(base) ? base.length : 0;
  }

  return pathname.startsWith(`${base}/`) ? base.length : 0;
}

/**
 * Which single entry the current route belongs to.
 *
 * Resolved once across every visible entry rather than tested per entry,
 * because two entries can both match one pathname — `/notifications` and
 * `/notifications/preferences` would otherwise both light up. The longest claim
 * wins, so the most specific entry is the one highlighted.
 *
 * Returns the winning path, which the caller compares by identity.
 */
export function resolveActivePath(
  sections: NavSection[],
  pathname: string,
): string | null {
  let best: string | null = null;
  let bestLength = 0;

  for (const section of sections) {
    for (const item of section.items) {
      for (const entry of item.subItems ?? [item]) {
        const length = matchLength(pathname, entry);
        if (length > bestLength && entry.path) {
          best = entry.path;
          bestLength = length;
        }
      }
    }
  }

  return best;
}

/** A DOM id for a group's submenu, stable across permission-driven reorders. */
export function submenuId(sectionId: string, itemName: string): string {
  const slug = itemName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `nav-${sectionId}-${slug}`;
}
