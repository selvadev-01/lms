/**
 * Master data — the admin-maintained option lists behind dropdown fields.
 *
 * Actions are deliberately absent from this barrel, following the Module 04 and
 * 06/07 precedent: this file re-exports `api/master-data.ts`, which is
 * `server-only`, so a client component importing an action through here would
 * pull the read layer into the browser bundle and fail the build. Client
 * components import actions directly from `../actions/...`.
 */
export * from "./api/master-data";

export { default as MasterDataList } from "./components/MasterDataList";
export { default as CategoryTabs } from "./components/CategoryTabs";
export { CATEGORY_LABELS } from "./components/CategoryTabs";
