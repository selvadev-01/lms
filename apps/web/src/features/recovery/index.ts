/**
 * Overdue & Recovery (Module 13) — the feature's public surface.
 *
 * Exports the server-only reads and the components. **Actions are deliberately
 * excluded**, as in every other feature: this barrel is imported by server
 * components, and re-exporting a `"use server"` module from it would drag the
 * whole action surface into every page that renders a table.
 *
 * Client components import their actions directly from
 * `../actions/recovery-actions`.
 */
export * from "./api/recovery";

export { default as OverdueList } from "./components/OverdueList";
export { default as OverdueDetail } from "./components/OverdueDetail";
export { default as RecoveryCaseList } from "./components/RecoveryCaseList";
export { default as RecoveryCaseDetail } from "./components/RecoveryCaseDetail";
export { default as RecordRecoveryActionForm } from "./components/RecordRecoveryActionForm";
export { default as AssignRecoveryCaseForm } from "./components/AssignRecoveryCaseForm";
export { default as EscalateRecoveryCaseForm } from "./components/EscalateRecoveryCaseForm";
export { default as CloseRecoveryCaseForm } from "./components/CloseRecoveryCaseForm";
export { default as ProposeSettlementForm } from "./components/ProposeSettlementForm";
export { default as SettlementDecisionForm } from "./components/SettlementDecisionForm";
export { default as IssueLegalNoticeForm } from "./components/IssueLegalNoticeForm";
export { default as WriteOffLoanForm } from "./components/WriteOffLoanForm";
export {
  DelinquencyBucketBadge,
  NpaStatusBadge,
  PromiseMissedBadge,
  RecoveryCaseStatusBadge,
  RecoveryPriorityBadge,
  SettlementStatusBadge,
} from "./components/RecoveryBadges";

export type { Capabilities as RecoveryCaseCapabilities } from "./components/RecoveryCaseDetail";
