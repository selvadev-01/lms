import { ConflictException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import type { TransitionTx } from '../applications/application-transition.service';
import { LedgerService } from './ledger.service';
import {
  BANK_ACCOUNT_CODE,
  CASH_ACCOUNT_CODE,
  FEE_INCOME_ACCOUNT_CODE,
  FIELD_AGENT_CASH_ACCOUNT_CODE,
  INTEREST_INCOME_ACCOUNT_CODE,
  LOAN_RECEIVABLE_ACCOUNT_CODE,
  PENALTY_INCOME_ACCOUNT_CODE,
} from './ledger-accounts';

/**
 * Module 09 — the ledger posting.
 *
 * Three assertions here are load-bearing in the sense that a plausible tidy-up
 * would break them silently:
 *
 * 1. **The entry balances, and the check is in TypeScript as well as in the
 *    database.** The deferred trigger is the real guarantee, but a reviewer who
 *    notices the duplication and deletes `assertBalanced` would leave every
 *    unbalanced entry surfacing as an opaque Postgres error mid-transaction
 *    rather than a message naming the two amounts.
 * 2. **Entry numbers are allocated numerically, never lexically.** A lexical
 *    max ranks `JE-ZZ04` above `JE-000007` and proposes a number that already
 *    exists — the same trap `nextSanctionNumber` documents.
 * 3. **An inactive account is refused before any line is written.** Rule 59 and
 *    Scenarios 34/36 need this to happen inside the transaction, against rows
 *    read there, or an account deactivated after scheduling still funds a loan.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const LOAN_ID = '44444444-4444-4444-4444-444444444444';
const BRANCH_ID = '55555555-5555-5555-5555-555555555555';
const CUSTOMER_ID = '66666666-6666-6666-6666-666666666666';
const DISBURSEMENT_ID = '77777777-7777-7777-7777-777777777777';

interface AccountRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  status: 'ACTIVE' | 'INACTIVE';
}

interface EntryRow {
  journalEntryId: string;
  entryNumber: string;
  entryDate: Date;
  postedAt: Date;
  entryType: string;
  status: string;
  sourceType: string | null;
  sourceId: string | null;
  description: string | null;
  createdBy: string;
  /** Module 14 additions. Null here would mean the service stopped writing them. */
  postedBy: string | null;
  branchId: string | null;
}

interface LineRow {
  journalLineId: string;
  journalEntryId: string;
  lineNumber: number;
  accountId: string;
  dimensionId: string | null;
  debitPaise: bigint;
  creditPaise: bigint;
  description: string | null;
  sourceComponent: string | null;
}

/**
 * A stand-in that stores what it is given and reads it back.
 *
 * Faithful enough to matter: `journalLine.findMany` returns the rows actually
 * written, so `assertBalanced` computes over real data. A stub returning a
 * fixed balanced pair would make the balance test vacuous.
 */
function buildTx(accounts: AccountRow[]): {
  tx: TransitionTx;
  entries: EntryRow[];
  lines: LineRow[];
  dimensions: {
    dimensionId: string;
    accountId: string;
    branchId: string | null;
    loanId: string | null;
    customerId: string | null;
    /** Module 12. Set only on a line representing an agent's own cash. */
    userId: string | null;
  }[];
} {
  const entries: EntryRow[] = [];
  const lines: LineRow[] = [];
  const dimensions: {
    dimensionId: string;
    accountId: string;
    branchId: string | null;
    loanId: string | null;
    customerId: string | null;
    userId: string | null;
  }[] = [];

  const tx = {
    account: {
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: { orgId: string; accountCode?: string; accountId?: string };
        }) =>
          Promise.resolve(
            accounts.find(
              (a) =>
                (where.accountCode === undefined ||
                  a.accountCode === where.accountCode) &&
                (where.accountId === undefined ||
                  a.accountId === where.accountId),
            ) ?? null,
          ),
      ),
    },
    accountDimension: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          dimensionId: `dim-${dimensions.length + 1}`,
          accountId: data.accountId as string,
          branchId: (data.branchId as string) ?? null,
          loanId: (data.loanId as string) ?? null,
          customerId: (data.customerId as string) ?? null,
          userId: (data.userId as string) ?? null,
        };
        dimensions.push(row);
        return Promise.resolve(row);
      }),
    },
    journalEntry: {
      findMany: jest.fn(() =>
        Promise.resolve(entries.map((e) => ({ entryNumber: e.entryNumber }))),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row: EntryRow = {
          journalEntryId: `entry-${entries.length + 1}`,
          entryNumber: data.entryNumber as string,
          entryDate: data.entryDate as Date,
          postedAt: data.postedAt as Date,
          entryType: data.entryType as string,
          status: data.status as string,
          sourceType: (data.sourceType as string) ?? null,
          sourceId: (data.sourceId as string) ?? null,
          description: (data.description as string) ?? null,
          createdBy: data.createdBy as string,
          postedBy: (data.postedBy as string) ?? null,
          branchId: (data.branchId as string) ?? null,
        };
        entries.push(row);
        return Promise.resolve(row);
      }),
    },
    journalLine: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row: LineRow = {
          journalLineId: `line-${lines.length + 1}`,
          journalEntryId: data.journalEntryId as string,
          lineNumber: data.lineNumber as number,
          accountId: data.accountId as string,
          dimensionId: (data.dimensionId as string) ?? null,
          debitPaise: data.debitPaise as bigint,
          creditPaise: data.creditPaise as bigint,
          description: (data.description as string) ?? null,
          sourceComponent: (data.sourceComponent as string) ?? null,
        };
        lines.push(row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn(({ where }: { where: { journalEntryId: string } }) =>
        Promise.resolve(
          lines.filter((l) => l.journalEntryId === where.journalEntryId),
        ),
      ),
    },
  } as unknown as TransitionTx;

  return { tx, entries, lines, dimensions };
}

