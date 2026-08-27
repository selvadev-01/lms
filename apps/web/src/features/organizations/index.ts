/**
 * Organizations & Branches — the feature's public surface.
 *
 * Note for Client Components: import an action from its own module
 * (`@/features/organizations/actions/...`) rather than from here. This barrel
 * also re-exports the `server-only` data layer, and pulling that into a client
 * bundle fails the build.
 */

export {
  fetchBranch,
  fetchBranches,
  fetchOrganization,
  type BranchListResult,
  type BranchResult,
  type OrganizationResult,
} from "./api/organizations";

export { default as BranchForm } from "./components/BranchForm";
export { default as BranchList } from "./components/BranchList";
export { default as CompanySettingsForm } from "./components/CompanySettingsForm";
