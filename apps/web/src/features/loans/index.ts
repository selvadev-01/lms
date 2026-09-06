/**
 * Loan Products, Schemes and Applications (Modules 06-07).
 *
 * Actions are deliberately absent from this barrel, following the Module 04
 * precedent: this file re-exports `api/loans.ts`, which is `server-only`, so a
 * client component importing an action through here would pull the read layer
 * into the browser bundle and fail the build. Client components import actions
 * directly from `../actions/...`.
 */
export * from "./api/loans";

export { default as LoanApplicationList } from "./components/LoanApplicationList";
export { default as ApplicationDetail } from "./components/ApplicationDetail";
export { default as ApplicationWizard } from "./components/ApplicationWizard";
export { default as CompletenessSummary } from "./components/CompletenessSummary";
export { default as EmiSchedulePanel } from "./components/EmiSchedulePanel";
export { default as LoanProductList } from "./components/LoanProductList";
export { default as LoanSchemeDetail } from "./components/LoanSchemeDetail";
export { default as LoanSchemeList } from "./components/LoanSchemeList";
export type { Capabilities } from "./components/ApplicationDetail";
export {
  ApplicationStatusBadge,
  ConfigStatusBadge,
  ApplicationDocumentStatusBadge,
  formatBps,
  formatDate,
  formatPaise,
} from "./components/LoanBadges";
