/**
 * Load-bearing properties of the recovery case lifecycle.
 *
 * Each is something a plausible refactor breaks silently:
 *
 *  1. **Every assignment writes a history row.** Rule 25 and Scenarios 10 and
 *     54 all turn on the previous assignee surviving a reassignment, which the
 *     denormalised `assignedAgentId` alone cannot do. A refactor that "simplifies"
 *     the assignment to a single column update fails here.
 *  2. **An inactive officer is refused** (Scenario 11), and the check runs
 *     inside the transaction so a deactivation racing an assignment cannot slip
 *     through.
 *  3. **`expectedVersion` is enforced twice**: the pre-check for a readable
 *     message and the guarded `updateMany` that is the real guarantee. Deleting
 *     the guard leaves a passing pre-check and a lost update (Scenarios 12, 52).
 *  4. **Every closure column is written in one statement**, because
 *     `recovery_cases_closure_complete` is evaluated per statement — a
 *     status-then-fill-in ordering fails the constraint even inside a
 *     transaction. This has bitten this codebase before.
 *  5. **Closure is blocked while obligations remain** (Scenario 40).
 *  6. **A second open case per loan is refused**, so two officers are never
 *     accountable for one debt.
 *  7. **An officer without assignment authority is confined to their own
 *     cases**, server-side. The permission grants the action, never the reach.
 *  8. **The idempotency replay check runs before the eligibility gates**, so a
 *     retry of a request that already succeeded returns the original even if
 *     the loan has since become ineligible.
 */

import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditAction, type AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoanService } from '../../loans/shared/loan.service';
import type { OverdueService } from '../overdue/overdue.service';
import { RecoveryCaseService } from './recovery-case.service';
import {
  notificationEventsStub,
  type NotificationEventsStub,
} from '../../notifications/testing/notification-events.stub';

const ORG = '11111111-1111-1111-1111-111111111111';
const BRANCH = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
const OFFICER_A = '44444444-4444-4444-4444-444444444444';
const OFFICER_B = '55555555-5555-5555-5555-555555555555';
const LOAN = '66666666-6666-6666-6666-666666666666';
const CASE = '77777777-7777-7777-7777-777777777777';
const KEY = '88888888-8888-4888-8888-888888888888';

const VERSION = new Date('2026-08-24T10:00:00.000Z');

const META: RequestMeta = {
  requestId: 'req-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER,
    orgId: ORG,
    orgCode: 'DEMO',
    sessionId: 'session-1',
    branchId: BRANCH,
    roles: ['BRANCH_ADMIN'],
    permissions: [
      'recovery.cases.view',
      'recovery.cases.create',
      'recovery.cases.assign',
      'recovery.cases.escalate',
      'recovery.cases.close',
    ],
    ...overrides,
  };
}

function caseRow(overrides: Record<string, unknown> = {}) {
  return {
    recoveryCaseId: CASE,
    caseNumber: 'RC-BR001-000001',
    loanId: LOAN,
    branchId: BRANCH,
    status: 'OPEN',
    priority: 'MEDIUM',
    npaStatus: 'SPECIAL_MENTION',
    openedDate: new Date('2026-08-01T00:00:00Z'),
    closedDate: null,
    assignedAgentId: null,
    assignmentDate: null,
    createdBy: USER,
    closedBy: null,
    closureReason: null,
    resolutionType: null,
    outstandingBeforePaise: null,
    recoveredAmountPaise: null,
    remainingOutstandingPaise: null,
    approvalReference: null,
    escalatedAt: null,
    escalationReason: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: VERSION,
    loan: {
      loanNumber: 'LN-000001',
      customerId: 'cust-1',
      status: 'OVERDUE',
      customer: { fullName: 'Asha Rao' },
    },
    branch: { name: 'Main', code: 'BR001' },
    assignedAgent: null,
    closedByUser: null,
    assignments: [] as unknown[],
    actions: [] as unknown[],
    legalNotices: [] as unknown[],
    settlements: [] as unknown[],
    ...overrides,
  };
}

