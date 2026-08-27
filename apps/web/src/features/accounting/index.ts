/**
 * Accounting & Ledger feature barrel (Module 14).
 *
 * Exports the server-only reads and the components. Actions are deliberately
 * excluded, as in every other feature: this file re-exports `api/*`, which is
 * `server-only`, so a client component importing an action through here would
 * pull the read layer into the browser bundle and fail the build. Client
 * components import actions directly from `../actions/...`.
 */

export * from "./api/accounts";
export * from "./api/journals";
export * from "./api/ledger";

export { default as AccountList } from "./components/AccountList";
export { default as AccountForm } from "./components/AccountForm";
export { default as AccountDetailPanel } from "./components/AccountDetailPanel";
export { default as AccountDangerZone } from "./components/AccountDangerZone";
export { default as JournalList } from "./components/JournalList";
export { default as JournalForm } from "./components/JournalForm";
export { default as JournalLineBuilder } from "./components/JournalLineBuilder";
export { default as JournalDetailPanel } from "./components/JournalDetailPanel";
export { default as JournalActions } from "./components/JournalActions";
export { default as GeneralLedgerTable } from "./components/GeneralLedgerTable";
export { default as TrialBalanceTable } from "./components/TrialBalanceTable";
export { default as ReconciliationReportPanel } from "./components/ReconciliationReportPanel";
export {
  AccountStatusBadge,
  BalanceBadge,
  ControlAccountBadge,
  JournalStatusBadge,
  accountTypeLabel,
  entryTypeLabel,
  normalBalanceLabel,
} from "./components/AccountingBadges";
export type { Capabilities } from "./components/JournalActions";
