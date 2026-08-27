"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { PERMISSIONS } from "@lms/constants";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSidebar } from "../context/SidebarContext";
import {
  BellIcon,
  BoxCubeIcon,
  ChevronDownIcon,
  GridIcon,
  GroupIcon,
  HorizontaLDots,
  PageIcon,
  PieChartIcon,
  PlugInIcon,
  TableIcon,
  UserCircleIcon,
} from "@lms/ui/icons";

type NavSubItem = {
  name: string;
  path: string;
  /**
   * Hide this entry unless the caller holds the permission. UX only: the route's
   * own guard is what actually refuses access, and the API refuses again beneath
   * that. Hiding a link the caller cannot follow keeps the menu honest, it is not
   * what makes it safe.
   */
  permission?: string;
};

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  permission?: string;
  subItems?: NavSubItem[];
};
const navItems: NavItem[] = [
  {
    icon: <GridIcon />,
    name: "Dashboard",
    path: "/",
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
  {
    name: "Field Operations",
    icon: <BoxCubeIcon />,
    subItems: [
      // The first two predate sidebar permission gating and stay ungated: a
      // non-field user following them is redirected by the route's own guard.
      { name: "GPS Check-in", path: "/field/check-in" },
      { name: "Field Dashboard", path: "/field" },
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
    ],
  },
  {
    name: "Company Settings",
    icon: <GridIcon />,
    // Sub-items only, no `path`: renderMenuItems branches on subItems first, so
    // a parent carrying both would have its own link silently ignored.
    //
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
    // Between Loan Management and Finance, matching the flow: a loan falls
    // overdue, a case is worked, and only a settlement or write-off reaches the
    // ledger.
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
      },
    ],
  },
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
  {
    name: "Notifications",
    icon: <BellIcon />,
    // Last of the operational groups, because it is about every other one: a
    // notification is always *about* an application, a disbursal, a collection
    // or a case.
    //
    // The first two entries carry NO permission, and that is deliberate rather
    // than an omission. Rule 53 gives every user the notifications addressed to
    // them and Rule 47 makes some of them mandatory, so gating the menu would
    // hide the screen where an unpermissioned user reads an alert they are not
    // allowed to miss. The route guards on authentication alone for the same
    // reason.
    //
    // The three administrative entries are gated on the *view* permission of
    // each surface rather than the acting one, as every other group here is: a
    // Branch Admin sees Templates and is refused Save, which is what makes
    // Scenario 43 provable through the UI.
    subItems: [
      { name: "All Notifications", path: "/notifications" },
      { name: "Unread", path: "/notifications?readStatus=UNREAD" },
      {
        name: "Preferences",
        path: "/notifications/preferences",
      },
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
    name: "Tables",
    icon: <TableIcon />,
    subItems: [{ name: "Basic Tables", path: "/basic-tables" }],
  },
  {
    name: "Pages",
    icon: <PageIcon />,
    subItems: [
      { name: "Blank Page", path: "/blank" },
      { name: "404 Error", path: "/error-404" },
    ],
  },
];

const othersItems: NavItem[] = [
  {
    icon: <PieChartIcon />,
    name: "Charts",
    subItems: [
      { name: "Line Chart", path: "/line-chart" },
      { name: "Bar Chart", path: "/bar-chart" },
    ],
  },
  {
    icon: <PlugInIcon />,
    name: "Authentication",
    subItems: [
      { name: "Sign In", path: "/signin" },
      { name: "Sign Up", path: "/signup" },
    ],
  },
];

/**
 * Drops entries the caller cannot use, then any parent left with no children.
 *
 * An ungated entry stays visible, so every menu that predates Module 03 behaves
 * exactly as before rather than silently vanishing for want of a permission
 * nobody has assigned it.
 */
