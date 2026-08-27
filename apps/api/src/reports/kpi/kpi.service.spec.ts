import type { PrismaService } from '../../prisma/prisma.service';
import type { OverdueService } from '../../recovery/overdue/overdue.service';
import { KpiService } from './kpi.service';

/**
 * The shared KPI arithmetic.
 *
 * This provider exists so that Module 15's reporting dashboard and Module 18's
 * home screen cannot disagree about what "total outstanding" means. What is
 * worth pinning here is therefore the arithmetic itself, not the plumbing:
 *
 *  1. **Money accumulates as `bigint` and leaves as a decimal string.** A
 *     figure that round-tripped through `Number` would be silently wrong above
 *     2^53 paise — about ninety thousand crore — which is a number a real loan
 *     book reaches.
 *  2. **`collectionRateBps` is integer division, and never divides by zero.** A
 *     branch with nothing due is the ordinary state of a new branch, not an
 *     error, and it must produce `'0'` rather than `NaN` or a crash.
 *  3. **An empty book returns zeroes, not an empty response.** The caller
 *     distinguishes "no rows" from "failed"; this layer's job is to return the
 *     honest zero so the caller can.
 *  4. **The batch loop terminates.** It pages until a short batch, and a stub
 *     that always returned a full batch would hang forever — so the loop's exit
 *     conditions are asserted directly.
 *
 * No database. Prisma is a stub that returns what each test needs.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const BRANCH = '44444444-4444-4444-8444-444444444444';

/** A loan row shaped the way `OVERDUE_LOAN_INCLUDE` returns one. */
function loan(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    loanNumber: 'LN-0001',
    disbursementDate: new Date('2026-01-01'),
    principalAmountPaise: BigInt(100_000),
    repaymentSchedules: [],
    ...overrides,
  };
}

/** An EMI row carrying the three columns `positionKpis` reads. */
function emi(
  principalDue: bigint,
  interestDue: bigint,
  paid: bigint,
  outstanding: bigint,
): Record<string, unknown> {
  return {
    principalDuePaise: principalDue,
    interestDuePaise: interestDue,
    paidAmountPaise: paid,
    outstandingAmountPaise: outstanding,
  };
}

interface Stubs {
  loans?: Record<string, unknown>[];
  aggregates?: Record<string, unknown>;
  counts?: number[];
  summary?: Record<string, unknown>;
}

function build(stubs: Stubs = {}): KpiService {
  const loans = stubs.loans ?? [];
  const counts = [...(stubs.counts ?? [])];

  const aggregate = (): unknown =>
    Promise.resolve(stubs.aggregates ?? { _sum: {} });

  const prisma = {
    loan: {
      // Paged the same way the real loop pages, so the exit condition is real.
      findMany: ({ skip, take }: { skip: number; take: number }) =>
        Promise.resolve(loans.slice(skip, skip + take)),
    },
    collection: { aggregate },
    emi: { aggregate },
    cashHandover: { aggregate },
    cashReconciliation: { aggregate },
    recoveryCase: {
      count: () => Promise.resolve(counts.shift() ?? 0),
      aggregate,
    },
    recoveryAction: { aggregate },
  } as unknown as PrismaService;

  const overdue = {
    deriveSummary: () =>
      stubs.summary ?? {
        daysPastDue: 0,
        bucket: 'CURRENT',
        npaEligibility: 'STANDARD',
        totalOverduePaise: '0',
      },
  } as unknown as OverdueService;

  return new KpiService(prisma, overdue);
}

