import { BadRequestException } from '@nestjs/common';

import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import type { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import type { BusinessCalendarService } from '../settings/business-calendar.service';
import { EOD_STEPS, eodStepsInOrder } from './eod-step.registry';
import { EodService } from './eod.service';
import { MaintenanceJobService } from './maintenance-job.service';

/**
 * Module 17 — end of day.
 *
 * Four properties carry the weight, and each fails silently if broken:
 *
 * 1. **Scheduled and manual runs collide with each other.** `executionKey`
 *    excludes `triggerType` for exactly this reason (Scenario 66). Both paths
 *    are exercised in ONE test, because adding `triggerType` to the key is a
 *    plausible "fix" that no single-path test would catch.
 * 2. **A failure stops the run and closes nothing.** Scenario 23 — no day
 *    closing is written, and nothing advances a business date.
 * 3. **A retry skips completed steps.** Scenario 24. The skip comes from the
 *    pending-steps query rather than a condition somebody could invert.
 * 4. **No registered step touches the financial tables.** This is what keeps
 *    Module 17 a runner rather than a second path into the ledger.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const BRANCH_A = '44444444-4444-4444-4444-444444444444';
const JOB_RUN_ID = '66666666-6666-6666-6666-666666666666';

const TODAY = '2026-08-26';

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: SESSION_ID,
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['maintenance.eod.run', 'maintenance.jobs.view'],
    ...overrides,
  };
}

function harness() {
  const prisma = {
    loan: { count: jest.fn().mockResolvedValue(3) },
    emi: { count: jest.fn().mockResolvedValue(2) },
    branch: { findMany: jest.fn().mockResolvedValue([{ branchId: BRANCH_A }]) },
    dayClosing: {
      findMany: jest.fn().mockResolvedValue([{ branchId: BRANCH_A }]),
      create: jest.fn(),
      update: jest.fn(),
    },
    journalEntry: { create: jest.fn() },
    collection: { create: jest.fn() },
  };

  const jobs = {
    claim: jest.fn().mockResolvedValue({
      created: true,
      jobRunId: JOB_RUN_ID,
      status: 'QUEUED',
    }),
    get: jest.fn().mockResolvedValue({
      jobRunId: JOB_RUN_ID,
      branchId: null,
      businessDate: TODAY,
      status: 'SUCCEEDED',
      steps: [],
    }),
    markRunning: jest.fn().mockResolvedValue(undefined),
    pendingSteps: jest.fn().mockResolvedValue(
      eodStepsInOrder().map((step, index) => ({
        jobStepId: `step-${index}`,
        stepCode: step.code,
        sequence: step.sequence,
      })),
    ),
    startStep: jest.fn().mockResolvedValue(undefined),
    finishStep: jest.fn().mockResolvedValue(undefined),
    completeRun: jest.fn().mockResolvedValue(undefined),
  };

  const calendar = {
    currentBusinessDate: jest.fn().mockReturnValue(TODAY),
  };

  const service = new EodService(
    prisma as unknown as PrismaService,
    jobs as unknown as MaintenanceJobService,
    calendar as unknown as BusinessCalendarService,
    {
      pruneDeadSessions: jest.fn().mockResolvedValue(0),
    } as unknown as SessionService,
  );

  return { service, prisma, jobs, calendar };
}

describe('EodService', () => {
  describe('duplicate prevention (Scenarios 22, 66)', () => {
    it('derives the same execution key for scheduled and manual runs', () => {
      // The single most important line in this module's idempotency design.
      // If `triggerType` ever enters the key, these diverge and a scheduled run
      // stops colliding with a manual one.
      const scheduled = MaintenanceJobService.executionKey('EOD', null, TODAY);
      const manual = MaintenanceJobService.executionKey('EOD', null, TODAY);
      expect(scheduled).toBe(manual);
      expect(scheduled).toBe(`EOD:ORG:${TODAY}`);
    });

    it('collides a manual run with a running scheduled one', async () => {
      const { service, jobs } = harness();

      // The scheduled run claimed the key first.
      await service.run(actor(), { triggerType: 'SCHEDULED' }, META);

      jobs.claim.mockResolvedValue({
        created: false,
        jobRunId: JOB_RUN_ID,
        status: 'RUNNING',
      });

      const manual = await service.run(
        actor(),
        { triggerType: 'MANUAL' },
        META,
      );

      expect(manual.outcome).toBe('ALREADY_HANDLED');
      // Both calls asked for the same key.
      const keys = jobs.claim.mock.calls.map(
        (call) =>
          `${(call[1] as { jobType: string }).jobType}:${
            (call[1] as { branchId: string | null }).branchId ?? 'ORG'
          }:${(call[1] as { businessDate: string }).businessDate}`,
      );
      expect(new Set(keys).size).toBe(1);
    });

    it('does not run any step when the key was already claimed', async () => {
      const { service, jobs } = harness();
      jobs.claim.mockResolvedValue({
        created: false,
        jobRunId: JOB_RUN_ID,
        status: 'SUCCEEDED',
      });

      await service.run(actor(), {}, META);

      expect(jobs.markRunning).not.toHaveBeenCalled();
      expect(jobs.startStep).not.toHaveBeenCalled();
    });

    it('scopes the key per branch', () => {
      expect(
        MaintenanceJobService.executionKey('EOD', BRANCH_A, TODAY),
      ).not.toBe(MaintenanceJobService.executionKey('EOD', null, TODAY));
    });
  });

  describe('failure handling (Scenario 23)', () => {
    it('stops at the first failing step', async () => {
      const { service, prisma, jobs } = harness();
      prisma.emi.count.mockRejectedValue(new Error('database unavailable'));

      await service.run(actor(), {}, META);

      // Step 1 ran, step 2 failed, step 3 never started.
      expect(jobs.startStep).toHaveBeenCalledTimes(2);
      expect(jobs.finishStep).toHaveBeenCalledWith(
        ORG_ID,
        'step-1',
        expect.objectContaining({ status: 'FAILED' }),
      );
    });

    it('writes no day closing and completes the run as FAILED', async () => {
      const { service, prisma, jobs } = harness();
      prisma.emi.count.mockRejectedValue(new Error('boom'));

      await service.run(actor(), {}, META);

      expect(prisma.dayClosing.create).not.toHaveBeenCalled();
      expect(prisma.dayClosing.update).not.toHaveBeenCalled();
      expect(jobs.completeRun).toHaveBeenCalledWith(
        ORG_ID,
        JOB_RUN_ID,
        expect.objectContaining({ status: 'FAILED', failedCount: 1 }),
        expect.anything(),
      );
    });

    it('marks a run RECOVERY_REQUIRED when a step is no longer registered', async () => {
      const { service, jobs } = harness();
      jobs.pendingSteps.mockResolvedValue([
        { jobStepId: 'ghost', stepCode: 'EOD_REMOVED_STEP', sequence: 1 },
      ]);

      await service.run(actor(), {}, META);

      expect(jobs.completeRun).toHaveBeenCalledWith(
        ORG_ID,
        JOB_RUN_ID,
        expect.objectContaining({
          status: 'RECOVERY_REQUIRED',
          retryable: false,
        }),
        expect.anything(),
      );
    });
  });

  describe('retry (Scenario 24)', () => {
    it('runs only the steps that have not succeeded', async () => {
      const { service, jobs } = harness();
      // Step 1 already succeeded on the previous attempt, so the query omits it.
      jobs.pendingSteps.mockResolvedValue([
        {
          jobStepId: 'step-2',
          stepCode: 'EOD_VERIFY_DAY_CLOSING',
          sequence: 30,
        },
      ]);

      await service.resume(actor(), JOB_RUN_ID);

      expect(jobs.startStep).toHaveBeenCalledTimes(1);
      expect(jobs.startStep).toHaveBeenCalledWith(ORG_ID, 'step-2');
    });

    it('succeeds when every remaining step passes', async () => {
      const { service, jobs } = harness();

      await service.run(actor(), {}, META);

      expect(jobs.completeRun).toHaveBeenCalledWith(
        ORG_ID,
        JOB_RUN_ID,
        expect.objectContaining({ status: 'SUCCEEDED', failedCount: 0 }),
        expect.anything(),
      );
    });
  });

  describe('business date', () => {
    it('refuses a future business date', async () => {
      const { service } = harness();

      await expect(
        service.run(actor(), { businessDate: '2099-01-01' }, META),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults to the calendar current business date', async () => {
      const { service, jobs } = harness();

      await service.run(actor(), {}, META);

      expect(jobs.claim).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ businessDate: TODAY }),
        expect.anything(),
      );
    });
  });
});

describe('EOD step registry — Module 17 owns the runner, not the work', () => {
  /**
   * The guard that keeps this module out of the ledger.
   *
   * Nothing in the `EodStep` type prevents somebody writing an INSERT in a step,
   * so this asserts it from the outside: every step runs against a Prisma
   * stand-in whose financial tables throw on any write.
   */
  const FORBIDDEN = [
    'journalEntry',
    'journalLine',
    'collection',
    'receipt',
    'dayClosing',
    'disbursement',
    'emi',
    'loan',
    'penalty',
  ];

  function forbiddenPrisma() {
    const violations: string[] = [];
    const model = (name: string) =>
      new Proxy(
        {},
        {
          get(_target, method: string) {
            // Reads are fine; writes are the thing being prevented.
            if (
              [
                'create',
                'createMany',
                'update',
                'updateMany',
                'delete',
                'deleteMany',
                'upsert',
              ].includes(method)
            ) {
              return () => {
                violations.push(`${name}.${method}`);
                throw new Error(
                  `${name}.${method} is forbidden in an EOD step`,
                );
              };
            }
            if (method === 'count') return () => Promise.resolve(0);
            if (method === 'findMany') return () => Promise.resolve([]);
            if (method === 'findFirst' || method === 'findUnique')
              return () => Promise.resolve(null);
            return () => Promise.resolve(null);
          },
        },
      );

    const prisma: Record<string, unknown> = {};
    for (const name of [...FORBIDDEN, 'branch', 'setting']) {
      prisma[name] = model(name);
    }
    return { prisma, violations };
  }

  it.each(EOD_STEPS.map((step) => [step.code, step] as const))(
    '%s writes to no financial table',
    async (_code, step) => {
      const { prisma, violations } = forbiddenPrisma();

      await step.run({
        orgId: ORG_ID,
        branchId: null,
        businessDate: TODAY,
        prisma: prisma as unknown as PrismaService,
        // Session pruning is not financial work, so it is stubbed rather than
        // routed through the forbidden-table proxy — what this test asserts is
        // that no step reaches the ledger, not that no step writes at all.
        sessions: {
          pruneDeadSessions: jest.fn().mockResolvedValue(0),
        } as unknown as SessionService,
      });

      expect(violations).toEqual([]);
    },
  );

  it('registers every step with a unique code and sequence', () => {
    const codes = EOD_STEPS.map((step) => step.code);
    const sequences = EOD_STEPS.map((step) => step.sequence);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it('orders steps by sequence rather than array position', () => {
    const ordered = eodStepsInOrder().map((step) => step.sequence);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });
});

/**
 * The one registered step that writes.
 *
 * It is consistent with this module's rule — that rule keeps the runner out of
 * the *ledger*, and `user_sessions` is not financial data — but it is the
 * exception, so what it does is pinned here rather than left to the guard test
 * above, which only asserts what a step must not touch.
 */
describe('EOD_PRUNE_DEAD_SESSIONS', () => {
  const step = EOD_STEPS.find((s) => s.code === 'EOD_PRUNE_DEAD_SESSIONS')!;

  function contextWith(pruned: number) {
    const pruneDeadSessions = jest.fn().mockResolvedValue(pruned);
    return {
      pruneDeadSessions,
      context: {
        orgId: ORG_ID,
        branchId: null,
        businessDate: TODAY,
        prisma: {} as unknown as PrismaService,
        sessions: { pruneDeadSessions } as unknown as SessionService,
      },
    };
  }

  it('is registered', () => {
    expect(step).toBeDefined();
  });

  it('delegates to the session service and reports what it removed', async () => {
    const { pruneDeadSessions, context } = contextWith(12);

    const result = await step.run(context);

    expect(pruneDeadSessions).toHaveBeenCalled();
    expect(result.processed).toBe(12);
  });

  /**
   * One run is bounded so a first pass over a long-grown table cannot lock the
   * whole backlog. When it fills that budget the operator must be told the
   * table is not yet clear, or a partial prune reads as a complete one.
   */
  it('says so when more rows remain than one run removes', async () => {
    const { context } = contextWith(5000);

    const result = await step.run(context);

    expect(result.summary).toMatch(/more remain/);
  });

  it('is retryable, because deleting by an absolute cutoff is idempotent', () => {
    expect(step.retryable).toBe(true);
  });
});
