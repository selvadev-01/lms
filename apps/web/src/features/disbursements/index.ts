/**
 * Disbursal feature barrel (Module 09).
 *
 * Exports the server-only reads and the components. Actions are deliberately
 * excluded, as in every other feature: this barrel is imported by server
 * components, and re-exporting a `"use server"` module from it would drag the
 * whole action surface into every page that renders a table.
 */

export * from "./api/disbursements";

export { default as DisbursementQueue } from "./components/DisbursementQueue";
export { default as DisbursementDetail } from "./components/DisbursementDetail";
export { default as ScheduleDisbursementForm } from "./components/ScheduleDisbursementForm";
export { default as LedgerPanel } from "./components/LedgerPanel";
export { default as RepaymentSchedulePanel } from "./components/RepaymentSchedulePanel";
export {
  DisbursementStatusBadge,
  paymentModeLabel,
} from "./components/DisbursementBadges";
export type { Capabilities } from "./components/DisbursementDetail";
