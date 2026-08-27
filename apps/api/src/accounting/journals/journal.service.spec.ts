/**
 * Tests for manual journals (Module 14 Scenarios 12-18, 28-45, 57).
 *
 * These cover the decisions the service makes. What they deliberately do *not*
 * cover is the database's half of each rule — the DRAFT -> POSTED trigger, the
 * append-only refusals and the one-reversal-per-journal index are proven in
 * `apps/web/e2e/accounting.spec.ts` against a real Postgres, because a fake
 * that agreed with the service would prove only that the service agrees with
 * itself.
 *
 * Four properties here are load-bearing beyond ordinary coverage:
 *
 *  - **A draft may be unbalanced; a posting may not.** That asymmetry is the
 *    whole point of the Module 14 trigger rewrite, and a test suite that only
 *    checked "balanced posts, unbalanced fails" would not notice if drafting
 *    silently started requiring balance too.
 *  - **Replay precedes the version check.** A client retrying after a timeout
 *    holds the pre-commit version, so checking the version first would refuse
 *    the retry with a conflict instead of returning what it already achieved.
 *  - **Failures are audited outside the transaction.** A failure recorded
 *    inside the transaction it describes vanishes with the rollback.
 *  - **Totals are computed with BigInt.** The large-amount case is the one a
 *    Number comparison gets wrong.
 */

import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalService } from './journal.service';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const BRANCH_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_BRANCH_ID = '55555555-5555-5555-5555-555555555555';
const ENTRY_ID = '66666666-6666-6666-6666-666666666666';
const BANK = 'aaaaaaaa-0000-4000-8000-000000000001';
const INCOME = 'aaaaaaaa-0000-4000-8000-000000000002';
const CONTROL = 'aaaaaaaa-0000-4000-8000-000000000003';
const INACTIVE = 'aaaaaaaa-0000-4000-8000-000000000004';
const KEY = '77777777-7777-4777-8777-777777777777';

const UPDATED_AT = new Date('2026-08-23T10:00:00.000Z');
const VERSION = UPDATED_AT.toISOString();

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
    permissions: [],
    ...overrides,
  };
}

interface LineSeed {
  accountId: string;
  debitPaise: bigint;
  creditPaise: bigint;
  description?: string | null;
  sourceComponent?: string | null;
}

interface EntrySeed {
  orgId: string;
  journalEntryId: string;
  entryNumber: string;
  entryDate: Date;
  entryType: string;
  status: string;
  description: string | null;
  sourceType: string | null;
  sourceId: string | null;
  branchId: string | null;
  postedAt: Date | null;
  postedBy: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  originalJournalEntryId: string | null;
  reversalReason: string | null;
  adjustmentReason: string | null;
  approvalReference: string | null;
  idempotencyKey: string | null;
  requestFingerprint: string | null;
  lines: LineSeed[];
}

function entry(overrides: Partial<EntrySeed> = {}): EntrySeed {
  return {
    orgId: ORG_ID,
    journalEntryId: ENTRY_ID,
    entryNumber: 'JE-000100',
    entryDate: new Date('2026-08-23T00:00:00.000Z'),
    entryType: 'MANUAL',
    status: 'DRAFT',
    description: 'Bank charges',
    sourceType: null,
    sourceId: null,
    branchId: null,
    postedAt: null,
    postedBy: null,
    createdBy: USER_ID,
    createdAt: new Date('2026-08-23T09:00:00.000Z'),
    updatedAt: UPDATED_AT,
    originalJournalEntryId: null,
    reversalReason: null,
    adjustmentReason: null,
    approvalReference: null,
    idempotencyKey: null,
    requestFingerprint: null,
    lines: [
      { accountId: BANK, debitPaise: 50000n, creditPaise: 0n },
      { accountId: INCOME, debitPaise: 0n, creditPaise: 50000n },
    ],
    ...overrides,
  };
}

