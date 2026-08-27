/**
 * EMI collection feature barrel (Module 11).
 *
 * Exports the server-only reads and the components. Actions are deliberately
 * excluded, as in every other feature: this barrel is imported by server
 * components, and re-exporting a `"use server"` module from it would drag the
 * whole action surface into every page that renders a table.
 */

export * from "./api/collections";

export { default as CollectionList } from "./components/CollectionList";
export { default as CollectionDetail } from "./components/CollectionDetail";
export { default as CollectForm } from "./components/CollectForm";
export { default as AllocationSummary } from "./components/AllocationSummary";
export { default as ReverseCollectionForm } from "./components/ReverseCollectionForm";
export {
  CollectionStatusBadge,
  OfflineBadge,
  paymentModeLabel,
} from "./components/CollectionBadges";
export type { Capabilities } from "./components/CollectionDetail";
