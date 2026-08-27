/**
 * Field operations — the feature's only public surface.
 *
 * Note for Client Components: import an action from its own module
 * (`@/features/field/actions/...`) rather than from here. This barrel also
 * re-exports the `server-only` data layer, and pulling that into a client
 * bundle fails the build — the same constraint the auth feature documents in
 * `UserDropdown.tsx`.
 */

export {
  fetchCheckInStatus,
  fetchCheckInHistory,
  type CheckInStatusResult,
  type CheckInHistoryResult,
} from "./api/check-in";

export { requireVerifiedCheckIn } from "./utils/guard";

export {
  submitCheckInAction,
  type CheckInState,
} from "./actions/submit-check-in.action";
export { reportCheckInFailureAction } from "./actions/report-check-in-failure.action";

export { GpsCheckInPanel } from "./components/GpsCheckInPanel";
export { OfflineModeNotice } from "./components/OfflineModeNotice";

export { useGeolocation } from "./hooks/use-geolocation";
export { useNetworkStatus } from "./hooks/use-network-status";

// --- Module 12: field collection and cash custody ---
//
// Reads and components only. The actions stay unexported for the reason the
// header gives: this barrel re-exports a `server-only` data layer, and a client
// component importing an action through it pulls that layer into the browser
// bundle and fails the build.

export {
  fetchFieldCollections,
  fetchFieldCollection,
  type FieldCollectionListResult,
  type FieldCollectionDetailResult,
} from "./api/field-collections";

export {
  fetchCashHandovers,
  fetchCashHandover,
  fetchCashHandoverReadiness,
  fetchAgentCashBalances,
  fetchCashReconciliations,
  fetchCashReconciliation,
  type CashHandoverListResult,
  type CashHandoverDetailResult,
  type CashHandoverReadinessResult,
  type AgentCashBalancesResult,
  type CashReconciliationListResult,
  type CashReconciliationDetailResult,
} from "./api/cash";

export { fetchSyncQueue, type SyncQueueListResult } from "./api/sync-queue";

export { default as FieldCollectionList } from "./components/FieldCollectionList";
export { default as FieldCollectionDetail } from "./components/FieldCollectionDetail";
export { default as CashHandoverList } from "./components/CashHandoverList";
export { default as CashHandoverDetail } from "./components/CashHandoverDetail";
export { default as CashHandoverForm } from "./components/CashHandoverForm";
export { default as AgentCashBalancePanel } from "./components/AgentCashBalancePanel";
export { default as CashReconciliationList } from "./components/CashReconciliationList";
export { default as CashReconciliationDetail } from "./components/CashReconciliationDetail";
export { default as ReconcileForm } from "./components/ReconcileForm";
export { default as SyncQueueList } from "./components/SyncQueueList";

export {
  HandoverStatusBadge,
  ReconciliationStatusBadge,
  DiscrepancyBadge,
  GpsEvidenceBadge,
  CustodyBadge,
} from "./components/CashBadges";

export type { Capabilities as FieldCollectionCapabilities } from "./components/FieldCollectionDetail";
export type { Capabilities as CashHandoverCapabilities } from "./components/CashHandoverDetail";
export type { Capabilities as CashReconciliationCapabilities } from "./components/CashReconciliationDetail";
