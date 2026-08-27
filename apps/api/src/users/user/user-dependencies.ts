import type { UserDeleteBlocker } from '@lms/types';

/**
 * Everything that blocks a user's physical deletion (Module 03 Scenarios 54, 55).
 *
 * Two things make this list different from `branch-dependencies.ts`, and both
 * matter.
 *
 * **The foreign key is not always called `userId`.** Branch dependencies all
 * reference `branchId`, so that module gets away with one `where` shape for
 * every count. Users do not: a collection references `collectorUserId`, a field
 * assignment `fieldAgentId`, an audit row `actorUserId`. Each entry therefore
 * names its own column, and the service builds the `where` from it. A wrong name
 * here would not fail to compile — it would make Prisma throw at runtime, which
 * `AllExceptionsFilter` renders as an unrelated 503.
 *
 * **A model may reference a user through more than one column.** Module 12's
 * handover names an agent *and* a receiver, and both are real foreign keys, so
 * `field` accepts an array and the count becomes an OR across the columns.
 * Naming only one would let a user who appears solely in the other column pass
 * the blocker check and then fail on the raw constraint.
 *
 * **Cascading references are deliberately absent.** `user_roles`,
 * `user_sessions`, `password_recovery_requests`, `password_history` and
 * `gps_check_ins` all declare `onDelete: Cascade`. They are session, credential
 * and device state rather than business history, so disappearing with the row is
 * correct and they must not block. Only the `Restrict` relations appear below.
 *
 * `auditLog` is first because it is the one that matters most: `actorUserId`
 * references `users`, so any user who has ever done anything auditable —
 * including signing in once — is permanently undeletable. That is Rules 14 and
 * 43 working as intended rather than a limitation, and it means in practice
 * almost every real user is deactivate-only. The delete path exists for the
 * account that was provisioned and never used.
 */
export const USER_DEPENDENCIES = [
  { entity: 'auditLog', field: 'actorUserId', label: 'Audit records' },
  {
    // Module 12. The first entries to name more than one column.
    //
    // A user reaches a handover two ways — as the agent who handed cash over
    // and as the branch user who received it — and *both* are real foreign
    // keys. Counting only `fieldAgentId` would let a cashier who has received
    // handovers but never collected in the field pass the blocker check and
    // then fail on the raw constraint, which is the bare foreign-key error this
    // file's header exists to prevent.
    entity: 'cashHandover',
    field: ['fieldAgentId', 'receivedBy'],
    label: 'Cash handovers',
  },
  {
    entity: 'cashReconciliation',
    field: ['fieldAgentId', 'resolvedBy'],
    label: 'Cash reconciliations',
  },
  { entity: 'collection', field: 'collectorUserId', label: 'Collections' },
  {
    entity: 'fieldAssignment',
    field: 'fieldAgentId',
    label: 'Field assignments',
  },
  { entity: 'fieldVisit', field: 'fieldAgentId', label: 'Field visits' },
  {
    entity: 'offlineSyncItem',
    field: 'userId',
    label: 'Offline sync items',
  },
  {
    // Module 13. A user reaches a recovery case three ways — as its assignee,
    // its opener and its closer — and all three are real foreign keys. Counting
    // only `assignedAgentId` would let a supervisor who has closed cases but
    // never held one pass the blocker check and then fail on the raw
    // constraint, which is the bare foreign-key error this file's header exists
    // to prevent.
    entity: 'recoveryCase',
    field: ['assignedAgentId', 'createdBy', 'closedBy'],
    label: 'Recovery cases',
  },
  {
    // Both sides of a reassignment plus the person who made it. `fromUserId` is
    // NULL on a first assignment, which is why all three must be named: a user
    // who has only ever been reassigned *away from* appears in no other column.
    entity: 'recoveryCaseAssignment',
    field: ['fromUserId', 'toUserId', 'assignedBy'],
    label: 'Recovery assignments',
  },
  {
    entity: 'recoveryAction',
    field: 'performedBy',
    label: 'Recovery actions',
  },
  {
    entity: 'legalNotice',
    field: 'issuedBy',
    label: 'Legal notices',
  },
  {
    entity: 'settlement',
    field: ['approvedBy', 'createdBy'],
    label: 'Settlements',
  },
  { entity: 'notification', field: 'recipientUserId', label: 'Notifications' },
  { entity: 'reportRun', field: 'requestedBy', label: 'Report runs' },
  // Module 15. A user who owns a saved report definition cannot be deleted
  // while it exists — the owner column is what Scenario 39's visibility query
  // filters on, so an orphaned definition would be invisible to everyone and
  // deletable by no one.
  {
    entity: 'reportDefinition',
    field: 'ownerUserId',
    label: 'Saved reports',
  },
] as const;

export type UserDependency = (typeof USER_DEPENDENCIES)[number];

/** The Prisma delegate names this module counts against. */
export type UserDependencyEntity = UserDependency['entity'];

/**
 * Turns raw counts into the blockers worth reporting.
 *
 * Zero-count entries are dropped: a caller needs to know what is standing in the
 * way, not to be told the user has no report runs. An empty result is the signal
 * that deletion may proceed.
 */
export function summarizeUserBlockers(
  counts: Record<string, number>,
): UserDeleteBlocker[] {
  return USER_DEPENDENCIES.filter(
    (dependency) => (counts[dependency.entity] ?? 0) > 0,
  ).map((dependency) => ({
    entity: dependency.entity,
    label: dependency.label,
    count: counts[dependency.entity],
  }));
}

/**
 * Whether the user may be physically deleted.
 *
 * Answers only the data question. Whether the caller is allowed is the
 * controller's business, and whether deleting them would strip the organization
 * of its last administrator is the service's.
 */
export function canDeleteUser(counts: Record<string, number>): boolean {
  return summarizeUserBlockers(counts).length === 0;
}
