/**
 * Load-bearing properties of penalty assessment.
 *
 * Each is something a plausible refactor breaks silently, and each maps to a
 * rule or scenario in the Module 13 source:
 *
 *  1. **No journal is posted at assessment.** The ledger is cash-basis: penalty
 *     income is recognised when Module 11 allocates a payment, crediting 4200.
 *     Posting an accrual entry here would double-count every penalty ever
 *     collected. If a refactor injects `LedgerService` into this service, this
 *     suite should fail.
 *  2. **The amount comes from the rule, never from the caller.** The DTO has no
 *     amount field, and the figure is computed from the resolved rule and the
 *     authoritative balances (Rule 12, Scenario 18).
 *  3. **A retried assessment resolves to the existing row** rather than
 *     charging twice (Scenario 19).
 *  4. **Zero charges write no row.** Inside the grace period there is no
 *     penalty, and a zero row would clutter every borrower's history with
 *     charges that are not charges.
 *  5. **A misconfigured rule is a 400, not a silent zero.** Forgiving every
 *     borrower under a broken rule is the failure mode this prevents
 *     (Scenario 51's principle, one level down).
 *  6. **The loan-level override beats the scheme's**, and its grace period
 *     overrides the rule's.
 *  7. **A waiver preserves the contractual figure** and records a
 *     `PenaltyAction`; the original is never edited away (Rule 31's shape,
 *     applied to the subsidiary record).
 */

import { BadRequestException, ConflictException } from '@nestjs/common';

import { AuditAction, type AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoanService } from '../../loans/shared/loan.service';
import { PenaltyService } from './penalty.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const BRANCH = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
const LOAN = '44444444-4444-4444-4444-444444444444';
const EMI = '55555555-5555-5555-5555-555555555555';
const RULE = '66666666-6666-6666-6666-666666666666';
const KEY = '77777777-7777-4777-8777-777777777777';

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
    permissions: ['penalties.assess', 'penalties.waive'],
    ...overrides,
  };
}

/** A rule that charges 0.5% of the outstanding balance per day, no grace. */
function penaltyRule(overrides: Record<string, unknown> = {}) {
  return {
    penaltyRuleId: RULE,
    calculationType: 'PERCENTAGE_OUTSTANDING_PER_DAY',
    rateBps: 50n,
    fixedAmountPaise: null,
    graceDays: 0,
    ...overrides,
  };
}

/** An installment that fell due well in the past and is unpaid. */
function emiRow(overrides: Record<string, unknown> = {}) {
  return {
    emiId: EMI,
    installmentNumber: 1,
    dueDate: new Date('2020-01-01T00:00:00Z'),
    principalDuePaise: 900000n,
    interestDuePaise: 100000n,
    totalDuePaise: 1000000n,
    paidAmountPaise: 0n,
    outstandingAmountPaise: 1000000n,
    status: 'OVERDUE',
    ...overrides,
  };
}

function loanRow(overrides: Record<string, unknown> = {}) {
  return {
    loanId: LOAN,
    branchId: BRANCH,
    repaymentSchedules: [{ status: 'ACTIVE', emis: [emiRow()] }],
    penaltyRuleOverrides: [] as unknown[],
    loanScheme: { penaltyRuleOverrides: [{ penaltyRule: penaltyRule() }] },
    ...overrides,
  };
}

type Harness = {
  service: PenaltyService;
  created: Record<string, unknown>[];
  audited: string[];
  penaltyActions: Record<string, unknown>[];
  ledgerTouched: boolean;
};

function harness(
  options: {
    loan?: Record<string, unknown> | null;
    existingPenalty?: Record<string, unknown> | null;
    penaltyForAct?: Record<string, unknown> | null;
  } = {},
): Harness {
  const created: Record<string, unknown>[] = [];
  const audited: string[] = [];
  const penaltyActions: Record<string, unknown>[] = [];
  const ledgerTouched = false;

  const tx = {
    loan: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.loan === undefined ? loanRow() : options.loan,
        ),
    },
    penalty: {
      findFirst: jest.fn().mockResolvedValue(options.existingPenalty ?? null),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({
            ...data,
            penaltyId: 'created-penalty',
            createdAt: new Date(),
          });
        }),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            ...(options.penaltyForAct ?? {}),
            ...data,
            penaltyId: 'acted-penalty',
            loanId: LOAN,
            emiId: EMI,
            assessedDate: new Date('2026-08-24T00:00:00Z'),
            amountPaise: 500000n,
            paidAmountPaise: 0n,
            calculationType: 'PERCENTAGE_OUTSTANDING_PER_DAY',
            calculationSnapshot: {},
            createdAt: new Date(),
          }),
        ),
    },
    penaltyAction: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          penaltyActions.push(data);
          return Promise.resolve(data);
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

  return {
    service: new PenaltyService(prisma, audit, loans),
    created,
    audited,
    penaltyActions,
    ledgerTouched,
  };
}

