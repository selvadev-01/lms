/**
 * Reports & Analytics feature barrel (Module 15).
 *
 * Exports the server-only reads and the components, as every other feature
 * does. There are no actions to exclude here: reports are read-only views of
 * other modules' authoritative data (Rules 5, 6, 17), and the module's only
 * writes — saved report definitions — are reached through the API directly
 * rather than through a form in this release.
 */

export * from "./api/reports";
export * from "./api/saved-reports";

export {
  default as ReportFilters,
  ReportMetaLine,
} from "./components/ReportFilters";
export { default as ReportTable, type Column } from "./components/ReportTable";
export { default as DashboardKpis } from "./components/DashboardKpis";
export { default as SavedReportList } from "./components/SavedReportList";
export {
  ApplicationReportTable,
  CollectionReportTable,
  DisbursalReportTable,
  FieldCollectionReportTable,
  FinancialReportTable,
  OverdueReportTable,
  PortfolioReportTable,
} from "./components/ReportTables";
