/**
 * Tests for the general ledger and the trial balance (Scenarios 32-34).
 *
 * Three properties here are load-bearing beyond ordinary coverage:
 *
 *  - **The running balance is the server's.** It continues from an opening
 *    balance and carries across pages. A client computing it would be wrong on
 *    any page but the first, because a page of rows does not know what came
 *    before it.
 *  - **A REVERSED entry still counts.** Its own lines are real; the reversing
 *    entry's opposite lines are what net it to zero. Excluding it would count
 *    the reversal without counting what it reversed.
 *  - **The balance's side comes from its sign, not the account's convention.**
 *    An asset that has gone into credit belongs in the credit column, and
 *    reporting it as a negative debit would make the columns fail to add up.
 */

import { NotFoundException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { GeneralLedgerService } from './general-ledger.service';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const BRANCH_ID = '44444444-4444-4444-4444-444444444444';
const BANK = 'aaaaaaaa-0000-4000-8000-000000000001';
const INCOME = 'aaaaaaaa-0000-4000-8000-000000000002';

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: SESSION_ID,
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['accounting.ledger.view'],
    ...overrides,
  };
}

const ACCOUNTS = [
  {
    accountId: BANK,
    accountCode: '1200',
    accountName: 'Bank Account',
    accountType: 'ASSET',
    normalBalance: 'DEBIT',
  },
  {
    accountId: INCOME,
    accountCode: '4100',
    accountName: 'Interest Income',
    accountType: 'INCOME',
    normalBalance: 'CREDIT',
  },
];

interface LineFixture {
  journalLineId: string;
  accountId: string;
  debitPaise: bigint;
  creditPaise: bigint;
  lineNumber: number;
  entryNumber: string;
  entryDate: Date;
}

function line(overrides: Partial<LineFixture> = {}): LineFixture {
  return {
    journalLineId: 'line-1',
    accountId: BANK,
    debitPaise: 0n,
    creditPaise: 0n,
    lineNumber: 1,
    entryNumber: 'JE-000001',
    entryDate: new Date('2026-08-10T00:00:00Z'),
    ...overrides,
  };
}

function buildPrisma(lines: LineFixture[]) {
  const decorate = (l: LineFixture) => ({
    journalLineId: l.journalLineId,
    debitPaise: l.debitPaise,
    creditPaise: l.creditPaise,
    lineNumber: l.lineNumber,
    journalEntry: {
      journalEntryId: `entry-${l.entryNumber}`,
      entryNumber: l.entryNumber,
      entryDate: l.entryDate,
      description: 'Test entry',
      sourceType: 'COLLECTION',
      sourceId: 'source-1',
      postedAt: new Date('2026-08-10T12:00:00Z'),
    },
  });

  const forAccount = (where: Record<string, unknown>) =>
    lines.filter((l) => l.accountId === where.accountId);

  const journalLine = {
    findMany: jest.fn(
      ({
        where,
        skip,
        take,
      }: {
        where: Record<string, unknown>;
        skip?: number;
        take?: number;
      }) => {
        const matched = forAccount(where);
        const start = skip ?? 0;
        const end = take === undefined ? undefined : start + take;
        return Promise.resolve(matched.slice(start, end).map(decorate));
      },
    ),
    count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(forAccount(where).length),
    ),
    aggregate: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      const matched = forAccount(where);
      return Promise.resolve({
        _sum: {
          debitPaise: matched.reduce((s, l) => s + l.debitPaise, 0n),
          creditPaise: matched.reduce((s, l) => s + l.creditPaise, 0n),
        },
      });
    }),
    groupBy: jest.fn(() =>
      Promise.resolve(
        ACCOUNTS.map((a) => {
          const matched = lines.filter((l) => l.accountId === a.accountId);
          return {
            accountId: a.accountId,
            _sum: {
              debitPaise: matched.reduce((s, l) => s + l.debitPaise, 0n),
              creditPaise: matched.reduce((s, l) => s + l.creditPaise, 0n),
            },
          };
        }),
      ),
    ),
  };

  const account = {
    findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      if (typeof where.orgId !== 'string') {
        throw new Error('Query issued without an orgId filter');
      }
      return Promise.resolve(
        ACCOUNTS.find((a) => a.accountId === where.accountId) ?? null,
      );
    }),
    findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      if (typeof where.orgId !== 'string') {
        throw new Error('Query issued without an orgId filter');
      }
      return Promise.resolve(ACCOUNTS);
    }),
  };

  return { prisma: { journalLine, account }, journalLine, account };
}