describe('KpiService.positionKpis', () => {
  it('returns honest zeroes for an empty loan book', async () => {
    const [portfolio, delinquency] = await build().positionKpis({ orgId: ORG });

    expect(portfolio).toEqual({
      totalActiveLoans: 0,
      totalOutstandingPrincipalPaise: '0',
      totalPortfolioOutstandingPaise: '0',
      loansDisbursed: 0,
      disbursedAmountPaise: '0',
    });
    expect(delinquency.overdueAccounts).toBe(0);
    expect(delinquency.buckets).toEqual([]);
    // Absent rather than null: no loan is overdue, so there is no oldest date.
    expect(delinquency).not.toHaveProperty('oldestDueDate');
  });

  it('sums principal outstanding net of what interest already absorbed', async () => {
    // Appropriation is interest-first, so a 300 payment against 200 interest
    // leaves 100 against principal — not 300.
    const service = build({
      loans: [
        loan({
          repaymentSchedules: [
            {
              status: 'ACTIVE',
              emis: [emi(BigInt(1_000), BigInt(200), BigInt(300), BigInt(900))],
            },
          ],
        }),
      ],
    });

    const [portfolio] = await service.positionKpis({ orgId: ORG });

    expect(portfolio.totalOutstandingPrincipalPaise).toBe('900');
    expect(portfolio.totalPortfolioOutstandingPaise).toBe('900');
    expect(portfolio.totalActiveLoans).toBe(1);
  });

  it('never reports a negative principal when payment exceeds what is due', async () => {
    // An overpaid EMI floors at zero rather than subtracting from the rest of
    // the book, which would understate the portfolio.
    const service = build({
      loans: [
        loan({
          repaymentSchedules: [
            {
              status: 'ACTIVE',
              emis: [emi(BigInt(100), BigInt(50), BigInt(5_000), BigInt(0))],
            },
          ],
        }),
      ],
    });

    const [portfolio] = await service.positionKpis({ orgId: ORG });

    expect(portfolio.totalOutstandingPrincipalPaise).toBe('0');
  });

  it('reads only the ACTIVE schedule, ignoring superseded ones', async () => {
    // A rescheduled loan keeps its old schedule rows. Counting both would
    // double the outstanding balance.
    const service = build({
      loans: [
        loan({
          repaymentSchedules: [
            {
              status: 'SUPERSEDED',
              emis: [emi(BigInt(999), BigInt(0), BigInt(0), BigInt(999))],
            },
            {
              status: 'ACTIVE',
              emis: [emi(BigInt(500), BigInt(0), BigInt(0), BigInt(500))],
            },
          ],
        }),
      ],
    });

    const [portfolio] = await service.positionKpis({ orgId: ORG });

    expect(portfolio.totalPortfolioOutstandingPaise).toBe('500');
  });

  it('counts a loan as disbursed only once money actually left', async () => {
    const service = build({
      loans: [loan(), loan({ disbursementDate: null })],
    });

    const [portfolio] = await service.positionKpis({ orgId: ORG });

    expect(portfolio.totalActiveLoans).toBe(2);
    expect(portfolio.loansDisbursed).toBe(1);
    expect(portfolio.disbursedAmountPaise).toBe('100000');
  });

  it('accumulates beyond the range a double could represent exactly', async () => {
    // 2^53 paise is roughly ninety thousand crore — reachable by a real book.
    // A figure that round-tripped through Number would be silently wrong here.
    const huge = BigInt('9007199254740993'); // 2^53 + 1
    const service = build({
      loans: [
        loan({
          principalAmountPaise: huge,
          repaymentSchedules: [
            { status: 'ACTIVE', emis: [emi(huge, BigInt(0), BigInt(0), huge)] },
          ],
        }),
      ],
    });

    const [portfolio] = await service.positionKpis({ orgId: ORG });

    expect(portfolio.disbursedAmountPaise).toBe('9007199254740993');
    expect(portfolio.totalPortfolioOutstandingPaise).toBe('9007199254740993');
  });

  it('buckets overdue loans and tracks the oldest due date across them', async () => {
    const service = build({
      loans: [loan(), loan({ loanNumber: 'LN-0002' })],
      summary: {
        daysPastDue: 45,
        bucket: 'DPD_31_60',
        npaEligibility: 'STANDARD',
        totalOverduePaise: '2500',
        oldestDueDate: '2026-02-01',
      },
    });

    const [, delinquency] = await service.positionKpis({ orgId: ORG });

    expect(delinquency.overdueAccounts).toBe(2);
    expect(delinquency.overdueAmountPaise).toBe('5000');
    expect(delinquency.oldestDueDate).toBe('2026-02-01');
    expect(delinquency.buckets).toEqual([
      { bucket: 'DPD_31_60', accounts: 2, amountPaise: '5000' },
    ]);
  });

  it('counts NPA eligibility rather than committed classification', async () => {
    // The committed status lives on the recovery case; a loan with no case has
    // not been classified by anyone. This KPI answers "how much *would*".
    const service = build({
      loans: [loan()],
      summary: {
        daysPastDue: 120,
        bucket: 'DPD_90_PLUS',
        npaEligibility: 'SUB_STANDARD',
        totalOverduePaise: '7500',
      },
    });

    const [, delinquency] = await service.positionKpis({ orgId: ORG });

    expect(delinquency.npaCount).toBe(1);
    expect(delinquency.npaOutstandingPaise).toBe('7500');
  });

  it('excludes a loan that is not actually past due', async () => {
    // The SQL narrows on stored facts only; whether a loan is overdue is
    // derived afterwards, so a row can come back and still not count.
    const service = build({
      loans: [loan()],
      summary: {
        daysPastDue: 0,
        bucket: 'CURRENT',
        npaEligibility: 'STANDARD',
        totalOverduePaise: '0',
      },
    });

    const [, delinquency] = await service.positionKpis({ orgId: ORG });

    expect(delinquency.overdueAccounts).toBe(0);
    expect(delinquency.npaCount).toBe(0);
  });

  it('pages the whole book, not just the first batch', async () => {
    // 501 loans forces a second page. A loop that stopped after one would
    // under-report the portfolio by everything past row 500.
    const service = build({
      loans: Array.from({ length: 501 }, (_, index) =>
        loan({ loanNumber: `LN-${index}` }),
      ),
    });

    const [portfolio] = await service.positionKpis({ orgId: ORG });

    expect(portfolio.totalActiveLoans).toBe(501);
  });

  it('narrows the query by branch when the scope carries one', async () => {
    const recorded: Record<string, unknown>[] = [];
    const prisma = {
      loan: {
        findMany: (args: { where: Record<string, unknown> }) => {
          recorded.push(args.where);
          return Promise.resolve([]);
        },
      },
    } as unknown as PrismaService;
    const overdue = { deriveSummary: () => ({}) } as unknown as OverdueService;

    await new KpiService(prisma, overdue).positionKpis({
      orgId: ORG,
      branchId: BRANCH,
    });

    // Inside the `where`, not applied to the rows afterwards — a service that
    // filtered post-query would still leak the rows it fetched.
    expect(recorded[0]).toMatchObject({ orgId: ORG, branchId: BRANCH });
  });
});