const ACCOUNTS: AccountRow[] = [
  {
    accountId: 'acc-receivable',
    accountCode: LOAN_RECEIVABLE_ACCOUNT_CODE,
    accountName: 'Loan Receivable',
    status: 'ACTIVE',
  },
  {
    accountId: 'acc-bank',
    accountCode: BANK_ACCOUNT_CODE,
    accountName: 'Bank Account',
    status: 'ACTIVE',
  },
  {
    accountId: 'acc-cash',
    accountCode: CASH_ACCOUNT_CODE,
    accountName: 'Cash in Hand',
    status: 'ACTIVE',
  },
];

function input(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG_ID,
    loanId: LOAN_ID,
    branchId: BRANCH_ID,
    customerId: CUSTOMER_ID,
    amountPaise: 10_000_000n,
    paymentMode: 'BANK_TRANSFER' as const,
    entryDate: new Date('2026-08-21T12:00:00+05:30'),
    disbursementId: DISBURSEMENT_ID,
    loanNumber: 'LN-000001',
    createdBy: USER_ID,
    ...overrides,
  };
}

function service(): LedgerService {
  return new LedgerService({} as unknown as PrismaService);
}

describe('LedgerService.postDisbursement', () => {
  // Scenarios 19, 21.
  it('posts two lines whose debit and credit totals are equal', async () => {
    const { tx, lines } = buildTx(ACCOUNTS);

    await service().postDisbursement(tx, input());

    expect(lines).toHaveLength(2);

    const debit = lines.reduce((s, l) => s + l.debitPaise, 0n);
    const credit = lines.reduce((s, l) => s + l.creditPaise, 0n);

    expect(debit).toBe(10_000_000n);
    expect(credit).toBe(10_000_000n);
    expect(debit).toBe(credit);
  });

  it('debits loan receivable and credits the funding account', async () => {
    const { tx, lines } = buildTx(ACCOUNTS);

    await service().postDisbursement(tx, input());

    const [debitLine, creditLine] = lines;
    expect(debitLine?.accountId).toBe('acc-receivable');
    expect(debitLine?.debitPaise).toBe(10_000_000n);
    expect(debitLine?.creditPaise).toBe(0n);

    expect(creditLine?.accountId).toBe('acc-bank');
    expect(creditLine?.creditPaise).toBe(10_000_000n);
    expect(creditLine?.debitPaise).toBe(0n);
  });

  /** Scenario 15: cash draws from the drawer, not the bank. */
  it('credits the cash account for a cash disbursal', async () => {
    const { tx, lines } = buildTx(ACCOUNTS);

    await service().postDisbursement(tx, input({ paymentMode: 'CASH' }));

    expect(lines[1]?.accountId).toBe('acc-cash');
  });

  /** UPI settles through a bank, so it must not reach for the cash drawer. */
  it('credits the bank account for a UPI disbursal', async () => {
    const { tx, lines } = buildTx(ACCOUNTS);

    await service().postDisbursement(tx, input({ paymentMode: 'UPI' }));

    expect(lines[1]?.accountId).toBe('acc-bank');
  });

  /** Scenario 49: the entry must be traceable back to what caused it. */
  it('records the disbursement as the entry source', async () => {
    const { tx, entries } = buildTx(ACCOUNTS);

    await service().postDisbursement(tx, input());

    expect(entries[0]).toMatchObject({
      entryType: 'DISBURSEMENT',
      status: 'POSTED',
      sourceType: 'DISBURSEMENT',
      sourceId: DISBURSEMENT_ID,
    });
  });

  it('carries branch and loan on every line dimension', async () => {
    const { tx, dimensions } = buildTx(ACCOUNTS);

    await service().postDisbursement(tx, input());

    expect(dimensions).toHaveLength(2);
    for (const dimension of dimensions) {
      expect(dimension.branchId).toBe(BRANCH_ID);
      expect(dimension.loanId).toBe(LOAN_ID);
    }
  });

  // Scenarios 34, 36.
  it('refuses an inactive funding account before writing any line', async () => {
    const { tx, lines, entries } = buildTx([
      ACCOUNTS[0],
      { ...ACCOUNTS[1], status: 'INACTIVE' },
      ACCOUNTS[2],
    ]);

    await expect(service().postDisbursement(tx, input())).rejects.toThrow(
      ConflictException,
    );

    expect(entries).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it('refuses when a required account is not configured', async () => {
    const { tx } = buildTx([ACCOUNTS[0]]);

    await expect(service().postDisbursement(tx, input())).rejects.toThrow(
      /not configured/,
    );
  });

  // Scenario 7. Reached only if a caller skipped its own check.
  it('refuses a zero amount', async () => {
    const { tx, lines } = buildTx(ACCOUNTS);

    await expect(
      service().postDisbursement(tx, input({ amountPaise: 0n })),
    ).rejects.toThrow(/greater than zero/);

    expect(lines).toHaveLength(0);
  });

  it('refuses a negative amount', async () => {
    const { tx } = buildTx(ACCOUNTS);

    await expect(
      service().postDisbursement(tx, input({ amountPaise: -1n })),
    ).rejects.toThrow(/greater than zero/);
  });

  /**
   * Paise above Number.MAX_SAFE_INTEGER. A stage that converted to `number`
   * anywhere would round this and the balance assertion would still pass —
   * which is why the equality is checked against the exact input.
   */
  it('posts an amount larger than a JS safe integer without rounding', async () => {
    const { tx, lines } = buildTx(ACCOUNTS);
    const huge = 9_007_199_254_740_993n;

    await service().postDisbursement(tx, input({ amountPaise: huge }));

    expect(lines[0]?.debitPaise).toBe(huge);
    expect(lines[1]?.creditPaise).toBe(huge);
  });
});

describe('LedgerService entry numbering', () => {
  it('starts at JE-000001', async () => {
    const { tx, entries } = buildTx(ACCOUNTS);

    await service().postDisbursement(tx, input());

    expect(entries[0]?.entryNumber).toBe('JE-000001');
  });

  it('increments across postings', async () => {
    const { tx, entries } = buildTx(ACCOUNTS);
    const ledger = service();

    await ledger.postDisbursement(tx, input());
    await ledger.postDisbursement(tx, input());

    expect(entries.map((e) => e.entryNumber)).toEqual([
      'JE-000001',
      'JE-000002',
    ]);
  });

  /**
   * The trap `nextSanctionNumber` documents. A lexical max over these strings
   * returns `JE-ZZ04`, whose numeric parse is NaN — and the next number
   * proposed would be `JE-000008`, which already exists.
   */
  it('takes the numeric maximum, ignoring non-numeric numbers', async () => {
    const { tx, entries } = buildTx(ACCOUNTS);

    entries.push(
      { entryNumber: 'JE-000007' } as EntryRow,
      { entryNumber: 'JE-ZZ04' } as EntryRow,
      { entryNumber: 'JE-000002' } as EntryRow,
    );

    await service().postDisbursement(tx, input());

    expect(entries.at(-1)?.entryNumber).toBe('JE-000008');
  });

  it('pads to six digits', async () => {
    const { tx, entries } = buildTx(ACCOUNTS);

    entries.push({ entryNumber: 'JE-000042' } as EntryRow);

    await service().postDisbursement(tx, input());

    expect(entries.at(-1)?.entryNumber).toBe('JE-000043');
  });
});

/**
 * Module 11 — the collection posting.
 *
 * The property that matters most here is **which account the principal
 * credits**. Disbursal debited Loan Receivable for the sanctioned principal
 * alone, so a repayment retires that asset only to the extent of its principal
 * portion; interest and penalty were never receivables and are recognised as
 * income. Crediting an "interest receivable" — which is literally what the
 * source asks for — would drive an account that never had a balance
 * increasingly negative. See the header of `ledger-accounts.ts`.
 */
const COLLECTION_ACCOUNTS: AccountRow[] = [
  ...ACCOUNTS,
  {
    accountId: 'acc-interest-income',
    accountCode: INTEREST_INCOME_ACCOUNT_CODE,
    accountName: 'Interest Income',
    status: 'ACTIVE',
  },
  {
    accountId: 'acc-penalty-income',
    accountCode: PENALTY_INCOME_ACCOUNT_CODE,
    accountName: 'Penalty Income',
    status: 'ACTIVE',
  },
  {
    accountId: 'acc-fee-income',
    accountCode: FEE_INCOME_ACCOUNT_CODE,
    accountName: 'Fee Income',
    status: 'ACTIVE',
  },
];

const COLLECTION_ID = '88888888-8888-8888-8888-888888888888';

const STANDARD_COMPONENTS = {
  penaltyPaise: 10_000n,
  interestPaise: 200_000n,
  principalPaise: 790_000n,
  feesPaise: 0n,
};

function collectionInput(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG_ID,
    loanId: LOAN_ID,
    branchId: BRANCH_ID,
    customerId: CUSTOMER_ID,
    collectionId: COLLECTION_ID,
    receiptNumber: 'RCP-BR001-000001',
    loanNumber: 'LN-000001',
    paymentMode: 'CASH' as const,
    entryDate: new Date('2026-08-22T12:00:00+05:30'),
    createdBy: USER_ID,
    components: STANDARD_COMPONENTS,
    ...overrides,
  };
}

/** Account code, side and amount for each line, in line order. */
function shapeOf(lines: LineRow[], entryId: string) {
  return lines
    .filter((line) => line.journalEntryId === entryId)
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map((line) => {
      const code = COLLECTION_ACCOUNTS.find(
        (a) => a.accountId === line.accountId,
      )!.accountCode;
      const side = line.debitPaise > 0n ? 'Dr' : 'Cr';
      const amount = line.debitPaise > 0n ? line.debitPaise : line.creditPaise;
      return `${code}${side}${amount}`;
    });
}

describe('LedgerService.postCollection', () => {
  it('debits cash and credits penalty, interest and principal in order', async () => {
    const { tx, entries, lines } = buildTx(COLLECTION_ACCOUNTS);

    const entryId = await service().postCollection(tx, collectionInput());

    expect(shapeOf(lines, entryId)).toEqual([
      `${CASH_ACCOUNT_CODE}Dr1000000`,
      `${PENALTY_INCOME_ACCOUNT_CODE}Cr10000`,
      `${INTEREST_INCOME_ACCOUNT_CODE}Cr200000`,
      `${LOAN_RECEIVABLE_ACCOUNT_CODE}Cr790000`,
    ]);
    expect(entries.at(-1)?.entryType).toBe('COLLECTION');
    expect(entries.at(-1)?.sourceType).toBe('COLLECTION');
    expect(entries.at(-1)?.sourceId).toBe(COLLECTION_ID);
  });

  it('credits Loan Receivable for the principal alone, never the whole receipt', async () => {
    // The single most consequential assertion in this file. Crediting the full
    // collected amount to 1100 would retire an asset that was never raised.
    const { tx, lines } = buildTx(COLLECTION_ACCOUNTS);

    const entryId = await service().postCollection(tx, collectionInput());

    const receivable = lines.filter(
      (line) =>
        line.journalEntryId === entryId && line.accountId === 'acc-receivable',
    );

    expect(receivable).toHaveLength(1);
    expect(receivable[0].creditPaise).toBe(790_000n);
    expect(receivable[0].debitPaise).toBe(0n);
  });

  it.each([
    ['CASH', CASH_ACCOUNT_CODE],
    ['UPI', BANK_ACCOUNT_CODE],
    ['BANK_TRANSFER', BANK_ACCOUNT_CODE],
  ])('debits the funding account for %s', async (paymentMode, expected) => {
    const { tx, lines } = buildTx(COLLECTION_ACCOUNTS);

    const entryId = await service().postCollection(
      tx,
      collectionInput({ paymentMode }),
    );

    const debit = lines.find(
      (line) => line.journalEntryId === entryId && line.debitPaise > 0n,
    )!;

    expect(
      COLLECTION_ACCOUNTS.find((a) => a.accountId === debit.accountId)!
        .accountCode,
    ).toBe(expected);
  });

  it('omits a component that is zero rather than writing an empty line', async () => {
    const { tx, lines } = buildTx(COLLECTION_ACCOUNTS);

    const entryId = await service().postCollection(
      tx,
      collectionInput({
        components: {
          penaltyPaise: 0n,
          interestPaise: 0n,
          principalPaise: 500_000n,
          feesPaise: 0n,
        },
      }),
    );

    // Two lines only, numbered 1 and 2 — contiguous, not 1 and 4.
    expect(shapeOf(lines, entryId)).toEqual([
      `${CASH_ACCOUNT_CODE}Dr500000`,
      `${LOAN_RECEIVABLE_ACCOUNT_CODE}Cr500000`,
    ]);
    expect(
      lines
        .filter((line) => line.journalEntryId === entryId)
        .map((line) => line.lineNumber),
    ).toEqual([1, 2]);
  });

  it('balances for every split of a fixed amount', async () => {
    for (const components of [
      {
        penaltyPaise: 1n,
        interestPaise: 1n,
        principalPaise: 999_998n,
        feesPaise: 0n,
      },
      {
        penaltyPaise: 1_000_000n,
        interestPaise: 0n,
        principalPaise: 0n,
        feesPaise: 0n,
      },
      {
        penaltyPaise: 0n,
        interestPaise: 999_000n,
        principalPaise: 1_000n,
        feesPaise: 0n,
      },
      {
        penaltyPaise: 250_000n,
        interestPaise: 250_000n,
        principalPaise: 250_000n,
        feesPaise: 250_000n,
      },
    ]) {
      const { tx, lines } = buildTx(COLLECTION_ACCOUNTS);
      const entryId = await service().postCollection(
        tx,
        collectionInput({ components }),
      );

      const own = lines.filter((line) => line.journalEntryId === entryId);
      const debit = own.reduce((sum, line) => sum + line.debitPaise, 0n);
      const credit = own.reduce((sum, line) => sum + line.creditPaise, 0n);

      expect(debit).toBe(credit);
      expect(debit).toBe(1_000_000n);
    }
  });

  it('refuses a zero-total collection', async () => {
    const { tx, lines } = buildTx(COLLECTION_ACCOUNTS);

    await expect(
      service().postCollection(
        tx,
        collectionInput({
          components: {
            penaltyPaise: 0n,
            interestPaise: 0n,
            principalPaise: 0n,
            feesPaise: 0n,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(lines).toHaveLength(0);
  });

  it('refuses an inactive income account before writing any line', async () => {
    // Rule 59. The refusal must land before the entry exists, or a posting
    // half-written against a deactivated account would need unwinding.
    const { tx, entries, lines } = buildTx(
      COLLECTION_ACCOUNTS.map((account) =>
        account.accountCode === INTEREST_INCOME_ACCOUNT_CODE
          ? { ...account, status: 'INACTIVE' as const }
          : account,
      ),
    );

    await expect(
      service().postCollection(tx, collectionInput()),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(entries).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it('carries the branch, loan and customer on every line as a dimension', async () => {
    const { tx, lines, dimensions } = buildTx(COLLECTION_ACCOUNTS);

    const entryId = await service().postCollection(tx, collectionInput());

    const own = lines.filter((line) => line.journalEntryId === entryId);
    expect(own.every((line) => line.dimensionId !== null)).toBe(true);
    expect(dimensions).toHaveLength(own.length);
    expect(
      dimensions.every((d) => d.branchId === BRANCH_ID && d.loanId === LOAN_ID),
    ).toBe(true);
  });
});

describe('LedgerService.postCollectionReversal', () => {
  const REVERSAL_ID = '99999999-9999-9999-9999-999999999999';

  function reversalInput(overrides: Record<string, unknown> = {}) {
    return {
      orgId: ORG_ID,
      loanId: LOAN_ID,
      branchId: BRANCH_ID,
      customerId: CUSTOMER_ID,
      reversalCollectionId: REVERSAL_ID,
      originalReceiptNumber: 'RCP-BR001-000001',
      loanNumber: 'LN-000001',
      paymentMode: 'CASH' as const,
      entryDate: new Date('2026-08-22T12:00:00+05:30'),
      createdBy: USER_ID,
      reversalReason: 'Collected against the wrong loan',
      components: STANDARD_COMPONENTS,
      ...overrides,
    };
  }

  it('is the exact mirror of the collection it reverses', async () => {
    // Scenario 32: every line of the original with the sides exchanged.
    const { tx, lines } = buildTx(COLLECTION_ACCOUNTS);

    const entryId = await service().postCollectionReversal(tx, reversalInput());

    expect(shapeOf(lines, entryId)).toEqual([
      `${PENALTY_INCOME_ACCOUNT_CODE}Dr10000`,
      `${INTEREST_INCOME_ACCOUNT_CODE}Dr200000`,
      `${LOAN_RECEIVABLE_ACCOUNT_CODE}Dr790000`,
      `${CASH_ACCOUNT_CODE}Cr1000000`,
    ]);

    const own = lines.filter((line) => line.journalEntryId === entryId);
    const debit = own.reduce((sum, line) => sum + line.debitPaise, 0n);
    const credit = own.reduce((sum, line) => sum + line.creditPaise, 0n);
    expect(debit).toBe(credit);
  });

  it('records itself as a reversal, traceable to the reversal collection', async () => {
    const { tx, entries } = buildTx(COLLECTION_ACCOUNTS);

    await service().postCollectionReversal(tx, reversalInput());

    expect(entries.at(-1)?.entryType).toBe('REVERSAL');
    expect(entries.at(-1)?.sourceType).toBe('COLLECTION_REVERSAL');
    expect(entries.at(-1)?.sourceId).toBe(REVERSAL_ID);
    expect(entries.at(-1)?.description).toContain('RCP-BR001-000001');
  });

  it('writes a new entry rather than touching the original', async () => {
    // The original entry's lines are append-only in the database; this asserts
    // the service never even attempts to reach for them.
    const { tx, entries } = buildTx(COLLECTION_ACCOUNTS);

    await service().postCollection(tx, collectionInput());
    await service().postCollectionReversal(tx, reversalInput());

    expect(entries).toHaveLength(2);
    expect(entries[0].entryType).toBe('COLLECTION');
    expect(entries[1].entryType).toBe('REVERSAL');
    // Two entries, two numbers — a reversal never reuses the original's.
    expect(entries[0].entryNumber).not.toBe(entries[1].entryNumber);
  });

  it('refuses a zero-total reversal', async () => {
    const { tx, lines } = buildTx(COLLECTION_ACCOUNTS);

    await expect(
      service().postCollectionReversal(
        tx,
        reversalInput({
          components: {
            penaltyPaise: 0n,
            interestPaise: 0n,
            principalPaise: 0n,
            feesPaise: 0n,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(lines).toHaveLength(0);
  });
});

/**
 * Module 14 added three columns that every posting must now populate.
 *
 * They are asserted here rather than trusted because all three are nullable in
 * the schema — nothing would fail if the service quietly stopped writing them.
 * `postedBy` in particular is load-bearing: the DRAFT -> POSTED database
 * trigger refuses a posted entry that does not name its actor, so a regression
 * here would surface as a failed money-moving transaction rather than as a
 * missing field.
 */
describe('LedgerService — Module 14 columns', () => {
  it('records who posted a disbursement and for which branch', async () => {
    const { tx, entries } = buildTx(ACCOUNTS);

    await service().postDisbursement(tx, input());

    expect(entries[0]?.postedBy).toBe(USER_ID);
    expect(entries[0]?.branchId).toBe(BRANCH_ID);
  });

  it('tags a disbursement’s two lines by what they represent', async () => {
    const { tx, lines } = buildTx(ACCOUNTS);

    await service().postDisbursement(tx, input());

    // Principal on the receivable side, funding on the bank side. Nothing about
    // a disbursal is interest or penalty — that is what makes the pair legible
    // to reconciliation without re-deriving it from account codes.
    expect(lines.map((line) => line.sourceComponent)).toEqual([
      'PRINCIPAL',
      'FUNDING',
    ]);
  });

  it('records who posted a collection and for which branch', async () => {
    const { tx, entries } = buildTx(COLLECTION_ACCOUNTS);

    await service().postCollection(tx, collectionInput());

    expect(entries[0]?.postedBy).toBe(USER_ID);
    expect(entries[0]?.branchId).toBe(BRANCH_ID);
  });

  it('tags each collection line with the component it settles', async () => {
    const { tx, lines } = buildTx(COLLECTION_ACCOUNTS);

    await service().postCollection(tx, collectionInput());

    // The funding debit first, then the credits in appropriation order. The
    // zero-valued fee line is absent because the service filters it out, which
    // is why FEE does not appear.
    expect(lines.map((line) => line.sourceComponent)).toEqual([
      'FUNDING',
      'PENALTY',
      'INTEREST',
      'PRINCIPAL',
    ]);
  });

  it('tags a reversal’s lines with the same components it unwinds', async () => {
    const { tx, lines } = buildTx(COLLECTION_ACCOUNTS);

    await service().postCollectionReversal(tx, {
      ...collectionInput(),
      reversalCollectionId: 'reversal-collection-id',
      originalReceiptNumber: 'RCP-BR001-000001',
      reversalReason: 'Posted against the wrong loan',
    });

    // Mirrored: the components become debits and the funding side becomes the
    // single credit, but each line still names what it is. A reversal that
    // dropped these tags would reconcile as an untraceable entry.
    expect(lines.map((line) => line.sourceComponent)).toEqual([
      'PENALTY',
      'INTEREST',
      'PRINCIPAL',
      'FUNDING',
    ]);
  });
});

/**
 * Module 12 — field cash custody.
 *
 * Three properties here are load-bearing:
 *
 * 1. **A field collection debits 1220, not 1210.** Cash an agent is carrying is
 *    not in the branch drawer. Debiting 1210 would assert the branch holds
 *    money it has never seen, and the shortfall would stay invisible until
 *    someone counted the drawer.
 * 2. **Only the cash line carries the agent.** Tagging the income lines too
 *    would make an agent-scoped trial balance claim the agent personally holds
 *    interest income.
 * 3. **A handover carries no loan and no customer.** It is a custody transfer,
 *    not a repayment (Rules 21, 22), and tagging it to a loan would surface it
 *    in that borrower's ledger as a second payment.
 */

const FIELD_ACCOUNTS: AccountRow[] = [
  ...COLLECTION_ACCOUNTS,
  {
    accountId: 'acc-agent-cash',
    accountCode: FIELD_AGENT_CASH_ACCOUNT_CODE,
    accountName: 'Field Agent Cash in Hand',
    status: 'ACTIVE',
  },
];

const AGENT_ID = '99999999-9999-9999-9999-999999999999';
const HANDOVER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** Account code, side and amount per line, resolved against the field chart. */
function fieldShapeOf(lines: LineRow[], entryId: string) {
  return lines
    .filter((line) => line.journalEntryId === entryId)
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map((line) => {
      const code = FIELD_ACCOUNTS.find(
        (a) => a.accountId === line.accountId,
      )!.accountCode;
      const side = line.debitPaise > 0n ? 'Dr' : 'Cr';
      const amount = line.debitPaise > 0n ? line.debitPaise : line.creditPaise;
      return `${code}${side}${amount}`;
    });
}

describe('LedgerService.postCollection — field cash routing', () => {
  it('debits Field Agent Cash in Hand when a cash account override is given', async () => {
    const { tx, lines } = buildTx(FIELD_ACCOUNTS);

    const entryId = await service().postCollection(
      tx,
      collectionInput({
        cashAccountCode: FIELD_AGENT_CASH_ACCOUNT_CODE,
        agentUserId: AGENT_ID,
      }),
    );

    expect(fieldShapeOf(lines, entryId)).toEqual([
      `${FIELD_AGENT_CASH_ACCOUNT_CODE}Dr1000000`,
      `${PENALTY_INCOME_ACCOUNT_CODE}Cr10000`,
      `${INTEREST_INCOME_ACCOUNT_CODE}Cr200000`,
      `${LOAN_RECEIVABLE_ACCOUNT_CODE}Cr790000`,
    ]);
  });

  it('still debits branch cash when no override is given', async () => {
    // The compatibility guarantee. Module 11 passes neither new field, and its
    // posting must be byte-identical to what it was before they existed.
    const { tx, lines } = buildTx(FIELD_ACCOUNTS);

    const entryId = await service().postCollection(tx, collectionInput());

    expect(fieldShapeOf(lines, entryId)[0]).toBe(
      `${CASH_ACCOUNT_CODE}Dr1000000`,
    );
  });

  it('tags only the cash line with the agent', async () => {
    const { tx, lines, dimensions } = buildTx(FIELD_ACCOUNTS);

    const entryId = await service().postCollection(
      tx,
      collectionInput({
        cashAccountCode: FIELD_AGENT_CASH_ACCOUNT_CODE,
        agentUserId: AGENT_ID,
      }),
    );

    const tagged = lines
      .filter((line) => line.journalEntryId === entryId)
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map(
        (line) =>
          dimensions.find((d) => d.dimensionId === line.dimensionId)?.userId ??
          null,
      );

    // The cash line, and nothing else. An income line tagged with the agent
    // would make an agent-scoped balance claim they hold interest income.
    expect(tagged).toEqual([AGENT_ID, null, null, null]);
  });

  it('writes no agent dimension at all on an ordinary collection', async () => {
    const { tx, dimensions } = buildTx(FIELD_ACCOUNTS);

    await service().postCollection(tx, collectionInput());

    expect(dimensions.every((d) => d.userId === null)).toBe(true);
  });
});

describe('LedgerService.postCollectionReversal — field cash routing', () => {
  it('credits back the account the original debited', async () => {
    // Reversing a field collection against 1210 would take cash out of a drawer
    // it never entered and leave 1220 permanently overstated — the inconsistent
    // balance Scenario 41 forbids.
    const { tx, lines } = buildTx(FIELD_ACCOUNTS);

    const entryId = await service().postCollectionReversal(tx, {
      ...collectionInput(),
      reversalCollectionId: 'reversal-collection-id',
      originalReceiptNumber: 'RCP-BR001-000001',
      reversalReason: 'Collected against the wrong loan',
      cashAccountCode: FIELD_AGENT_CASH_ACCOUNT_CODE,
      agentUserId: AGENT_ID,
    });

    expect(fieldShapeOf(lines, entryId)).toEqual([
      `${PENALTY_INCOME_ACCOUNT_CODE}Dr10000`,
      `${INTEREST_INCOME_ACCOUNT_CODE}Dr200000`,
      `${LOAN_RECEIVABLE_ACCOUNT_CODE}Dr790000`,
      `${FIELD_AGENT_CASH_ACCOUNT_CODE}Cr1000000`,
    ]);
  });
});

describe('LedgerService.postCashHandover', () => {
  function handoverInput(overrides: Record<string, unknown> = {}) {
    return {
      orgId: ORG_ID,
      branchId: BRANCH_ID,
      fieldAgentId: AGENT_ID,
      handoverId: HANDOVER_ID,
      handoverNumber: 'CH-BR001-000001',
      agentName: 'Asha Rao',
      amountPaise: 1_000_000n,
      entryDate: new Date('2026-08-24T12:00:00+05:30'),
      createdBy: USER_ID,
      ...overrides,
    };
  }

  // Scenario 23.
  it('debits branch cash and credits agent cash', async () => {
    const { tx, lines } = buildTx(FIELD_ACCOUNTS);

    const entryId = await service().postCashHandover(tx, handoverInput());

    expect(fieldShapeOf(lines, entryId)).toEqual([
      `${CASH_ACCOUNT_CODE}Dr1000000`,
      `${FIELD_AGENT_CASH_ACCOUNT_CODE}Cr1000000`,
    ]);
  });

  it('balances', async () => {
    const { tx, lines } = buildTx(FIELD_ACCOUNTS);

    const entryId = await service().postCashHandover(tx, handoverInput());
    const mine = lines.filter((l) => l.journalEntryId === entryId);

    const debits = mine.reduce((sum, l) => sum + l.debitPaise, 0n);
    const credits = mine.reduce((sum, l) => sum + l.creditPaise, 0n);
    expect(debits).toBe(credits);
    expect(debits).toBe(1_000_000n);
  });

  it('records itself as a TRANSFER against the handover', async () => {
    const { tx, entries } = buildTx(FIELD_ACCOUNTS);

    await service().postCashHandover(tx, handoverInput());

    // Not COLLECTION: no customer paid anything here, and a reconciliation
    // that saw this as a collection would look for a receipt behind it.
    expect(entries.at(-1)?.entryType).toBe('TRANSFER');
    expect(entries.at(-1)?.sourceType).toBe('CASH_HANDOVER');
    expect(entries.at(-1)?.sourceId).toBe(HANDOVER_ID);
  });

  it('carries no loan and no customer on any dimension', async () => {
    // Rules 21 and 22. A custody transfer tagged to a loan would appear in that
    // borrower's ledger as though they had paid twice.
    const { tx, dimensions } = buildTx(FIELD_ACCOUNTS);

    await service().postCashHandover(tx, handoverInput());

    expect(dimensions.every((d) => d.loanId === null)).toBe(true);
    expect(dimensions.every((d) => d.customerId === null)).toBe(true);
    expect(dimensions.every((d) => d.branchId === BRANCH_ID)).toBe(true);
  });

  it('tags the agent on the credit side only', async () => {
    const { tx, lines, dimensions } = buildTx(FIELD_ACCOUNTS);

    const entryId = await service().postCashHandover(tx, handoverInput());

    const byLine = lines
      .filter((line) => line.journalEntryId === entryId)
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line) => ({
        side: line.debitPaise > 0n ? 'Dr' : 'Cr',
        userId:
          dimensions.find((d) => d.dimensionId === line.dimensionId)?.userId ??
          null,
      }));

    // Branch cash is nobody's personally. Attributing the debit to the agent
    // would net their dimension-scoped balance to zero the moment they handed
    // the money over — the opposite of what it should show.
    expect(byLine).toEqual([
      { side: 'Dr', userId: null },
      { side: 'Cr', userId: AGENT_ID },
    ]);
  });

  it('refuses a zero handover', async () => {
    const { tx } = buildTx(FIELD_ACCOUNTS);

    await expect(
      service().postCashHandover(tx, handoverInput({ amountPaise: 0n })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to post when the agent cash account is inactive', async () => {
    // Resolved before any line is written, so a deactivated account stops the
    // posting rather than leaving a half-built entry.
    const inactive = FIELD_ACCOUNTS.map((a) =>
      a.accountCode === FIELD_AGENT_CASH_ACCOUNT_CODE
        ? { ...a, status: 'INACTIVE' as const }
        : a,
    );
    const { tx, lines } = buildTx(inactive);

    await expect(
      service().postCashHandover(tx, handoverInput()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(lines).toHaveLength(0);
  });
});

describe('LedgerService.postCashHandoverReversal', () => {
  function reversalInput(overrides: Record<string, unknown> = {}) {
    return {
      orgId: ORG_ID,
      branchId: BRANCH_ID,
      fieldAgentId: AGENT_ID,
      reversalHandoverId: 'reversal-handover-id',
      originalHandoverNumber: 'CH-BR001-000001',
      agentName: 'Asha Rao',
      amountPaise: 1_000_000n,
      entryDate: new Date('2026-08-24T13:00:00+05:30'),
      createdBy: USER_ID,
      reversalReason: 'Cash was miscounted at the counter',
      ...overrides,
    };
  }

  it('exchanges the sides of the original transfer', async () => {
    const { tx, lines } = buildTx(FIELD_ACCOUNTS);

    const entryId = await service().postCashHandoverReversal(
      tx,
      reversalInput(),
    );

    expect(fieldShapeOf(lines, entryId)).toEqual([
      `${FIELD_AGENT_CASH_ACCOUNT_CODE}Dr1000000`,
      `${CASH_ACCOUNT_CODE}Cr1000000`,
    ]);
  });

  it('records itself as a REVERSAL against the reversal row', async () => {
    const { tx, entries } = buildTx(FIELD_ACCOUNTS);

    await service().postCashHandoverReversal(tx, reversalInput());

    // sourceId is the reversal row, not the handover being reversed — the same
    // convention `postCollectionReversal` follows, so a reconciliation counting
    // entries per source finds one each rather than two against the original.
    expect(entries.at(-1)?.entryType).toBe('REVERSAL');
    expect(entries.at(-1)?.sourceType).toBe('CASH_HANDOVER_REVERSAL');
    expect(entries.at(-1)?.sourceId).toBe('reversal-handover-id');
  });

  it('restores the agent tag on the debit side', async () => {
    const { tx, lines, dimensions } = buildTx(FIELD_ACCOUNTS);

    const entryId = await service().postCashHandoverReversal(
      tx,
      reversalInput(),
    );

    const byLine = lines
      .filter((line) => line.journalEntryId === entryId)
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line) => ({
        side: line.debitPaise > 0n ? 'Dr' : 'Cr',
        userId:
          dimensions.find((d) => d.dimensionId === line.dimensionId)?.userId ??
          null,
      }));

    expect(byLine).toEqual([
      { side: 'Dr', userId: AGENT_ID },
      { side: 'Cr', userId: null },
    ]);
  });

  it('refuses a zero reversal', async () => {
    const { tx } = buildTx(FIELD_ACCOUNTS);

    await expect(
      service().postCashHandoverReversal(
        tx,
        reversalInput({ amountPaise: 0n }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
