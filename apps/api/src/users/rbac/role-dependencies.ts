import type { RoleDeleteBlocker } from '@lms/types';

/**
 * Everything that blocks a role's physical deletion (Module 03 Scenario 56).
 *
 * One entry, unlike the thirteen in `branch-dependencies.ts`, and the shortness
 * is the point rather than an oversight. Two things reference a role:
 *
 * - `user_roles`, which is what "the role is currently assigned" means. Deleting
 *   the role out from under its holders would silently strip their access, so
 *   this blocks.
 * - `role_permissions`, which cascades. Those rows are the role's own definition,
 *   not independent records that would be orphaned, so their disappearance with
 *   the role is correct and they are deliberately absent from this list.
 *
 * Kept as a list rather than a single inline `count()` so `role-dependencies.spec.ts`
 * can assert it stays complete as the schema grows, and so a fourteenth relation
 * added later is a one-line change here.
 */
export const ROLE_DEPENDENCIES = [
  { entity: 'userRole', label: 'Assigned users' },
] as const;

export type RoleDependency = (typeof ROLE_DEPENDENCIES)[number];

/** The Prisma delegate names this module counts against. */
export type RoleDependencyEntity = RoleDependency['entity'];

/**
 * Turns raw counts into the blockers worth reporting.
 *
 * Zero-count entries are dropped: a caller does not need to be told the role has
 * no holders, only what is actually standing in the way. An empty result is the
 * signal that deletion may proceed.
 */
export function summarizeRoleBlockers(
  counts: Record<string, number>,
): RoleDeleteBlocker[] {
  return ROLE_DEPENDENCIES.filter(
    (dependency) => (counts[dependency.entity] ?? 0) > 0,
  ).map((dependency) => ({
    entity: dependency.entity,
    label: dependency.label,
    count: counts[dependency.entity],
  }));
}

/**
 * Whether the role may be physically deleted.
 *
 * Answers only the data question. Whether the caller is *allowed* is the
 * controller's business, and whether the role is a system role is the service's.
 */
export function canDeleteRole(counts: Record<string, number>): boolean {
  return summarizeRoleBlockers(counts).length === 0;
}
