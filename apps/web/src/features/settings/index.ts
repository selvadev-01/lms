/**
 * Module 17 — settings, configuration governance and the business calendar.
 *
 * Actions are deliberately absent from this barrel, following the Module 04,
 * 06/07 and 16 precedent: this file re-exports `api/settings.ts`, which is
 * `server-only`, so a client component importing an action through here would
 * pull the read layer into the browser bundle and fail the build. Client
 * components import actions directly from `../actions/...`.
 */
export * from "./api/settings";

export { default as SettingsList } from "./components/SettingsList";
export { default as ChangeRequestList } from "./components/ChangeRequestList";
export { default as BranchScopePicker } from "./components/BranchScopePicker";
export { default as RetentionPolicyList } from "./components/RetentionPolicyList";
export { default as ConfigTransferPanel } from "./components/ConfigTransferPanel";
