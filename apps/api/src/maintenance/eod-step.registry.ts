import type { SessionService } from '../auth/session.service';
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
  /**
   * Passed in rather than reached for through `prisma`, so a step that needs
   * session lifecycle work calls the service that owns the rules — the same
   * reason this module contributes steps instead of implementing business
   * logic itself.
   */
  sessions: SessionService;
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

/**
 * Delete dead session rows that are past the retention window.
 *
 * # The one step here that writes, and why that is consistent
 *
 * Every other step is read-only because the rule this module observes is that
 * *the ledger* belongs to the module that owns it — a maintenance screen must
 * not become a second, unaudited path into financial data. `user_sessions` is
 * not financial data, and this deletes nothing a person could otherwise act on:
 * only rows for sessions that are already over.
 *
 * # Why it belongs on the EOD run at all
 *
 * Rotation writes a session row on every refresh, so the table grows with
 * traffic and is read on every authenticated request. Nothing else in this
 * application runs on a schedule, and EOD is the schedule that exists.
 *
 * # Idempotent, as every step must be
 *
 * It deletes by an absolute cutoff rather than by a count, so a retry deletes
 * what is still eligible and finds nothing the second time — the
 * recompute-from-source shape, not `count = count + n`.
 *
 * Bounded per run: one pass of at most `PRUNE_LIMIT`, so a first run against a
 * long-grown table cannot hold a lock over the whole backlog. The remainder is
 * taken by tomorrow's run.
 */
const PRUNE_LIMIT = 5000;

const pruneDeadSessions: EodStep = {
  code: 'EOD_PRUNE_DEAD_SESSIONS',
  sequence: 40,
  description: 'Delete revoked and expired session rows past retention.',
  retryable: true,
  async run({ prisma, sessions }) {
    // Org-wide by construction: sessions are pruned by age, and a branch-scoped
    // run has no narrower claim to make about them. Running it once per branch
    // would simply find nothing left after the first.
    void prisma;
    const processed = await sessions.pruneDeadSessions(PRUNE_LIMIT);

    return {
      processed,
      summary:
        processed === PRUNE_LIMIT
          ? `${processed} session row(s) removed; more remain for the next run`
          : `${processed} session row(s) removed`,
    };
  },
};

/** Ordered by `sequence` at execution time, not by array position. */
export const EOD_STEPS: readonly EodStep[] = [
  snapshotOpenLoans,
  reviewOverdue,
  verifyDayClosing,
  pruneDeadSessions,
];

export function eodStepsInOrder(): EodStep[] {
  return [...EOD_STEPS].sort((a, b) => a.sequence - b.sequence);
}