function buildService(lines: LineFixture[] = []) {
  const { prisma, journalLine, account } = buildPrisma(lines);
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new GeneralLedgerService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, audit, journalLine, account };
}

describe('GeneralLedgerService.ledger', () => {
  it('refuses an unknown account with 404', async () => {
    const { service } = buildService();

    await expect(
      service.ledger(
        actor(),
        { accountId: '00000000-0000-4000-8000-000000000099' },
        META,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('carries a running balance forward across rows', async () => {
    // Scenario 32.
    const { service } = buildService([
      line({ journalLineId: 'l1', debitPaise: 10000n, entryNumber: 'JE-1' }),
      line({ journalLineId: 'l2', debitPaise: 5000n, entryNumber: 'JE-2' }),
      line({ journalLineId: 'l3', creditPaise: 3000n, entryNumber: 'JE-3' }),
    ]);

    const page = await service.ledger(actor(), { accountId: BANK }, META);

    expect(page.rows.map((r) => r.runningBalancePaise)).toEqual([
      '10000',
      '15000',
      '12000',
    ]);
  });

  it('signs a CREDIT-normal account the other way round', async () => {
    // Interest Income rises on the credit side, so a credit increases its
    // balance rather than reducing it.
    const { service } = buildService([
      line({
        journalLineId: 'l1',
        accountId: INCOME,
        creditPaise: 8000n,
        entryNumber: 'JE-1',
      }),
      line({
        journalLineId: 'l2',
        accountId: INCOME,
        creditPaise: 2000n,
        entryNumber: 'JE-2',
      }),
    ]);

    const page = await service.ledger(actor(), { accountId: INCOME }, META);

    expect(page.rows.map((r) => r.runningBalancePaise)).toEqual([
      '8000',
      '10000',
    ]);
    expect(page.closingBalancePaise).toBe('10000');
  });

  it('reports a negative balance rather than flipping the sign', async () => {
    // An asset account driven into credit is a real state and the ledger has to
    // be able to say so.
    const { service } = buildService([
      line({ journalLineId: 'l1', creditPaise: 7000n, entryNumber: 'JE-1' }),
    ]);

    const page = await service.ledger(actor(), { accountId: BANK }, META);

    expect(page.rows[0]?.runningBalancePaise).toBe('-7000');
  });

  it('serializes every amount as a string, never a number', async () => {
    // A bigint serialized by JSON.stringify throws; one coerced to Number loses
    // precision above 2^53.
    const { service } = buildService([
      line({ journalLineId: 'l1', debitPaise: 9000000000000001n }),
    ]);

    const page = await service.ledger(actor(), { accountId: BANK }, META);

    expect(page.rows[0]?.debitPaise).toBe('9000000000000001');
    expect(typeof page.rows[0]?.runningBalancePaise).toBe('string');
  });

  it('audits the read', async () => {
    const { service, audit } = buildService();

    await service.ledger(actor(), { accountId: BANK }, META);

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LEDGER_VIEWED }),
    );
  });

  it('confines a branch actor’s query to their branch', async () => {
    const { service, journalLine } = buildService([line()]);

    await service.ledger(
      actor({ branchId: BRANCH_ID }),
      { accountId: BANK },
      META,
    );

    const call = journalLine.count.mock.calls[0]?.[0] as {
      where: { journalEntry: Record<string, unknown> };
    };

    expect(call.where.journalEntry).toMatchObject({ branchId: BRANCH_ID });
  });

  it('applies no branch filter for an organization-wide actor', async () => {
    const { service, journalLine } = buildService([line()]);

    await service.ledger(actor({ branchId: null }), { accountId: BANK }, META);

    const call = journalLine.count.mock.calls[0]?.[0] as {
      where: { journalEntry: Record<string, unknown> };
    };

    expect(call.where.journalEntry).not.toHaveProperty('branchId');
  });

  it('counts a REVERSED entry, because its own lines are still real', async () => {
    // The reversing entry's opposite lines are what net it to zero; excluding
    // REVERSED would count the reversal without counting what it reversed.
    const { service, journalLine } = buildService([line()]);

    await service.ledger(actor(), { accountId: BANK }, META);

    const call = journalLine.count.mock.calls[0]?.[0] as {
      where: { journalEntry: { status: { in: string[] } } };
    };

    expect(call.where.journalEntry.status.in).toEqual(['POSTED', 'REVERSED']);
  });
});

describe('GeneralLedgerService.trialBalance', () => {
  it('ties out across every account', async () => {
    // The assertion the whole module exists to make. Every posted entry
    // balances individually, so their sum must balance too.
    const { service } = buildService([
      line({ journalLineId: 'l1', accountId: BANK, debitPaise: 50000n }),
      line({ journalLineId: 'l2', accountId: INCOME, creditPaise: 50000n }),
    ]);

    const trial = await service.trialBalance(actor(), {}, META);

    expect(trial.totalDebitPaise).toBe('50000');
    expect(trial.totalCreditPaise).toBe('50000');
    expect(trial.balanced).toBe(true);
  });

  it('reports an imbalance rather than throwing', async () => {
    // `balanced: false` means the ledger is broken, not that a form was wrong.
    // Reported so the operator can see which accounts are involved.
    const { service } = buildService([
      line({ journalLineId: 'l1', accountId: BANK, debitPaise: 50000n }),
      line({ journalLineId: 'l2', accountId: INCOME, creditPaise: 40000n }),
    ]);

    const trial = await service.trialBalance(actor(), {}, META);

    expect(trial.balanced).toBe(false);
    expect(trial.rows).toHaveLength(2);
  });

  it('puts each balance on the side its sign says, not its convention', async () => {
    // A bank account in credit belongs in the credit column. Reporting it as a
    // negative debit would make the columns fail to add up.
    const { service } = buildService([
      line({ journalLineId: 'l1', accountId: BANK, creditPaise: 7000n }),
    ]);

    const trial = await service.trialBalance(actor(), {}, META);
    const bank = trial.rows.find((r) => r.accountCode === '1200');

    expect(bank?.normalBalance).toBe('DEBIT');
    expect(bank?.balanceSide).toBe('CREDIT');
    expect(bank?.balancePaise).toBe('7000');
  });

  it('omits zero-balance accounts by default', async () => {
    // A chart of accounts is mostly zeroes on any given day, and a report that
    // is mostly zeroes hides the rows that matter.
    const { service } = buildService([
      line({ journalLineId: 'l1', accountId: BANK, debitPaise: 50000n }),
    ]);

    const trial = await service.trialBalance(actor(), {}, META);

    expect(trial.rows.map((r) => r.accountCode)).toEqual(['1200']);
  });

  it('includes them when asked', async () => {
    const { service } = buildService([
      line({ journalLineId: 'l1', accountId: BANK, debitPaise: 50000n }),
    ]);

    const trial = await service.trialBalance(
      actor(),
      { includeZero: true },
      META,
    );

    expect(trial.rows.map((r) => r.accountCode)).toEqual(['1200', '4100']);
  });

  it('defaults to today’s business date', async () => {
    const { service } = buildService();

    const trial = await service.trialBalance(actor(), {}, META);

    expect(trial.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('audits the read', async () => {
    const { service, audit } = buildService();

    await service.trialBalance(actor(), {}, META);

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.TRIAL_BALANCE_VIEWED }),
    );
  });
});
