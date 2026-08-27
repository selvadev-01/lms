import type { BranchDeleteBlocker } from '@lms/types';

/**
 * Everything that references a branch, and therefore everything that can block
 * its deletion (Module 02 Scenarios 29, 30, 33, 54).
 *
 * This list is the single source of truth for the delete guard. It exists as a
 * plain array rather than as thirteen hand-written `count()` calls inside the
 * service so that adding a fourteenth branch-scoped model is a one-line change
 * here — and so that `branch-dependencies.spec.ts` can assert the list is
 * complete against the schema. A model missing from this list would not fail a
 * type check; it would silently let a branch be deleted out from under its
 * records, and Postgres would then refuse with a bare foreign-key error that
 * `AllExceptionsFilter` renders as an unrelated 503.
 *
 * `user` is first because it is the most common blocker and the easiest for an
 * administrator to act on; the rest run roughly in operational order.
 */
export const BRANCH_DEPENDENCIES = [
  { entity: 'user', label: 'Users' },
  { entity: 'customer', label: 'Customers' },
  { entity: 'lead', label: 'Leads' },
  { entity: 'loanApplication', label: 'Loan applications' },
  { entity: 'loan', label: 'Loans' },
  { entity: 'disbursement', label: 'Disbursements' },
  { entity: 'collection', label: 'Collections' },
  { entity: 'fieldAssignment', label: 'Field assignments' },
  { entity: 'recoveryCase', label: 'Recovery cases' },
  { entity: 'expense', label: 'Expenses' },
  { entity: 'dayClosing', label: 'Day closings' },
  { entity: 'cashBookEntry', label: 'Cash book entries' },
  { entity: 'gpsCheckIn', label: 'GPS check-ins' },
  // Module 12. A received handover has a posted custody journal behind it and
  // its own append-only trigger, so a branch that has ever taken cash from an
  // agent can never be deleted — for the same reason the journal entry below
  // cannot. Listing both here names the blocker instead of letting it surface
  // as the bare foreign-key error this file's header warns about.
  { entity: 'cashHandover', label: 'Cash handovers' },
  { entity: 'cashReconciliation', label: 'Cash reconciliations' },
  // Module 14. A journal entry is the least deletable record in the system —
  // the ledger is append-only and a posted entry cannot be removed at all — so
  // a branch that has ever posted one can never be deleted. Listing it here is
  // what turns that into a named blocker rather than the bare foreign-key
  // error this file's header warns about.
  { entity: 'journalEntry', label: 'Journal entries' },
  // Module 15. A saved report definition scoped to a branch is the mildest
  // blocker in this list — it holds no money and no history, and the right fix
  // is usually to delete or rescope the definition. It is named anyway, because
  // the alternative is the bare foreign-key error this file's header warns
  // about, which tells the user nothing about what to do next.
  { entity: 'reportDefinition', label: 'Saved reports' },
  // Module 16. Three branch-scoped notification records, in ascending order of
  // how permanent they are.
  //
  // A notification event rule is configuration and the mildest of the three:
  // rescoping or deactivating it clears the blocker. A notification and its
  // source event are the opposite — Rules 69 to 71 keep notification history
  // for audit and permit archival but never deletion, so a branch that has ever
  // had a notification raised for it cannot be physically deleted at all.
  //
  // That is a real constraint rather than an oversight, and naming it here is
  // what turns it into an explicable blocker rather than the bare foreign-key
  // error this file's header warns about. It also matches how the journal entry
  // above behaves, for the same underlying reason: some records are evidence.
  { entity: 'notificationEventRule', label: 'Notification rules' },
  { entity: 'notificationSourceEvent', label: 'Notification events' },
  { entity: 'notification', label: 'Notifications' },
  // Module 17. Five branch-scoped administration records, again in ascending
  // order of how permanent they are.
  //
  // A branch setting, its change requests and the branch business calendar are
  // configuration: deactivating or rescoping them clears the blocker, and that
  // is the documented remedy under Rules 35 and 36 (deactivate rather than
  // delete where deactivation is supported).
  //
  // Maintenance job runs are the opposite. They are operational evidence — the
  // record that an EOD ran, what it processed and how it failed — and Rule 60
  // requires a failed run to preserve enough information for authorized
  // investigation. A branch that has ever run one therefore cannot be
  // physically deleted, for the same reason as the journal entry above: some
  // records are evidence.
  //
  // Maintenance mode sits in between: it is current operational state, cleared
  // by disabling and removing the row.
  //
  // Audit logs are deliberately NOT in this list even though Module 17 adds
  // `audit_logs.branch_id`. That column has no foreign key to `branches` — it
  // is a denormalised scope tag, precisely so that audit evidence survives the
  // deletion of the branch it describes.
  { entity: 'setting', label: 'Branch settings' },
  { entity: 'settingChangeRequest', label: 'Configuration change requests' },
  { entity: 'businessCalendar', label: 'Business calendars' },
  { entity: 'maintenanceMode', label: 'Maintenance mode' },
  { entity: 'maintenanceJobRun', label: 'Maintenance job runs' },
] as const;

export type BranchDependency = (typeof BRANCH_DEPENDENCIES)[number];

/** The Prisma delegate names this module counts against. */
export type BranchDependencyEntity = BranchDependency['entity'];

/**
 * Turns raw counts into the blockers worth reporting.
 *
 * Zero-count entries are dropped: a caller does not need to be told that the
 * branch has no recovery cases, only what is actually standing in the way. An
 * empty result is the signal that deletion may proceed.
 */
export function summarizeBlockers(
  counts: Record<string, number>,
): BranchDeleteBlocker[] {
  return BRANCH_DEPENDENCIES.filter(
    (dependency) => (counts[dependency.entity] ?? 0) > 0,
  ).map((dependency) => ({
    entity: dependency.entity,
    label: dependency.label,
    count: counts[dependency.entity],
  }));
}

/**
 * Whether the branch may be physically deleted.
 *
 * Deliberately expressed as "nothing references it" rather than "the caller is
 * allowed": permission is the controller's question, and this file answers only
 * the data question.
 */
export function canDelete(counts: Record<string, number>): boolean {
  return summarizeBlockers(counts).length === 0;
}
