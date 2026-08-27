import type { GuarantorDeleteBlocker } from '@lms/types';

/**
 * Everything that blocks a guarantor's physical deletion (Module 05 Rules 33,
 * 34, 79; Scenarios 31-33, 55).
 *
 * The story's position is that deletion is permitted only where nothing
 * downstream refers to the guarantor, and that deactivation is the supported
 * path everywhere else. Rule 38 puts it from the other side: removing a
 * guarantor from the customer master must not silently remove them from a
 * historical loan.
 *
 * **`GuarantorDocument` is deliberately absent.** It declares `onDelete:
 * Cascade` because a guarantor's KYC documents are that guarantor's own record,
 * not history shared with another party — the same distinction
 * `customer-dependencies.ts` draws. Listing it here would block every delete on
 * the guarantor's own paperwork, which the schema itself is happy to remove.
 * Only `Restrict` relations belong below.
 *
 * There is exactly one entry today because `LoanGuarantor` is the only relation
 * that restricts. That is not an oversight: Module 07 adds loan applications,
 * and its guarantor link belongs here as a second row rather than as a second
 * mechanism somewhere else.
 *
 * As in `customer-dependencies.ts`, each entry names its own foreign-key column.
 * A wrong name here would not fail to compile — Prisma would throw at runtime,
 * which `AllExceptionsFilter` renders as an unrelated 503.
 */
export const GUARANTOR_DEPENDENCIES = [
  {
    entity: 'loanGuarantor',
    field: 'guarantorId',
    label: 'Loan guarantor relationships',
  },
] as const;

export type GuarantorDependency = (typeof GUARANTOR_DEPENDENCIES)[number];

/** The Prisma delegate names this module counts against. */
export type GuarantorDependencyEntity = GuarantorDependency['entity'];

/**
 * Turns raw counts into the blockers worth reporting.
 *
 * Zero-count entries are dropped rather than returned as `count: 0`, so the
 * response lists what is actually in the way. An empty result means the delete
 * may proceed, which is what the caller checks.
 */
export function summarizeGuarantorBlockers(
  counts: Record<string, number>,
): GuarantorDeleteBlocker[] {
  return GUARANTOR_DEPENDENCIES.filter(
    (dependency) => (counts[dependency.entity] ?? 0) > 0,
  ).map((dependency) => ({
    entity: dependency.entity,
    label: dependency.label,
    count: counts[dependency.entity] ?? 0,
  }));
}