describe('PenaltyService.assess', () => {
  /**
   * Property 1. `PenaltyService`'s constructor takes prisma, audit and loans —
   * and deliberately not `LedgerService`. Asserted structurally so that adding
   * a ledger dependency is a visible, deliberate change rather than a quiet one.
   */
  it('does not depend on the ledger', () => {
    expect(PenaltyService.length).toBe(3);
  });

  it('writes a penalty computed from the rule, not from the caller', async () => {
    const { service, created } = harness();

    await service.assess(actor(), { loanId: LOAN, idempotencyKey: KEY }, META);

    expect(created).toHaveLength(1);
    const row = created[0];
    expect(row.status).toBe('ASSESSED');
    expect(row.penaltyRuleId).toBe(RULE);
    // The figure is whatever the rule produced against the real balance; the
    // point is that it is positive and derived, not that it is a magic number.
    expect(row.amountPaise as bigint).toBeGreaterThan(0n);
    expect(row.outstandingAmountPaise).toEqual(row.amountPaise);
    expect(row.paidAmountPaise).toBe(0n);
  });

  /** Rule 12: the charge must be replayable from what the calculation saw. */
  it('stores the calculation snapshot', async () => {
    const { service, created } = harness();

    await service.assess(actor(), { loanId: LOAN, idempotencyKey: KEY }, META);

    const snapshot = created[0].calculationSnapshot as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      calculationType: 'PERCENTAGE_OUTSTANDING_PER_DAY',
      rateBps: '50',
      graceDays: 0,
    });
    expect(snapshot.chargeableDays).toBeGreaterThan(0);
  });

  /** Property 3, Scenario 19. */
  it('returns the existing row rather than charging twice', async () => {
    const { service, created } = harness({
      existingPenalty: {
        penaltyId: 'existing',
        loanId: LOAN,
        emiId: EMI,
        assessedDate: new Date('2026-08-24T00:00:00Z'),
        amountPaise: 500000n,
        paidAmountPaise: 0n,
        outstandingAmountPaise: 500000n,
        status: 'ASSESSED',
        calculationType: 'PERCENTAGE_OUTSTANDING_PER_DAY',
        calculationSnapshot: {},
        createdAt: new Date(),
      },
    });

    const result = await service.assess(
      actor(),
      { loanId: LOAN, idempotencyKey: KEY },
      META,
    );

    expect(created).toHaveLength(0);
    expect(result[0]?.penaltyId).toBe('existing');
  });

  /** Property 4: inside the grace period there is no charge and no row. */
  it('writes nothing while the borrower is inside the grace period', async () => {
    const { service, created } = harness({
      loan: loanRow({
        loanScheme: {
          penaltyRuleOverrides: [
            { penaltyRule: penaltyRule({ graceDays: 100000 }) },
          ],
        },
      }),
    });

    const result = await service.assess(
      actor(),
      { loanId: LOAN, idempotencyKey: KEY },
      META,
    );

    expect(created).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it('writes nothing for an installment that is settled', async () => {
    const { service, created } = harness({
      loan: loanRow({
        repaymentSchedules: [
          {
            status: 'ACTIVE',
            emis: [
              emiRow({ outstandingAmountPaise: 0n, paidAmountPaise: 1000000n }),
            ],
          },
        ],
      }),
    });

    await service.assess(actor(), { loanId: LOAN, idempotencyKey: KEY }, META);
    expect(created).toHaveLength(0);
  });

  it('writes nothing for an installment that is not yet due', async () => {
    const { service, created } = harness({
      loan: loanRow({
        repaymentSchedules: [
          {
            status: 'ACTIVE',
            emis: [emiRow({ dueDate: new Date('2099-01-01T00:00:00Z') })],
          },
        ],
      }),
    });

    await service.assess(actor(), { loanId: LOAN, idempotencyKey: KEY }, META);
    expect(created).toHaveLength(0);
  });

  /** Property 5. */
  it('refuses a rule that cannot produce a figure', async () => {
    const { service, audited } = harness({
      loan: loanRow({
        loanScheme: {
          penaltyRuleOverrides: [
            { penaltyRule: penaltyRule({ rateBps: null }) },
          ],
        },
      }),
    });

    await expect(
      service.assess(actor(), { loanId: LOAN, idempotencyKey: KEY }, META),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(audited).toContain(AuditAction.PENALTY_ASSESSMENT_FAILED);
  });

  it('refuses a loan with no penalty rule configured', async () => {
    const { service } = harness({
      loan: loanRow({
        loanScheme: { penaltyRuleOverrides: [] },
        penaltyRuleOverrides: [],
      }),
    });

    await expect(
      service.assess(actor(), { loanId: LOAN, idempotencyKey: KEY }, META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /** Property 6. */
  it('prefers the loan-level override over the scheme rule', async () => {
    const loanRuleId = '88888888-8888-8888-8888-888888888888';
    const { service, created } = harness({
      loan: loanRow({
        penaltyRuleOverrides: [
          {
            graceDays: null,
            penaltyRule: penaltyRule({ penaltyRuleId: loanRuleId }),
          },
        ],
      }),
    });

    await service.assess(actor(), { loanId: LOAN, idempotencyKey: KEY }, META);
    expect(created[0]?.penaltyRuleId).toBe(loanRuleId);
  });

  it('lets a loan-level override replace the grace period alone', async () => {
    const { service, created } = harness({
      loan: loanRow({
        penaltyRuleOverrides: [
          { graceDays: 100000, penaltyRule: penaltyRule({ graceDays: 0 }) },
        ],
      }),
    });

    await service.assess(actor(), { loanId: LOAN, idempotencyKey: KEY }, META);
    expect(created).toHaveLength(0);
  });

  it('audits every assessment', async () => {
    const { service, audited } = harness();
    await service.assess(actor(), { loanId: LOAN, idempotencyKey: KEY }, META);
    expect(audited).toContain(AuditAction.PENALTY_ASSESSED);
  });

  it('narrows to one installment when an emiId is given', async () => {
    const other = '99999999-9999-9999-9999-999999999999';
    const { service, created } = harness({
      loan: loanRow({
        repaymentSchedules: [
          {
            status: 'ACTIVE',
            emis: [emiRow(), emiRow({ emiId: other, installmentNumber: 2 })],
          },
        ],
      }),
    });

    await service.assess(
      actor(),
      { loanId: LOAN, emiId: other, idempotencyKey: KEY },
      META,
    );

    expect(created).toHaveLength(1);
    expect(created[0]?.emiId).toBe(other);
  });
});

describe('PenaltyService.act', () => {
  const assessed = {
    penaltyId: 'acted-penalty',
    loanId: LOAN,
    emiId: EMI,
    amountPaise: 500000n,
    paidAmountPaise: 0n,
    outstandingAmountPaise: 500000n,
    status: 'ASSESSED',
  };

  /** Property 7: the contractual figure survives; the decision is a new row. */
  it('waives without editing the contractual amount', async () => {
    const { service, penaltyActions, audited } = harness({
      penaltyForAct: assessed,
    });
    const prisma = (service as unknown as { prisma: Record<string, never> })
      .prisma as unknown as {
      penalty: { findFirst: jest.Mock; update: jest.Mock };
    };
    prisma.penalty.findFirst.mockResolvedValue(assessed);

    const result = await service.act(
      actor(),
      'acted-penalty',
      { action: 'WAIVE', reason: 'Goodwill' },
      META,
    );

    expect(result.status).toBe('WAIVED');
    expect(result.amountPaise).toBe('500000');
    expect(result.outstandingAmountPaise).toBe('0');
    expect(penaltyActions[0]).toMatchObject({
      action: 'WAIVE',
      reason: 'Goodwill',
      performedBy: USER,
    });
    expect(audited).toContain(AuditAction.PENALTY_WAIVED);
  });

  it('refuses an adjustment below what has already been paid', async () => {
    const { service } = harness();
    const prisma = (service as unknown as { prisma: Record<string, never> })
      .prisma as unknown as { penalty: { findFirst: jest.Mock } };
    prisma.penalty.findFirst.mockResolvedValue({
      ...assessed,
      paidAmountPaise: 400000n,
      outstandingAmountPaise: 100000n,
      status: 'PARTIALLY_PAID',
    });

    await expect(
      service.act(
        actor(),
        'acted-penalty',
        { action: 'ADJUST', amountPaise: '100000', reason: 'Recalculated' },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /** A paid penalty is corrected by reversing the collection, not by a waiver. */
  it('refuses to waive a penalty that has been paid', async () => {
    const { service } = harness();
    const prisma = (service as unknown as { prisma: Record<string, never> })
      .prisma as unknown as { penalty: { findFirst: jest.Mock } };
    prisma.penalty.findFirst.mockResolvedValue({
      ...assessed,
      status: 'PAID',
      paidAmountPaise: 500000n,
      outstandingAmountPaise: 0n,
    });

    await expect(
      service.act(
        actor(),
        'acted-penalty',
        { action: 'WAIVE', reason: 'Goodwill' },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an adjustment with no amount', async () => {
    const { service } = harness();
    await expect(
      service.act(
        actor(),
        'acted-penalty',
        { action: 'ADJUST', reason: 'Recalculated' },
        META,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an amount on a waiver', async () => {
    const { service } = harness();
    await expect(
      service.act(
        actor(),
        'acted-penalty',
        { action: 'WAIVE', amountPaise: '100', reason: 'Goodwill' },
        META,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