function visibleItems(items: NavItem[], permissions: string[]): NavItem[] {
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

export interface AppSidebarProps {
  /**
   * The caller's effective permissions, resolved server-side and passed down.
   *
   * A prop rather than a client-side auth context: the context would exist
   * solely for this component, and the layout above it already runs on the
   * server where the session is available.
   */
  permissions?: string[];
}

const AppSidebar: React.FC<AppSidebarProps> = ({ permissions = [] }) => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const pathname = usePathname();

  const mainItems = visibleItems(navItems, permissions);
  const otherItems = visibleItems(othersItems, permissions);

  const renderMenuItems = (items: NavItem[], menuType: "main" | "others") => (
    <ul className="flex flex-col gap-4">
      {items.map((nav, index) => (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index, menuType)}
              className={`menu-item group ${
                openSubmenu?.type === menuType && openSubmenu?.index === index
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } cursor-pointer ${
                !isExpanded && !isHovered
                  ? "lg:justify-center"
                  : "lg:justify-start"
              }`}
            >
              <span
                className={` ${
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }`}
              >
                {nav.icon}
              </span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <span className={`menu-item-text`}>{nav.name}</span>
              )}
              {(isExpanded || isHovered || isMobileOpen) && (
                <ChevronDownIcon
                  className={`ml-auto h-5 w-5 transition-transform duration-200 ${
                    openSubmenu?.type === menuType &&
                    openSubmenu?.index === index
                      ? "text-brand-500 rotate-180"
                      : ""
                  }`}
                />
              )}
            </button>
          ) : (
            nav.path && (
              <Link
                href={nav.path}
                className={`menu-item group ${
                  isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                }`}
              >
                <span
                  className={`${
                    isActive(nav.path)
                      ? "menu-item-icon-active"
                      : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                </span>
                {(isExpanded || isHovered || isMobileOpen) && (
                  <span className={`menu-item-text`}>{nav.name}</span>
                )}
              </Link>
            )
          )}
          {nav.subItems && (isExpanded || isHovered || isMobileOpen) && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-all duration-300"
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
              }}
            >
              <ul className="mt-2 ml-9 space-y-1">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      href={subItem.path}
                      className={`menu-dropdown-item ${
                        isActive(subItem.path)
                          ? "menu-dropdown-item-active"
                          : "menu-dropdown-item-inactive"
                      }`}
                    >
                      {subItem.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  type Submenu = { type: "main" | "others"; index: number };

  // The user's manual toggle, which overrides the route-derived default until
  // the route changes again. `undefined` means "follow the route".
  const [submenuOverride, setSubmenuOverride] = useState<{
    pathname: string;
    value: Submenu | null;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {},
  );
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const isActive = useCallback((path: string) => path === pathname, [pathname]);

  // Which submenu contains the current route. Derived, not stored â€” keeping it
  // in state would mean a second render on every navigation. Cheap enough to
  // recompute; the React Compiler memoizes it automatically.
  //
  // Searched over the *filtered* lists, not the raw ones: the index is the
  // submenu's identity, and renderMenuItems walks the filtered array. Indexing
  // into the unfiltered list would open the wrong menu for any caller whose
  // permissions hid an earlier entry.
  const findRouteSubmenu = (): Submenu | null => {
    const mainIndex = mainItems.findIndex((nav) =>
      nav.subItems?.some((subItem) => subItem.path === pathname),
    );
    if (mainIndex !== -1) return { type: "main", index: mainIndex };

    const othersIndex = otherItems.findIndex((nav) =>
      nav.subItems?.some((subItem) => subItem.path === pathname),
    );
    if (othersIndex !== -1) return { type: "others", index: othersIndex };

    return null;
  };
  const routeSubmenu = findRouteSubmenu();

  const openSubmenu =
    submenuOverride?.pathname === pathname
      ? submenuOverride.value
      : routeSubmenu;

  // Depended on as a primitive, not as `openSubmenu` itself: findRouteSubmenu
  // builds a fresh object on every render, so an object dependency never
  // compares equal and the effect below would re-run and setState forever
  // ("Maximum update depth exceeded"). The key is the only part the effect
  // actually reads.
  const openSubmenuKey =
    openSubmenu === null ? null : `${openSubmenu.type}-${openSubmenu.index}`;

  useEffect(() => {
    // Set the height of the submenu items when the submenu is opened
    if (openSubmenuKey !== null && subMenuRefs.current[openSubmenuKey]) {
      setSubMenuHeight((prevHeights) => ({
        ...prevHeights,
        [openSubmenuKey]:
          subMenuRefs.current[openSubmenuKey]?.scrollHeight || 0,
      }));
    }
  }, [openSubmenuKey]);

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    const isOpen =
      openSubmenu?.type === menuType && openSubmenu?.index === index;
    setSubmenuOverride({
      pathname,
      value: isOpen ? null : { type: menuType, index },
    });
  };

  return (
    <aside
      className={`fixed top-0 left-0 z-50 mt-16 flex h-screen flex-col border-r border-gray-200 bg-white px-5 text-gray-900 transition-all duration-300 ease-in-out lg:mt-0 dark:border-gray-800 dark:bg-gray-900 ${
        isExpanded || isMobileOpen
          ? "w-[290px]"
          : isHovered
            ? "w-[290px]"
            : "w-[90px]"
      } ${isMobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`flex py-8 ${
          !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
        }`}
      >
        <Link href="/">
          {isExpanded || isHovered || isMobileOpen ? (
            <>
              <Image
                className="dark:hidden"
                src="/images/logo/logo.svg"
                alt="Logo"
                width={150}
                height={40}
              />
              <Image
                className="hidden dark:block"
                src="/images/logo/logo-dark.svg"
                alt="Logo"
                width={150}
                height={40}
              />
            </>
          ) : (
            <Image
              src="/images/logo/logo-icon.svg"
              alt="Logo"
              width={32}
              height={32}
            />
          )}
        </Link>
      </div>
      <div className="no-scrollbar flex flex-col overflow-y-auto duration-300 ease-linear">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2
                className={`mb-4 flex text-xs leading-[20px] text-gray-400 uppercase ${
                  !isExpanded && !isHovered
                    ? "lg:justify-center"
                    : "justify-start"
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? (
                  "Menu"
                ) : (
                  <HorizontaLDots />
                )}
              </h2>
              {renderMenuItems(mainItems, "main")}
            </div>

            <div className="">
              <h2
                className={`mb-4 flex text-xs leading-[20px] text-gray-400 uppercase ${
                  !isExpanded && !isHovered
                    ? "lg:justify-center"
                    : "justify-start"
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? (
                  "Others"
                ) : (
                  <HorizontaLDots />
                )}
              </h2>
              {renderMenuItems(otherItems, "others")}
            </div>
          </div>
        </nav>
      </div>
    </aside>
  );
};

export default AppSidebar;
