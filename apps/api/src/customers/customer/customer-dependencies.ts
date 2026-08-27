import type { CustomerDeleteBlocker } from '@lms/types';

/**
 * Everything that blocks a customer's physical deletion (Module 04 Rule 23,
 * Scenario 37).
 *
 * The story is unusually direct about this one: "Destructive deletion of
 * customers with financial history must be blocked or replaced by the approved
 * non-destructive lifecycle." Rule 22 says the same thing from the other side —
 * historical loans, payments, receipts and audit records must survive whatever
 * happens to the customer profile. This table is where both are enforced.
 *
 * **Cascading children are deliberately absent.** `customer_addresses`,
 * `customer_documents`, `customer_kyc`, `customer_mobile_verifications` and
 * `guarantors` all declare `onDelete: Cascade`. They are the customer's own
 * record rather than financial history involving other parties, so disappearing
 * with the row is correct and they must not block a delete. Only the `Restrict`
 * relations appear below.
 *
 * That distinction is the whole design. A customer who was registered and never
 * transacted is a data-entry mistake and should be removable; a customer with a
 * single collection against a single loan is permanent, because deleting them
 * would orphan money that was actually received.
 *
 * `AccountDimension.customerId` is **not** here on purpose: it is a loose column
 * with no declared relation, so the database will not stop a delete on its
 * account and counting it would block deletes the schema itself permits.
 *
 * As in `user-dependencies.ts`, each entry names its own foreign-key column.
 * `Notification` references `recipientCustomerId`, not `customerId`, and a wrong
 * name here would not fail to compile — Prisma would throw at runtime, which
 * `AllExceptionsFilter` renders as an unrelated 503.
 */
export const CUSTOMER_DEPENDENCIES = [
  {
    entity: 'loan',
    field: 'customerId',
    label: 'Loans',
  },
  {
    entity: 'loanApplication',
    field: 'customerId',
    label: 'Loan applications',
  },
  {
    entity: 'collection',
    field: 'customerId',
    label: 'Collections',
  },
  {
    entity: 'fieldAssignmentCustomer',
    field: 'customerId',
    label: 'Field assignments',
  },
  {
    entity: 'fieldVisit',
    field: 'customerId',
    label: 'Field visits',
  },
  {
    entity: 'notification',
    field: 'recipientCustomerId',
    label: 'Notifications',
  },
] as const;

export type CustomerDependency = (typeof CUSTOMER_DEPENDENCIES)[number];

/** The Prisma delegate names this module counts against. */
export type CustomerDependencyEntity = CustomerDependency['entity'];

/**
 * Turns raw counts into the blockers worth reporting.
 *
 * Zero-count entries are dropped rather than returned as `count: 0`, so the
 * response lists what is actually in the way. An empty result means the delete
 * may proceed, which is what the caller checks.
 */
export function summarizeCustomerBlockers(
  counts: Record<string, number>,
): CustomerDeleteBlocker[] {
  return CUSTOMER_DEPENDENCIES.filter(
    (dependency) => (counts[dependency.entity] ?? 0) > 0,
  ).map((dependency) => ({
    entity: dependency.entity,
    label: dependency.label,
    count: counts[dependency.entity] ?? 0,
  }));
}