describe('KpiService.collectionKpis', () => {
  it('computes the rate as integer basis points', async () => {
    const service = build({
      aggregates: {
        _sum: {
          amountPaise: BigInt(7_500),
          totalDuePaise: BigInt(10_000),
          handedOverCashPaise: BigInt(0),
          actualCashPaise: BigInt(0),
        },
      },
    });

    const result = await service.collectionKpis({ orgId: ORG });

    // 7500/10000 = 75% = 7500 bps. A float would have been 0.75 and lost.
    expect(result.collectionRateBps).toBe('7500');
    expect(result.collectionDuePaise).toBe('10000');
    expect(result.collectionReceivedPaise).toBe('7500');
  });

  it('truncates rather than rounding, so the rate never overstates', async () => {
    const service = build({
      aggregates: {
        _sum: {
          amountPaise: BigInt(1),
          totalDuePaise: BigInt(3),
          handedOverCashPaise: BigInt(0),
          actualCashPaise: BigInt(0),
        },
      },
    });

    const result = await service.collectionKpis({ orgId: ORG });

    // 1/3 = 3333.33... bps. Integer division floors, so 3333.
    expect(result.collectionRateBps).toBe('3333');
  });

  it('returns a zero rate when nothing is due, rather than dividing by zero', async () => {
    // A new branch has nothing due. That is its ordinary state, not an error.
    const service = build({
      aggregates: {
        _sum: {
          amountPaise: BigInt(0),
          totalDuePaise: BigInt(0),
          handedOverCashPaise: BigInt(0),
          actualCashPaise: BigInt(0),
        },
      },
    });

    const result = await service.collectionKpis({ orgId: ORG });

    expect(result.collectionRateBps).toBe('0');
  });

  it('treats a null aggregate as zero, not as a missing field', async () => {
    // Prisma returns null from `_sum` when no rows matched at all.
    const result = await build().collectionKpis({ orgId: ORG });

    expect(result).toEqual({
      collectionDuePaise: '0',
      collectionReceivedPaise: '0',
      collectionRateBps: '0',
      cashPendingReconciliationPaise: '0',
      reconciledAmountPaise: '0',
    });
  });

  it('counts only posted collections', async () => {
    const recorded: Record<string, unknown>[] = [];
    const capture = (args: { where: Record<string, unknown> }): unknown => {
      recorded.push(args.where);
      return Promise.resolve({ _sum: {} });
    };
    const prisma = {
      collection: { aggregate: capture },
      emi: { aggregate: capture },
      cashHandover: { aggregate: capture },
      cashReconciliation: { aggregate: capture },
    } as unknown as PrismaService;
    const overdue = { deriveSummary: () => ({}) } as unknown as OverdueService;

    await new KpiService(prisma, overdue).collectionKpis({ orgId: ORG });

    // Rule 21 and Scenario 15: a pending, failed or rejected attempt is not a
    // collection, and must never be counted as one.
    expect(recorded[0]).toMatchObject({ status: 'POSTED' });
  });

  it('applies the range to the date column each source owns', async () => {
    const recorded: Record<string, unknown>[] = [];
    const capture = (args: { where: Record<string, unknown> }): unknown => {
      recorded.push(args.where);
      return Promise.resolve({ _sum: {} });
    };
    const prisma = {
      collection: { aggregate: capture },
      emi: { aggregate: capture },
      cashHandover: { aggregate: capture },
      cashReconciliation: { aggregate: capture },
    } as unknown as PrismaService;
    const overdue = { deriveSummary: () => ({}) } as unknown as OverdueService;
    const range = { gte: new Date('2026-01-01'), lt: new Date('2026-02-01') };

    await new KpiService(prisma, overdue).collectionKpis({ orgId: ORG }, range);

    // Received is filtered by when money arrived; due by when it was owed.
    // Rule 11 forbids collapsing the two bases into one filter.
    expect(recorded[0]).toHaveProperty('collectionDate', range);
    expect(recorded[1]).toHaveProperty('dueDate', range);
    expect(recorded[2]).toHaveProperty('businessDate', range);
  });

  it('omits every date filter when no range is given', async () => {
    const recorded: Record<string, unknown>[] = [];
    const capture = (args: { where: Record<string, unknown> }): unknown => {
      recorded.push(args.where);
      return Promise.resolve({ _sum: {} });
    };
    const prisma = {
      collection: { aggregate: capture },
      emi: { aggregate: capture },
      cashHandover: { aggregate: capture },
      cashReconciliation: { aggregate: capture },
    } as unknown as PrismaService;
    const overdue = { deriveSummary: () => ({}) } as unknown as OverdueService;

    await new KpiService(prisma, overdue).collectionKpis({ orgId: ORG });

    expect(recorded[0]).not.toHaveProperty('collectionDate');
    expect(recorded[1]).not.toHaveProperty('dueDate');
  });

  it('reaches branch through the loan relation for EMIs', async () => {
    // `Emi` carries no branchId of its own; it reaches branch through its loan.
    // Naming a column that does not exist compiles and fails at query time.
    const recorded: Record<string, unknown>[] = [];
    const capture = (args: { where: Record<string, unknown> }): unknown => {
      recorded.push(args.where);
      return Promise.resolve({ _sum: {} });
    };
    const prisma = {
      collection: { aggregate: capture },
      emi: { aggregate: capture },
      cashHandover: { aggregate: capture },
      cashReconciliation: { aggregate: capture },
    } as unknown as PrismaService;
    const overdue = { deriveSummary: () => ({}) } as unknown as OverdueService;

    await new KpiService(prisma, overdue).collectionKpis({
      orgId: ORG,
      branchId: BRANCH,
    });

    expect(recorded[1]).toMatchObject({ loan: { branchId: BRANCH } });
    expect(recorded[1]).not.toHaveProperty('branchId');
  });
});

