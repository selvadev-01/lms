/**
 * Customers & KYC (Module 04).
 *
 * Actions are deliberately absent from this barrel, following the Module 03
 * precedent: this file re-exports `api/customers.ts`, which is `server-only`, so
 * a client component importing an action through here would pull the read layer
 * into the browser bundle and fail the build. Client components import actions
 * directly from `../actions/...`.
 */
export * from "./api/customers";

export { default as CustomerList } from "./components/CustomerList";
export { default as CustomerForm } from "./components/CustomerForm";
export { default as CustomerProfile } from "./components/CustomerProfile";
export { default as KycPanel } from "./components/KycPanel";
export { default as GuarantorList } from "./components/GuarantorList";
export {
  ConsentStatusBadge,
  CustomerStatusBadge,
  CustomerTypeBadge,
  DocumentStatusBadge,
  KycStatusBadge,
} from "./components/CustomerStatusBadge";
