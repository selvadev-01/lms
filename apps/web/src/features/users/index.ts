/**
 * Users, Employees, Roles & Permissions.
 *
 * Re-exports the server-only data layer and the client components. Actions are
 * deliberately absent, as in `features/organizations/index.ts`: this barrel
 * re-exports `server-only` modules, so a client component importing an action
 * through it would drag the whole read layer into the browser bundle and fail.
 * Client components import actions from `../actions/...` directly.
 */

export * from "./api/users";
export * from "./api/roles";

export { default as UserList } from "./components/UserList";
export { default as UserForm } from "./components/UserForm";
export { default as UserRoleAssignment } from "./components/UserRoleAssignment";
export { default as EmployeeAssignmentForm } from "./components/EmployeeAssignmentForm";
export { default as RoleList } from "./components/RoleList";
export { default as RoleForm } from "./components/RoleForm";
export { default as PermissionEditor } from "./components/PermissionEditor";
export { AccountStatusBadge, RoleStatusBadge } from "./components/StatusBadge";