const OVERDUE_POSITION = {
  totalOverduePaise: '250000',
  daysPastDue: 42,
  bucket: 'DPD_31_60' as const,
};

type Harness = {
  service: RecoveryCaseService;
  /** Module 16 — what the service raised after each committed transaction. */
  events: NotificationEventsStub;
  assignmentsCreated: Record<string, unknown>[];
  caseUpdates: Record<string, unknown>[];
  casesCreated: Record<string, unknown>[];
  audited: string[];
  guardCount: { value: number };
  caseFindFirst: jest.Mock;
  userFindFirst: jest.Mock;
};

function harness(
  options: {
    existing?: Record<string, unknown> | null;
    replay?: Record<string, unknown> | null;
  } = {},
): Harness {
  const assignmentsCreated: Record<string, unknown>[] = [];
  const caseUpdates: Record<string, unknown>[] = [];
  const casesCreated: Record<string, unknown>[] = [];
  const audited: string[] = [];
  const guardCount = { value: 1 };

  const caseFindFirst = jest
    .fn()
    .mockResolvedValue(
      options.existing === undefined ? caseRow() : options.existing,
    );

  const userFindFirst = jest
    .fn()
    .mockResolvedValue({ status: 'ACTIVE', name: 'Officer B' });

  const tx = {
    recoveryCase: {
      findFirst: caseFindFirst,
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          casesCreated.push(data);
          return Promise.resolve(data);
        }),
      updateMany: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          caseUpdates.push(data);
          return Promise.resolve({ count: guardCount.value });
        }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    recoveryCaseAssignment: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          assignmentsCreated.push(data);
          return Promise.resolve(data);
        }),
    },
    recoveryAction: { create: jest.fn().mockResolvedValue({}) },
    user: { findFirst: userFindFirst },
    loan: {
      findFirst: jest.fn().mockResolvedValue({
        loanId: LOAN,
        loanNumber: 'LN-000001',
        branchId: BRANCH,
        customerId: 'cust-1',
        status: 'OVERDUE',
        customer: { fullName: 'Asha Rao' },
        branch: { name: 'Main', code: 'BR001' },
        repaymentSchedules: [],
        penalties: [],
        recoveryCases: [],
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  } as unknown as PrismaService;

  const audit = {
    record: jest.fn((input: { action: string }) => {
      audited.push(input.action);
      return Promise.resolve();
    }),
  } as unknown as AuditService;

  const loans = {
    findInScope: jest.fn().mockResolvedValue({ loanId: LOAN }),
  } as unknown as LoanService;

  const overdue = {
    deriveSummary: jest.fn().mockReturnValue({
      ...OVERDUE_POSITION,
      npaEligibility: 'SPECIAL_MENTION',
    }),
    detail: jest.fn().mockResolvedValue({
      ...OVERDUE_POSITION,
      npaEligibility: 'SPECIAL_MENTION',
      loanStatus: 'OVERDUE',
      penalties: [],
      installments: [],
      totalOutstandingPaise: '1000000',
    }),
  } as unknown as OverdueService;

  const events = notificationEventsStub();

  return {
    service: new RecoveryCaseService(
      prisma,
      audit,
      loans,
      overdue,
      events.service,
    ),
    events,
    assignmentsCreated,
    caseUpdates,
    casesCreated,
    audited,
    guardCount,
    caseFindFirst,
    userFindFirst,
  };
}

describe('RecoveryCaseService.assign', () => {
  /** Property 1 — the one a "simplification" is most likely to remove. */
  it('writes an assignment history row on a first assignment', async () => {
    const h = harness();

    await h.service.assign(
      actor(),
      CASE,
      { assigneeUserId: OFFICER_A, expectedVersion: VERSION.toISOString() },
      META,
    );

    expect(h.assignmentsCreated).toHaveLength(1);
    expect(h.assignmentsCreated[0]).toMatchObject({
      recoveryCaseId: CASE,
      toUserId: OFFICER_A,
      assignedBy: USER,
    });
    // NULL on a first assignment is what distinguishes it from a reassignment
    // without a second column saying so.
    expect(h.assignmentsCreated[0]).not.toHaveProperty('fromUserId');
  });

  /** Scenario 10: the previous assignment remains in history. */
  it('records both sides of a reassignment', async () => {
    const h = harness({
      existing: caseRow({
        assignedAgentId: OFFICER_A,
        status: 'FIELD_ASSIGNED',
      }),
    });

    await h.service.assign(
      actor(),
      CASE,
      {
        assigneeUserId: OFFICER_B,
        reason: 'Route change',
        expectedVersion: VERSION.toISOString(),
      },
      META,
    );

    expect(h.assignmentsCreated[0]).toMatchObject({
      fromUserId: OFFICER_A,
      toUserId: OFFICER_B,
      reason: 'Route change',
    });
    expect(h.audited).toContain(AuditAction.RECOVERY_CASE_REASSIGNED);
  });

  /** Scenario 54: the audit record names the previous and the new assignee. */
  it('audits the previous and new assignee', async () => {
    const h = harness({ existing: caseRow({ assignedAgentId: OFFICER_A }) });
    const audit = (h.service as unknown as { audit: { record: jest.Mock } })
      .audit;

    await h.service.assign(
      actor(),
      CASE,
      { assigneeUserId: OFFICER_B, expectedVersion: VERSION.toISOString() },
      META,
    );

    const call = auditCalls(audit).find(
      (input) => input.action === AuditAction.RECOVERY_CASE_REASSIGNED,
    );
    expect(call).toMatchObject({
      oldData: { assignedAgentId: OFFICER_A },
      newData: { assignedAgentId: OFFICER_B },
    });
  });

  /** Property 2, Scenario 11. */
  it('refuses an inactive officer and writes no assignment', async () => {
    const h = harness();
    h.userFindFirst.mockResolvedValue({ status: 'INACTIVE', name: 'Gone' });

    await expect(
      h.service.assign(
        actor(),
        CASE,
        { assigneeUserId: OFFICER_A, expectedVersion: VERSION.toISOString() },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.assignmentsCreated).toHaveLength(0);
    expect(h.audited).toContain(AuditAction.RECOVERY_CASE_ASSIGNMENT_REFUSED);
  });

  it('refuses an officer outside the branch', async () => {
    const h = harness();
    h.userFindFirst.mockResolvedValue(null);

    await expect(
      h.service.assign(
        actor(),
        CASE,
        { assigneeUserId: OFFICER_A, expectedVersion: VERSION.toISOString() },
        META,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /** Property 3, first half: the readable pre-check. */
  it('rejects a stale version before touching anything', async () => {
    const h = harness();

    await expect(
      h.service.assign(
        actor(),
        CASE,
        {
          assigneeUserId: OFFICER_A,
          expectedVersion: '2020-01-01T00:00:00.000Z',
        },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.assignmentsCreated).toHaveLength(0);
    expect(h.audited).toContain(
      AuditAction.RECOVERY_CASE_CONCURRENT_ATTEMPT_REJECTED,
    );
  });

  /**
   * Property 3, second half. The guard is what actually prevents a lost update:
   * a racing writer commits between the pre-check and the write, and the
   * `updateMany` matches zero rows.
   */
  it('rejects when the guarded update matches no rows', async () => {
    const h = harness();
    h.guardCount.value = 0;

    await expect(
      h.service.assign(
        actor(),
        CASE,
        { assigneeUserId: OFFICER_A, expectedVersion: VERSION.toISOString() },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to reassign a case to whoever already holds it', async () => {
    const h = harness({ existing: caseRow({ assignedAgentId: OFFICER_A }) });

    await expect(
      h.service.assign(
        actor(),
        CASE,
        { assigneeUserId: OFFICER_A, expectedVersion: VERSION.toISOString() },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to assign a closed case', async () => {
    const h = harness({ existing: caseRow({ status: 'CLOSED' }) });

    await expect(
      h.service.assign(
        actor(),
        CASE,
        { assigneeUserId: OFFICER_A, expectedVersion: VERSION.toISOString() },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RecoveryCaseService.close', () => {
  /**
   * Property 4. Postgres evaluates a multi-column CHECK per statement, so
   * splitting the status from the closure columns fails
   * `recovery_cases_closure_complete` even inside one transaction.
   */
  it('writes every closure column in the same statement as the status', async () => {
    const h = harness();

    await h.service.close(
      actor(),
      CASE,
      {
        resolutionType: 'NOT_RECOVERABLE',
        closureReason: 'Customer untraceable',
        expectedVersion: VERSION.toISOString(),
      },
      META,
    );

    expect(h.caseUpdates).toHaveLength(1);
    const update = h.caseUpdates[0];
    expect(update.status).toBe('CLOSED');
    expect(update.closedDate).toBeInstanceOf(Date);
    expect(update.closedBy).toBe(USER);
    expect(update.resolutionType).toBe('NOT_RECOVERABLE');
    expect(update.closureReason).toBe('Customer untraceable');
  });

  /** Scenario 39: the closure snapshot reconciles. */
  it('snapshots figures that satisfy the closure sum constraint', async () => {
    const h = harness();

    await h.service.close(
      actor(),
      CASE,
      {
        resolutionType: 'NOT_RECOVERABLE',
        closureReason: 'Customer untraceable',
        expectedVersion: VERSION.toISOString(),
      },
      META,
    );

    const update = h.caseUpdates[0];
    expect(update.outstandingBeforePaise).toBe(
      (update.recoveredAmountPaise as bigint) +
        (update.remainingOutstandingPaise as bigint),
    );
  });

  /** Property 5, Scenario 40. */
  it('refuses closure while a settlement is unresolved', async () => {
    const h = harness({
      existing: caseRow({
        settlements: [{ status: 'PENDING_APPROVAL' }],
      }),
    });

    await expect(
      h.service.close(
        actor(),
        CASE,
        {
          resolutionType: 'NOT_RECOVERABLE',
          closureReason: 'Done',
          expectedVersion: VERSION.toISOString(),
        },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.caseUpdates).toHaveLength(0);
    expect(h.audited).toContain(AuditAction.RECOVERY_CASE_CLOSURE_BLOCKED);
  });

  it('refuses closure while a legal notice is active', async () => {
    const h = harness({
      existing: caseRow({ legalNotices: [{ status: 'ACTIVE' }] }),
    });

    await expect(
      h.service.close(
        actor(),
        CASE,
        {
          resolutionType: 'NOT_RECOVERABLE',
          closureReason: 'Done',
          expectedVersion: VERSION.toISOString(),
        },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /** Closing as settled needs something that was actually settled. */
  it('refuses a SETTLED resolution with no completed settlement', async () => {
    const h = harness();

    await expect(
      h.service.close(
        actor(),
        CASE,
        {
          resolutionType: 'SETTLED',
          closureReason: 'Agreed',
          expectedVersion: VERSION.toISOString(),
        },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to close an already-closed case', async () => {
    const h = harness({ existing: caseRow({ status: 'CLOSED' }) });

    await expect(
      h.service.close(
        actor(),
        CASE,
        {
          resolutionType: 'NOT_RECOVERABLE',
          closureReason: 'Done',
          expectedVersion: VERSION.toISOString(),
        },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RecoveryCaseService.open', () => {
  /** Property 6. */
  it('refuses a second open case on the same loan', async () => {
    const h = harness({ existing: null });
    const prisma = (h.service as unknown as { prisma: Record<string, never> })
      .prisma as unknown as { loan: { findFirst: jest.Mock } };
    prisma.loan.findFirst.mockResolvedValue({
      loanId: LOAN,
      loanNumber: 'LN-000001',
      branchId: BRANCH,
      status: 'OVERDUE',
      branch: { name: 'Main', code: 'BR001' },
      repaymentSchedules: [],
      penalties: [],
      recoveryCases: [{ status: 'FIELD_ASSIGNED' }],
    });

    await expect(
      h.service.open(actor(), { loanId: LOAN, idempotencyKey: KEY }, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.casesCreated).toHaveLength(0);
  });

  /** Scenario 41: a written-off loan follows its own workflow. */
  it('refuses to open against a written-off loan', async () => {
    const h = harness({ existing: null });
    const prisma = (h.service as unknown as { prisma: Record<string, never> })
      .prisma as unknown as { loan: { findFirst: jest.Mock } };
    prisma.loan.findFirst.mockResolvedValue({
      loanId: LOAN,
      loanNumber: 'LN-000001',
      branchId: BRANCH,
      status: 'WRITTEN_OFF',
      branch: { name: 'Main', code: 'BR001' },
      repaymentSchedules: [],
      penalties: [],
      recoveryCases: [],
    });

    await expect(
      h.service.open(actor(), { loanId: LOAN, idempotencyKey: KEY }, META),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /**
   * Property 8. The replay lookup happens before the loan is re-read and gated,
   * so a retry succeeds even once the loan is no longer eligible.
   */
  it('returns the original on a replayed key without re-gating the loan', async () => {
    const h = harness({ existing: caseRow() });
    const prisma = (h.service as unknown as { prisma: Record<string, never> })
      .prisma as unknown as {
      recoveryCase: { findFirst: jest.Mock };
      loan: { findFirst: jest.Mock };
    };

    // The replay lookup and the later detail read both go through findFirst.
    prisma.recoveryCase.findFirst.mockResolvedValue(
      caseRow({
        idempotencyKey: KEY,
        // The fingerprint the service computes for { loanId, priority MEDIUM }.
        requestFingerprint: fingerprintFor(LOAN),
      }),
    );

    await h.service.open(actor(), { loanId: LOAN, idempotencyKey: KEY }, META);

    expect(h.casesCreated).toHaveLength(0);
    expect(h.audited).toContain(AuditAction.RECOVERY_CASE_DUPLICATE_IGNORED);
  });

  /** A materially different request on the same key is a conflict, not a replay. */
  it('rejects a different request that reuses a key', async () => {
    const h = harness({ existing: caseRow() });
    const prisma = (h.service as unknown as { prisma: Record<string, never> })
      .prisma as unknown as { recoveryCase: { findFirst: jest.Mock } };
    prisma.recoveryCase.findFirst.mockResolvedValue(
      caseRow({ idempotencyKey: KEY, requestFingerprint: 'something-else' }),
    );

    await expect(
      h.service.open(actor(), { loanId: LOAN, idempotencyKey: KEY }, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.audited).toContain(AuditAction.RECOVERY_CASE_IDEMPOTENCY_CONFLICT);
  });
});

describe('officer confinement', () => {
  /** Property 7: the permission grants the action, never the reach. */
  it('confines an officer without assignment authority to their own cases', async () => {
    const h = harness();

    await h.service
      .findInScope(actor({ permissions: ['recovery.cases.view'] }), CASE, META)
      .catch(() => undefined);

    const where = firstCallArg<{ where: Record<string, unknown> }>(
      h.caseFindFirst,
    ).where;
    expect(where.assignedAgentId).toBe(USER);
  });

  it('does not confine a caller who can assign', async () => {
    const h = harness();

    await h.service.findInScope(actor(), CASE, META).catch(() => undefined);

    const where = firstCallArg<{ where: Record<string, unknown> }>(
      h.caseFindFirst,
    ).where;
    expect(where.assignedAgentId).toBeUndefined();
  });

  /** Scope misses are a 404, never a 403 — a 403 would confirm the id exists. */
  it('reports a scope miss as not-found and audits it', async () => {
    const h = harness({ existing: null });

    await expect(
      h.service.findInScope(actor(), CASE, META),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.audited).toContain(AuditAction.RECOVERY_CASE_SCOPE_DENIED);
  });
});

/**
 * The first argument of a mock's first call, typed.
 *
 * `jest.Mock` is `any`-typed, so reading `.mock.calls[0][0]` inline produces an
 * unsafe-member-access complaint at every call site. Narrowing once here keeps
 * the assertions plain — the same helper `collection.service.spec.ts` uses.
 */
function firstCallArg<T>(mock: jest.Mock): T {
  // Jest types `.mock.calls` as `any[][]` by design, so this is the one place
  // that has to say what the argument actually is.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return mock.mock.calls[0][0] as T;
}

/** The audit calls made, typed. Same reason as `firstCallArg` above. */
function auditCalls(audit: { record: jest.Mock }): {
  action: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
}[] {
  return (
    audit.record.mock.calls as unknown as [
      {
        action: string;
        oldData?: Record<string, unknown>;
        newData?: Record<string, unknown>;
      },
    ][]
  ).map(([input]) => input);
}

/** Mirrors the service's private fingerprint, so a replay test can match it. */
function fingerprintFor(loanId: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256')
    .update(JSON.stringify({ loanId, priority: 'MEDIUM' }))
    .digest('hex');
}

/**
 * Module 16 — the notification event raised by an assignment.
 *
 * Two properties, and the second matters more than the first.
 *
 * The event must carry what the template needs, resolved from authoritative
 * data. But above all, **the assignment must survive a broken notification
 * pipeline**: by the time the event is raised the assignment has committed, and
 * Rules 60 to 62 forbid a notification failure from undoing it. That is what the
 * last test here proves, using a stub deliberately more hostile than production
 * — the real service swallows its own failures, so a call site that survives a
 * rejecting stub survives anything.
 */
describe('RecoveryCaseService.assign — notification event (Module 16)', () => {
  it('raises RECOVERY_ASSIGNED after the assignment commits', async () => {
    const h = harness();

    await h.service.assign(
      actor(),
      CASE,
      { assigneeUserId: OFFICER_A, expectedVersion: VERSION.toISOString() },
      META,
    );

    const raised = h.events.ofType('RECOVERY_ASSIGNED');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      sourceModule: 'recovery',
      sourceRecordId: CASE,
    });
  });

  it('carries no recipient — resolution happens at processing time', () => {
    // Scenario 16: the recipient comes from the authoritative assignment when
    // the event is processed, not from a value frozen into the payload. A case
    // reassigned in that window must notify whoever holds it now.
    const h = harness();

    return h.service
      .assign(
        actor(),
        CASE,
        { assigneeUserId: OFFICER_A, expectedVersion: VERSION.toISOString() },
        META,
      )
      .then(() => {
        const [raised] = h.events.ofType('RECOVERY_ASSIGNED');
        expect(raised.payload).not.toHaveProperty('recipientUserId');
        expect(raised.payload).not.toHaveProperty('assigneeUserId');
      });
  });

  it('distinguishes a reassignment from a replay of the same event', async () => {
    // Rules 12 and 14: `sourceVersion` is what makes two genuine assignments on
    // one case two events rather than one swallowed as a duplicate.
    const first = harness();
    await first.service.assign(
      actor(),
      CASE,
      { assigneeUserId: OFFICER_A, expectedVersion: VERSION.toISOString() },
      META,
    );

    const second = harness({
      existing: caseRow({
        assignedAgentId: OFFICER_A,
        status: 'FIELD_ASSIGNED',
      }),
    });
    await second.service.assign(
      actor(),
      CASE,
      { assigneeUserId: OFFICER_B, expectedVersion: VERSION.toISOString() },
      META,
    );

    expect(first.events.ofType('RECOVERY_ASSIGNED')[0].sourceVersion).not.toBe(
      second.events.ofType('RECOVERY_ASSIGNED')[0].sourceVersion,
    );
  });

  describe('Rules 60-62 and Scenario 31', () => {
    it('completes the assignment even when the notification pipeline throws', async () => {
      // The load-bearing test of this phase. The assignment has already
      // committed; a notification failure must not surface as a failed
      // assignment, and must not roll one back.
      const h = harness();
      (
        h.service as unknown as { events: { emit: () => Promise<void> } }
      ).events = {
        emit: () => Promise.reject(new Error('notification pipeline is down')),
      };

      await expect(
        h.service.assign(
          actor(),
          CASE,
          { assigneeUserId: OFFICER_A, expectedVersion: VERSION.toISOString() },
          META,
        ),
      ).resolves.toBeDefined();

      // And the business write still happened.
      expect(h.assignmentsCreated).toHaveLength(1);
    });
  });
});
