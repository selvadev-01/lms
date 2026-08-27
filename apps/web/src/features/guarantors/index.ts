/**
 * Guarantors (Module 05).
 *
 * Actions are deliberately absent from this barrel, following the Module 03 and
 * 04 precedent: this file re-exports `api/guarantors.ts`, which is
 * `server-only`, so a client component importing an action through here would
 * pull the read layer into the browser bundle and fail the build. Client
 * components import actions directly from `../actions/...`.
 */
export * from "./api/guarantors";

export { default as GuarantorDirectory } from "./components/GuarantorDirectory";
export { default as GuarantorDetail } from "./components/GuarantorDetail";
export { default as GuarantorKycPanel } from "./components/GuarantorKycPanel";
export {
  GuarantorKycStatusBadge,
  GuarantorStatusBadge,
} from "./components/GuarantorStatusBadge";
