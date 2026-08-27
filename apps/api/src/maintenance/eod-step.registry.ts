import type { PrismaService } from '../prisma/prisma.service';

/**
 * The steps an end-of-day run executes.
 *
 * # Module 17 owns the runner, not the work
 *
 * Every step registered here is READ-ONLY over authoritative data. None of them
 * posts a ledger entry, writes a collection, allocates a receipt number or
 * closes a day. That is not a temporary state of affairs pending "real" steps —
 * it is the design, and Rules 21 and 26 are why: posting logic belongs to the
 * module that owns the account mappings and the reversal workflow, and a
 * maintenance screen that could post would be a second, unaudited path into the
 * ledger.
 *
 * When a business module needs EOD work, it contributes a step whose `run` calls
 * that module's own service — so the posting still happens behind the owning
 * module's rules, and this file only decides when.
 *
 * `eod-step.registry.spec.ts` asserts no registered step touches the financial
 * tables. That test is what keeps this true after a refactor, because nothing
 * about the type signature prevents somebody writing an INSERT here.
 *
 * # Every step must be idempotent
 *
 * A retry re-runs any step that did not reach SUCCEEDED, so a step that
 * accumulates rather than recomputes would double its effect on the second
 * attempt (Scenarios 24, 25). The safe shape is recompute-from-source; the
 * unsafe shape is `count = count + n`.
 */

export interface EodStepContext {
  orgId: string;
  branchId: string | null;
  /** DATE-only, Asia/Kolkata (Rule 65). */
  businessDate: string;
  prisma: PrismaService;
}

export interface EodStepResult {
  processed: number;
  /** Anything the operator should see on the run detail screen. */
  summary?: string;
}

export interface EodStep {
  code: string;
  sequence: number;
  description: string;
  /**
   * A step that cannot be safely retried marks the run RECOVERY_REQUIRED on
   * failure instead of FAILED, so no automatic retry continues (Scenario 31).
   */
  retryable: boolean;
  run(context: EodStepContext): Promise<EodStepResult>;
}

/**
 * Count the loans still open on the business date.
 *
 * Read-only and recomputed from source every time, so running it twice produces
 * the same answer rather than twice the answer.
 */
const snapshotOpenLoans: EodStep = {
  code: 'EOD_SNAPSHOT_OPEN_LOANS',
  sequence: 10,
  description: 'Count loans still open at end of day.',
  retryable: true,
  async run({ orgId, branchId, prisma }) {
    const processed = await prisma.loan.count({
      where: {
        orgId,
        ...(branchId ? { branchId } : {}),
        status: { in: ['ACTIVE', 'OVERDUE'] },
      },
    });
    return { processed, summary: `${processed} open loan(s)` };
  },
};

/**
 * Count instalments overdue as of the business date.
 *
 * Overdue status is DERIVED in this system rather than stored (see Module 13),
 * so this step reports rather than updates. A step that wrote a computed status
 * back would create the second source of truth Module 13 deliberately avoided.
 */
const reviewOverdue: EodStep = {
  code: 'EOD_REVIEW_OVERDUE',
  sequence: 20,
  description: 'Report instalments past due as at the business date.',
  retryable: true,
  async run({ orgId, branchId, businessDate, prisma }) {
    const processed = await prisma.emi.count({
      where: {
        orgId,
        dueDate: { lt: new Date(`${businessDate}T00:00:00.000Z`) },
        // Every state that still owes money. PAID, WAIVED and CANCELLED are
        // settled; the rest are outstanding regardless of which label the
        // schedule currently carries.
        status: { in: ['PENDING', 'DUE', 'PARTIALLY_PAID', 'OVERDUE'] },
        ...(branchId ? { loan: { branchId } } : {}),
      },
    });
    return { processed, summary: `${processed} instalment(s) past due` };
  },
};

/**
 * Report whether each in-scope branch has closed its day.
 *
 * Reports, never writes. Creating the `DayClosing` row here would mean EOD could
 * mark a day closed that the branch never reconciled — the record is the
 * branch's assertion, not the scheduler's.
 */
const verifyDayClosing: EodStep = {
  code: 'EOD_VERIFY_DAY_CLOSING',
  sequence: 30,
  description:
    'Report branches with no day-closing record for the business date.',
  retryable: true,
  async run({ orgId, branchId, businessDate, prisma }) {
    const date = new Date(`${businessDate}T00:00:00.000Z`);

    const branches = await prisma.branch.findMany({
      where: { orgId, status: 'ACTIVE', ...(branchId ? { branchId } : {}) },
      select: { branchId: true },
    });

    const closed = await prisma.dayClosing.findMany({
      where: {
        orgId,
        closingDate: date,
        ...(branchId ? { branchId } : {}),
        status: 'CLOSED',
      },
      select: { branchId: true },
    });

    const closedIds = new Set(closed.map((row) => row.branchId));
    const missing = branches.filter((row) => !closedIds.has(row.branchId));

    return {
      processed: branches.length,
      summary:
        missing.length === 0
          ? 'All branches closed'
          : `${missing.length} branch(es) not closed`,
    };
  },
};

/** Ordered by `sequence` at execution time, not by array position. */
export const EOD_STEPS: readonly EodStep[] = [
  snapshotOpenLoans,
  reviewOverdue,
  verifyDayClosing,
];

export function eodStepsInOrder(): EodStep[] {
  return [...EOD_STEPS].sort((a, b) => a.sequence - b.sequence);
}
