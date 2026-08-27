/**
 * Notifications (Module 16) — the feature's public surface.
 *
 * Exports the server-only reads and the components. **Actions are deliberately
 * excluded**, as in every other feature: this barrel is imported by server
 * components, and re-exporting a `"use server"` module from it would drag the
 * whole action surface into every page that renders a table.
 *
 * Client components import their actions directly from
 * `../actions/notification-actions`.
 */
export * from "./api/notifications";

export { default as NotificationList } from "./components/NotificationList";
export { default as NotificationDetail } from "./components/NotificationDetail";
export { default as PreferenceForm } from "./components/PreferenceForm";
export { default as NotificationRowActions } from "./components/NotificationRowActions";
export { default as RetryDeliveryForm } from "./components/RetryDeliveryForm";
export { DeliveryList, RuleList, TemplateList } from "./components/AdminLists";
export {
  DeliveryStatusBadge,
  EventTypeLabel,
  MandatoryBadge,
  NotificationChannelBadge,
  NotificationPriorityBadge,
  NotificationStatusBadge,
  TemplateStatusBadge,
} from "./components/NotificationBadges";