describe('KpiService.recoveryKpis', () => {
  it('returns zeroes when there are no cases', async () => {
    const result = await build().recoveryKpis({ orgId: ORG });

    expect(result).toEqual({
      openCases: 0,
      assignedCases: 0,
      promiseToPayAmountPaise: '0',
      recoveredAmountPaise: '0',
      escalatedCases: 0,
    });
  });

  it('reports open, assigned and escalated counts separately', async () => {
    // Assigned is a subset of open, and escalated spans both — three questions
    // that a single "cases" number could not answer.
    const service = build({
      counts: [10, 6, 3],
      aggregates: {
        _sum: {
          recoveredAmountPaise: BigInt(45_000),
          promiseToPayAmountPaise: BigInt(12_000),
        },
      },
    });

    const result = await service.recoveryKpis({ orgId: ORG });

    expect(result.openCases).toBe(10);
    expect(result.assignedCases).toBe(6);
    expect(result.escalatedCases).toBe(3);
    expect(result.recoveredAmountPaise).toBe('45000');
  });

  it('reports promise-to-pay without subtracting it from anything', async () => {
    // Scenario 23 is explicit: a promise does not reduce an outstanding
    // balance. It is reported alongside, never netted off.
    const service = build({
      counts: [4, 2, 0],
      aggregates: {
        _sum: {
          recoveredAmountPaise: BigInt(1_000),
          promiseToPayAmountPaise: BigInt(50_000),
        },
      },
    });

    const result = await service.recoveryKpis({ orgId: ORG });

    expect(result.promiseToPayAmountPaise).toBe('50000');
    expect(result.recoveredAmountPaise).toBe('1000');
  });
});