const ACCOUNTS = [
  {
    accountId: BANK,
    accountName: 'Bank Account',
    status: 'ACTIVE',
    isPostable: true,
    isManualPostingAllowed: true,
  },
  {
    accountId: INCOME,
    accountName: 'Interest Income',
    status: 'ACTIVE',
    isPostable: true,
    isManualPostingAllowed: true,
  },
  {
    accountId: CONTROL,
    accountName: 'Loan Receivable',
    status: 'ACTIVE',
    isPostable: true,
    isManualPostingAllowed: false,
  },
  {
    accountId: INACTIVE,
    accountName: 'Retired Suspense',
    status: 'INACTIVE',
    isPostable: true,
    isManualPostingAllowed: true,
  },
];

/** A stateful fake that refuses an unscoped query. */
function buildPrisma(seeds: EntrySeed[]) {
  const store = seeds.map((seed) => ({ ...seed, lines: [...seed.lines] }));

  function assertScoped(where: Record<string, unknown> | undefined): void {
    if (!where) throw new Error('Query issued with no where clause');
    const compound = where.orgId_journalEntryId as
      { orgId?: unknown } | undefined;
    const orgId = where.orgId ?? compound?.orgId;
    if (typeof orgId !== 'string') {
      throw new Error(
        `Query issued without an orgId filter: ${JSON.stringify(where)}`,
      );
    }
  }

  const decorate = (row: EntrySeed) => ({
    ...row,
    lines: row.lines.map((line, index) => ({
      journalLineId: `line-${index + 1}`,
      lineNumber: index + 1,
      accountId: line.accountId,
      debitPaise: line.debitPaise,
      creditPaise: line.creditPaise,
      description: line.description ?? null,
      sourceComponent: line.sourceComponent ?? null,
      account: {
        accountId: line.accountId,
        accountCode: line.accountId === BANK ? '1200' : '4100',
        accountName:
          ACCOUNTS.find((a) => a.accountId === line.accountId)?.accountName ??
          'Unknown',
      },
    })),
    branch: row.branchId ? { name: 'Main Branch' } : null,
    originalEntry: row.originalJournalEntryId
      ? {
          journalEntryId: row.originalJournalEntryId,
          entryNumber:
            store.find((r) => r.journalEntryId === row.originalJournalEntryId)
              ?.entryNumber ?? 'JE-?',
        }
      : null,
    reversalEntries: store
      .filter((r) => r.originalJournalEntryId === row.journalEntryId)
      .map((r) => ({
        journalEntryId: r.journalEntryId,
        entryNumber: r.entryNumber,
      })),
  });

  const matches = (row: EntrySeed, where: Record<string, unknown>): boolean => {
    if (where.orgId !== undefined && row.orgId !== where.orgId) return false;
    if (
      where.journalEntryId !== undefined &&
      row.journalEntryId !== where.journalEntryId
    ) {
      return false;
    }
    if (where.branchId !== undefined && row.branchId !== where.branchId) {
      return false;
    }
    if (where.status !== undefined && row.status !== where.status) return false;
    if (
      where.idempotencyKey !== undefined &&
      row.idempotencyKey !== where.idempotencyKey
    ) {
      return false;
    }
    return true;
  };

  let created = 0;

  const journalEntry = {
    findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      assertScoped(where);
      const row = store.find((r) => matches(r, where));
      return Promise.resolve(row ? decorate(row) : null);
    }),
    findMany: jest.fn(({ where }: { where?: Record<string, unknown> }) => {
      if (where?.entryNumber) {
        // The numbering scan.
        return Promise.resolve(
          store
            .filter((r) => r.orgId === where.orgId)
            .map((r) => ({ entryNumber: r.entryNumber })),
        );
      }
      assertScoped(where);
      return Promise.resolve(
        store.filter((r) => matches(r, where!)).map(decorate),
      );
    }),
    count: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      assertScoped(where);
      return Promise.resolve(store.filter((r) => matches(r, where)).length);
    }),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      created += 1;
      const clash = store.find(
        (r) =>
          data.idempotencyKey != null &&
          r.idempotencyKey === data.idempotencyKey,
      );
      if (clash) {
        throw Object.assign(
          new Error('Unique constraint failed on idempotency_key'),
          { code: 'P2002' },
        );
      }
      const row = entry({
        ...(data as Partial<EntrySeed>),
        journalEntryId: `new-entry-${created}`,
        lines: [],
      });
      store.push(row);
      return Promise.resolve(decorate(row));
    }),
    update: jest.fn(
      ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        assertScoped(where);
        const key = where.orgId_journalEntryId as {
          orgId: string;
          journalEntryId: string;
        };
        const row = store.find(
          (r) =>
            r.orgId === key.orgId && r.journalEntryId === key.journalEntryId,
        );
        if (!row) throw new Error('no such entry');
        Object.assign(row, data);
        return Promise.resolve(decorate(row));
      },
    ),
    delete: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      assertScoped(where);
      const key = where.orgId_journalEntryId as {
        orgId: string;
        journalEntryId: string;
      };
      const index = store.findIndex(
        (r) => r.orgId === key.orgId && r.journalEntryId === key.journalEntryId,
      );
      if (index === -1) throw new Error('no such entry');
      store.splice(index, 1);
      return Promise.resolve({});
    }),
  };

  const journalLine = {
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      const row = store.find(
        (r) => r.journalEntryId === (data.journalEntryId as string),
      );
      row?.lines.push({
        accountId: data.accountId as string,
        debitPaise: data.debitPaise as bigint,
        creditPaise: data.creditPaise as bigint,
        description: (data.description as string) ?? null,
        sourceComponent: (data.sourceComponent as string) ?? null,
      });
      return Promise.resolve({});
    }),
    deleteMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      assertScoped(where);
      const row = store.find(
        (r) => r.journalEntryId === (where.journalEntryId as string),
      );
      if (row) row.lines = [];
      return Promise.resolve({ count: 0 });
    }),
  };

  const account = {
    findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      assertScoped(where);
      const ids = (where.accountId as { in: string[] } | undefined)?.in ?? [];
      return Promise.resolve(ACCOUNTS.filter((a) => ids.includes(a.accountId)));
    }),
  };

  const accountDimension = {
    create: jest.fn(() =>
      Promise.resolve({ dimensionId: `dim-${Math.random()}` }),
    ),
  };

  const user = {
    findMany: jest.fn(() =>
      Promise.resolve([{ userId: USER_ID, name: 'Ada Finance' }]),
    ),
  };

  const prisma = {
    journalEntry,
    journalLine,
    account,
    accountDimension,
    user,
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ journalEntry, journalLine, account, accountDimension, user }),
    ),
  };

  return { prisma, store, journalEntry, journalLine };
}

