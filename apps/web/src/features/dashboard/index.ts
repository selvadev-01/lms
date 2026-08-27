/**
 * Module 18 — the operational home screen.
 *
 * The barrel re-exports the `server-only` `api/` module, so a client component
 * must not import from here. Nothing in this feature is a client component
 * today: the page and every widget render on the server, and the only
 * interactive control is a plain GET form.
 */

export {
  fetchDashboardLayout,
  fetchDashboardWidget,
  type DashboardFilters as DashboardFilterValues,
  type DashboardResult,
} from "./api/dashboard";

export { DashboardFilters } from "./components/DashboardFilters";
export {
  Metric,
  WidgetFetchError,
  WidgetShell,
} from "./components/WidgetShell";
export {
  CashSummaryBody,
  CollectionSummaryBody,
  LoanSummaryBody,
  OperationalAlertsBody,
  OverdueRecoveryBody,
  QuickActionsBody,
  RecentActivityBody,
} from "./components/WidgetBodies";