function buildService(seeds: EntrySeed[] = []) {
  const { prisma, store, journalEntry, journalLine } = buildPrisma(seeds);
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new JournalService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, audit, store, journalEntry, journalLine };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    entryDate: '2026-08-23',
    entryType: 'MANUAL' as const,
    description: 'Bank charges for August',
    idempotencyKey: KEY,
    lines: [
      { accountId: BANK, debitPaise: '50000', creditPaise: '0' },
      { accountId: INCOME, debitPaise: '0', creditPaise: '50000' },
    ],
    ...overrides,
  };
}

describe('JournalService.validate', () => {
  it('reports an unbalanced set without throwing', async () => {
    // Scenario 13. The caller asked whether this would post; answering with a
    // 409 would make "no, and here is why" harder to render than "no".
    const { service } = buildService();

    const result = await service.validate(
      actor(),
      body({
        lines: [
          { accountId: BANK, debitPaise: '50000', creditPaise: '0' },
          { accountId: INCOME, debitPaise: '0', creditPaise: '40000' },
        ],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.balanced).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('UNBALANCED');
  });

  it('states the difference in rupees, so the operator can act on it', async () => {
    const { service } = buildService();

    const result = await service.validate(
      actor(),
      body({
        lines: [
          { accountId: BANK, debitPaise: '50000', creditPaise: '0' },
          { accountId: INCOME, debitPaise: '0', creditPaise: '40000' },
        ],
      }),
    );

    expect(result.issues[0]?.message).toBe(
      'Total debit must equal total credit. They differ by ₹100.00.',
    );
  });

  it('accepts a balanced set', async () => {
    const { service } = buildService();

    const result = await service.validate(actor(), body());

    expect(result.valid).toBe(true);
    expect(result.totalDebitPaise).toBe('50000');
  });

  it('balances amounts too large for a double to hold exactly', async () => {
    // 90,000 crore in paise, plus one. Number arithmetic loses the final digit.
    const huge = '9000000000000001';
    const { service } = buildService();

    const result = await service.validate(
      actor(),
      body({
        lines: [
          { accountId: BANK, debitPaise: huge, creditPaise: '0' },
          { accountId: INCOME, debitPaise: '0', creditPaise: huge },
        ],
      }),
    );

    expect(result.balanced).toBe(true);
  });

  it('detects a one-paise imbalance at that scale', async () => {
    const { service } = buildService();

    const result = await service.validate(
      actor(),
      body({
        lines: [
          { accountId: BANK, debitPaise: '9000000000000001', creditPaise: '0' },
          {
            accountId: INCOME,
            debitPaise: '0',
            creditPaise: '9000000000000000',
          },
        ],
      }),
    );

    expect(result.balanced).toBe(false);
  });

  it('refuses a journal with only debit lines', async () => {
    // Scenario 15.
    const { service } = buildService();

    const result = await service.validate(
      actor(),
      body({
        lines: [
          { accountId: BANK, debitPaise: '50000', creditPaise: '0' },
          { accountId: INCOME, debitPaise: '50000', creditPaise: '0' },
        ],
      }),
    );

    expect(result.issues.map((i) => i.code)).toContain('ONE_SIDED_ENTRY');
  });

  it('refuses a line carrying both a debit and a credit', async () => {
    // Scenario 14.
    const { service } = buildService();

    const result = await service.validate(
      actor(),
      body({
        lines: [
          { accountId: BANK, debitPaise: '100', creditPaise: '100' },
          { accountId: INCOME, debitPaise: '0', creditPaise: '100' },
        ],
      }),
    );

    expect(result.issues.map((i) => i.code)).toContain('LINE_TWO_SIDED');
  });

  it('refuses a zero-value line', async () => {
    // Scenario 17.
    const { service } = buildService();

    const result = await service.validate(
      actor(),
      body({
        lines: [
          { accountId: BANK, debitPaise: '0', creditPaise: '0' },
          { accountId: INCOME, debitPaise: '0', creditPaise: '100' },
        ],
      }),
    );

    expect(result.issues.map((i) => i.code)).toContain('LINE_ZERO');
  });

  it('refuses an account not open to manual posting', async () => {
    // Rule 39: a control account is driven by its subledger.
    const { service } = buildService();

    const result = await service.validate(
      actor(),
      body({
        lines: [
          { accountId: CONTROL, debitPaise: '1000', creditPaise: '0' },
          { accountId: INCOME, debitPaise: '0', creditPaise: '1000' },
        ],
      }),
    );

    expect(result.issues.map((i) => i.code)).toContain(
      'ACCOUNT_NOT_MANUALLY_POSTABLE',
    );
  });

  it('refuses an inactive account', async () => {
    // Scenarios 11, 30.
    const { service } = buildService();

    const result = await service.validate(
      actor(),
      body({
        lines: [
          { accountId: INACTIVE, debitPaise: '1000', creditPaise: '0' },
          { accountId: INCOME, debitPaise: '0', creditPaise: '1000' },
        ],
      }),
    );

    expect(result.issues.map((i) => i.code)).toContain('ACCOUNT_INACTIVE');
  });

  it('flags a repeated account on the same side', async () => {
    const { service } = buildService();

    const result = await service.validate(
      actor(),
      body({
        lines: [
          { accountId: BANK, debitPaise: '25000', creditPaise: '0' },
          { accountId: BANK, debitPaise: '25000', creditPaise: '0' },
          { accountId: INCOME, debitPaise: '0', creditPaise: '50000' },
        ],
      }),
    );

    expect(result.issues.map((i) => i.code)).toContain(
      'DUPLICATE_ACCOUNT_SIDE',
    );
  });
});

describe('JournalService.create', () => {
  it('saves an UNBALANCED draft', async () => {
    // Scenario 12, and the whole point of the Module 14 trigger rewrite: a
    // draft is a form being filled in, not a posting.
    const { service, store } = buildService();

    const created = await service.create(
      actor(),
      body({
        lines: [
          { accountId: BANK, debitPaise: '50000', creditPaise: '0' },
          { accountId: INCOME, debitPaise: '0', creditPaise: '40000' },
        ],
      }),
      META,
    );

    expect(created.status).toBe('DRAFT');
    expect(created.balanced).toBe(false);
    expect(store).toHaveLength(1);
  });

  it('still refuses a two-sided line in a draft', async () => {
    // The per-line rules hold even for a draft: a line with both sides is a
    // data-entry error at the moment it is written, not an intermediate state.
    const { service } = buildService();

    await expect(
      service.create(
        actor(),
        body({
          lines: [
            { accountId: BANK, debitPaise: '100', creditPaise: '100' },
            { accountId: INCOME, debitPaise: '0', creditPaise: '100' },
          ],
        }),
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allocates an entry number from the organization sequence', async () => {
    const { service } = buildService([entry({ entryNumber: 'JE-000007' })]);

    const created = await service.create(actor(), body(), META);

    expect(created.entryNumber).toBe('JE-000008');
  });

  it('stamps the actor’s branch, never a client-supplied one', async () => {
    // Scenario 53. There is no branchId field on the DTO at all; this asserts
    // the server fills it from the session.
    const { service, store } = buildService();

    await service.create(actor({ branchId: BRANCH_ID }), body(), META);

    expect(store[0]?.branchId).toBe(BRANCH_ID);
  });

  it('leaves an organization-level journal without a branch', async () => {
    // A Super Admin's adjustment does not belong to a branch, and forcing one
    // would put it in an arbitrary branch's ledger.
    const { service, store } = buildService();

    await service.create(actor({ branchId: null }), body(), META);

    expect(store[0]?.branchId ?? null).toBeNull();
  });

  it('requires a reason on an adjustment', async () => {
    // Scenario 43.
    const { service } = buildService();

    await expect(
      service.create(actor(), body({ entryType: 'ADJUSTMENT' }), META),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('audits the draft with the fingerprint under a sanitizer-safe key', async () => {
    // `requestFingerprint`, never `requestHash`: sanitizeMetadata drops any key
    // matching /hash/i and the trail would be silently empty.
    const { service, audit } = buildService();

    await service.create(actor(), body(), META);

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.JOURNAL_DRAFT_CREATED }),
      expect.anything(),
    );
    const calls = audit.record.mock.calls as [
      { action: string; metadata?: Record<string, unknown> },
    ][];
    const recorded = calls.find(
      ([input]) => input.action === AuditAction.JOURNAL_DRAFT_CREATED,
    )?.[0];

    expect(recorded?.metadata).toHaveProperty('requestFingerprint');
  });

  it('returns the existing draft when the same key and body are replayed', async () => {
    // Scenario 25.
    const { service, store } = buildService();

    const first = await service.create(actor(), body(), META);
    const second = await service.create(actor(), body(), META);

    expect(second.journalEntryId).toBe(first.journalEntryId);
    expect(store).toHaveLength(1);
  });

  it('refuses the same key with a materially different body', async () => {
    // Scenario 26.
    const { service } = buildService();

    await service.create(actor(), body(), META);

    await expect(
      service.create(
        actor(),
        body({
          lines: [
            { accountId: BANK, debitPaise: '99000', creditPaise: '0' },
            { accountId: INCOME, debitPaise: '0', creditPaise: '99000' },
          ],
        }),
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('ignores a changed description when deciding whether a retry is honest', async () => {
    // A corrected typo should not refuse a retry, the same reason
    // collection.service.ts excludes `notes` from its fingerprint.
    const { service, store } = buildService();

    await service.create(actor(), body(), META);
    await service.create(
      actor(),
      body({ description: 'Bank charges for August (corrected)' }),
      META,
    );

    expect(store).toHaveLength(1);
  });
});

describe('JournalService.update', () => {
  it('replaces the lines of a draft', async () => {
    // Scenario 35.
    const { service, store } = buildService([entry()]);

    await service.update(
      actor(),
      ENTRY_ID,
      {
        entryDate: '2026-08-23',
        entryType: 'MANUAL',
        description: 'Corrected',
        expectedVersion: VERSION,
        lines: [
          { accountId: BANK, debitPaise: '70000', creditPaise: '0' },
          { accountId: INCOME, debitPaise: '0', creditPaise: '70000' },
        ],
      },
      META,
    );

    expect(store[0]?.lines).toHaveLength(2);
    expect(store[0]?.lines[0]?.debitPaise).toBe(70000n);
  });

  it('refuses a stale version', async () => {
    // Scenario 57.
    const { service } = buildService([entry()]);

    await expect(
      service.update(
        actor(),
        ENTRY_ID,
        {
          entryDate: '2026-08-23',
          entryType: 'MANUAL',
          description: 'Stale',
          expectedVersion: '2020-01-01T00:00:00.000Z',
          lines: [
            { accountId: BANK, debitPaise: '1', creditPaise: '0' },
            { accountId: INCOME, debitPaise: '0', creditPaise: '1' },
          ],
        },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to edit a posted journal', async () => {
    // Scenario 36. The trigger refuses it too; this is the readable half.
    const { service } = buildService([
      entry({ status: 'POSTED', postedAt: new Date(), postedBy: USER_ID }),
    ]);

    await expect(
      service.update(
        actor(),
        ENTRY_ID,
        {
          entryDate: '2026-08-23',
          entryType: 'MANUAL',
          description: 'Nope',
          expectedVersion: VERSION,
          lines: [
            { accountId: BANK, debitPaise: '1', creditPaise: '0' },
            { accountId: INCOME, debitPaise: '0', creditPaise: '1' },
          ],
        },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('JournalService.remove', () => {
  it('discards a draft', async () => {
    const { service, store } = buildService([entry()]);

    const result = await service.remove(actor(), ENTRY_ID, META);

    expect(result).toEqual({ journalEntryId: ENTRY_ID, deleted: true });
    expect(store).toHaveLength(0);
  });

  it('refuses to delete a posted journal and audits the refusal', async () => {
    // Scenario 37. Audited with one argument — no tx — so the record survives.
    const { service, audit, store } = buildService([
      entry({ status: 'POSTED', postedAt: new Date(), postedBy: USER_ID }),
    ]);

    await expect(
      service.remove(actor(), ENTRY_ID, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(store).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.JOURNAL_DELETE_BLOCKED }),
    );
  });
});

describe('JournalService.post', () => {
  it('posts a balanced draft and stamps the actor', async () => {
    // Scenario 28.
    const { service, store } = buildService([entry()]);

    const posted = await service.post(
      actor(),
      ENTRY_ID,
      { expectedVersion: VERSION },
      KEY,
      META,
    );

    expect(posted.status).toBe('POSTED');
    expect(store[0]?.postedBy).toBe(USER_ID);
    expect(store[0]?.postedAt).not.toBeNull();
  });

  it('refuses to post an unbalanced draft', async () => {
    // Scenarios 13, 61. `assert_entry_postable` refuses it too.
    const { service, store } = buildService([
      entry({
        lines: [
          { accountId: BANK, debitPaise: 50000n, creditPaise: 0n },
          { accountId: INCOME, debitPaise: 0n, creditPaise: 40000n },
        ],
      }),
    ]);

    await expect(
      service.post(actor(), ENTRY_ID, { expectedVersion: VERSION }, KEY, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(store[0]?.status).toBe('DRAFT');
  });

  it('audits a failed posting outside the transaction, so it survives', async () => {
    const { service, audit } = buildService([
      entry({
        lines: [
          { accountId: BANK, debitPaise: 50000n, creditPaise: 0n },
          { accountId: INCOME, debitPaise: 0n, creditPaise: 40000n },
        ],
      }),
    ]);

    await service
      .post(actor(), ENTRY_ID, { expectedVersion: VERSION }, KEY, META)
      .catch(() => undefined);

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.JOURNAL_POSTING_FAILED }),
    );
  });

  it('refuses to post to an account closed to manual posting', async () => {
    const { service } = buildService([
      entry({
        lines: [
          { accountId: CONTROL, debitPaise: 1000n, creditPaise: 0n },
          { accountId: INCOME, debitPaise: 0n, creditPaise: 1000n },
        ],
      }),
    ]);

    await expect(
      service.post(actor(), ENTRY_ID, { expectedVersion: VERSION }, KEY, META),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns the existing entry when a post is replayed', async () => {
    // The replay check precedes the version check on purpose: a client
    // retrying after a timeout holds the version from before the commit.
    const { service, audit } = buildService([
      entry({ status: 'POSTED', postedAt: new Date(), postedBy: USER_ID }),
    ]);

    const posted = await service.post(
      actor(),
      ENTRY_ID,
      { expectedVersion: 'a-stale-version-the-client-still-holds' },
      KEY,
      META,
    );

    expect(posted.status).toBe('POSTED');
    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.JOURNAL_DUPLICATE_IGNORED }),
    );
  });

  it('refuses a stale post of a draft', async () => {
    const { service } = buildService([entry()]);

    await expect(
      service.post(
        actor(),
        ENTRY_ID,
        { expectedVersion: '2020-01-01T00:00:00.000Z' },
        KEY,
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('JournalService.reverse', () => {
  const posted = () =>
    entry({ status: 'POSTED', postedAt: new Date(), postedBy: USER_ID });

  it('writes a new entry with the sides exchanged', async () => {
    // Scenario 40.
    const { service, store } = buildService([posted()]);

    const reversal = await service.reverse(
      actor(),
      ENTRY_ID,
      { reversalReason: 'Wrong account', expectedVersion: VERSION },
      KEY,
      META,
    );

    expect(reversal.lines[0]?.creditPaise).toBe('50000');
    expect(reversal.lines[0]?.debitPaise).toBe('0');
    expect(reversal.lines[1]?.debitPaise).toBe('50000');
    expect(store).toHaveLength(2);
  });

  it('leaves the original posted entry’s lines untouched', async () => {
    // Scenario 39: the original is preserved, only its status moves.
    const { service, store } = buildService([posted()]);

    await service.reverse(
      actor(),
      ENTRY_ID,
      { reversalReason: 'Wrong account', expectedVersion: VERSION },
      KEY,
      META,
    );

    const original = store.find((r) => r.journalEntryId === ENTRY_ID);
    expect(original?.status).toBe('REVERSED');
    expect(original?.lines[0]?.debitPaise).toBe(50000n);
    expect(original?.lines[1]?.creditPaise).toBe(50000n);
  });

  it('returns the reversal, with the original one field away', async () => {
    const { service } = buildService([posted()]);

    const reversal = await service.reverse(
      actor(),
      ENTRY_ID,
      { reversalReason: 'Wrong account', expectedVersion: VERSION },
      KEY,
      META,
    );

    expect(reversal.entryType).toBe('REVERSAL');
    expect(reversal.originalJournalEntryId).toBe(ENTRY_ID);
    expect(reversal.originalEntryNumber).toBe('JE-000100');
  });

  it('carries the source component across, so a reversal stays traceable', async () => {
    const { service, store } = buildService([
      entry({
        status: 'POSTED',
        postedAt: new Date(),
        postedBy: USER_ID,
        lines: [
          {
            accountId: BANK,
            debitPaise: 50000n,
            creditPaise: 0n,
            sourceComponent: 'FUNDING',
          },
          {
            accountId: INCOME,
            debitPaise: 0n,
            creditPaise: 50000n,
            sourceComponent: 'INTEREST',
          },
        ],
      }),
    ]);

    await service.reverse(
      actor(),
      ENTRY_ID,
      { reversalReason: 'Wrong account', expectedVersion: VERSION },
      KEY,
      META,
    );

    const reversal = store.find((r) => r.journalEntryId !== ENTRY_ID);
    expect(reversal?.lines.map((l) => l.sourceComponent)).toEqual([
      'FUNDING',
      'INTEREST',
    ]);
  });

  it('refuses a second reversal', async () => {
    // Scenario 41, and there are three layers that refuse it. In the ordinary
    // case the first one fires: reversing flips the original to REVERSED, so a
    // second attempt fails the "must be POSTED" check before it ever looks for
    // an existing reversal. The `reversalEntries` check behind it catches a
    // POSTED entry that somehow already has one, and the partial unique index
    // on (org_id, original_journal_entry_id) catches the concurrent race that
    // neither can see. This asserts the refusal and its wording rather than
    // which layer produced it.
    const { service, store } = buildService([posted()]);

    await service.reverse(
      actor(),
      ENTRY_ID,
      { reversalReason: 'First', expectedVersion: VERSION },
      KEY,
      META,
    );

    const version = store
      .find((r) => r.journalEntryId === ENTRY_ID)!
      .updatedAt.toISOString();

    const error = await service
      .reverse(
        actor(),
        ENTRY_ID,
        { reversalReason: 'Second', expectedVersion: version },
        'aaaaaaaa-1111-4111-8111-111111111111',
        META,
      )
      .catch((caught: ConflictException) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(
      'Journal JE-000100 has already been reversed.',
    );
    // Two entries, not three: no second reversal was written.
    expect(store).toHaveLength(2);
  });

  it('refuses to reverse a draft', async () => {
    const { service } = buildService([entry()]);

    await expect(
      service.reverse(
        actor(),
        ENTRY_ID,
        { reversalReason: 'x', expectedVersion: VERSION },
        KEY,
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a reversal dated before the entry it reverses', async () => {
    // Reversing into a period that has already been reported would rewrite a
    // published figure.
    const { service } = buildService([posted()]);

    await expect(
      service.reverse(
        actor(),
        ENTRY_ID,
        {
          reversalReason: 'x',
          entryDate: '2026-08-01',
          expectedVersion: VERSION,
        },
        KEY,
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns the existing reversal when the key is replayed', async () => {
    const { service, store } = buildService([posted()]);

    const first = await service.reverse(
      actor(),
      ENTRY_ID,
      { reversalReason: 'Wrong account', expectedVersion: VERSION },
      KEY,
      META,
    );

    const second = await service.reverse(
      actor(),
      ENTRY_ID,
      { reversalReason: 'Wrong account', expectedVersion: VERSION },
      KEY,
      META,
    );

    expect(second.journalEntryId).toBe(first.journalEntryId);
    expect(store).toHaveLength(2);
  });
});

describe('JournalService scope', () => {
  it('refuses another organization’s journal with 404, not 403', async () => {
    // Scenario 52.
    const { service } = buildService([entry({ orgId: OTHER_ORG_ID })]);

    await expect(service.get(actor(), ENTRY_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses another branch’s journal to a branch-confined actor', async () => {
    // Scenario 34.
    const { service } = buildService([entry({ branchId: OTHER_BRANCH_ID })]);

    await expect(
      service.get(actor({ branchId: BRANCH_ID }), ENTRY_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('confines a branch actor’s list to their own branch', async () => {
    const { service } = buildService([
      entry({ branchId: BRANCH_ID }),
      entry({
        journalEntryId: 'other-branch-entry',
        entryNumber: 'JE-000101',
        branchId: OTHER_BRANCH_ID,
      }),
    ]);

    const result = await service.list(actor({ branchId: BRANCH_ID }), {});

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.entryNumber).toBe('JE-000100');
  });
});
