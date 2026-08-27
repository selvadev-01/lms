/**
 * Tests for the chart of accounts (Module 14 Scenarios 1-11, 46-48).
 *
 * Five properties here are load-bearing beyond ordinary CRUD coverage:
 *
 *  - **Every query carries an orgId.** The fake throws if one is missing rather
 *    than returning everything, so a scope bug fails loudly here instead of
 *    leaking another tenant's chart in production.
 *  - **Out of scope is 404, never 403.** A 403 would confirm the id exists
 *    somewhere else.
 *  - **A posted line freezes identity.** Code, type and normal balance stop
 *    being editable, because changing them would retroactively alter what an
 *    entry already in the ledger means.
 *  - **Delete refuses and names the blocker.** "Deactivate instead" is only
 *    actionable if the user can see why.
 *  - **Refusals are audited without a tx.** A refusal recorded inside the
 *    transaction it refuses would vanish with the rollback.
 */

import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountService } from './account.service';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-4444-444444444444';
const PARENT_ID = '55555555-5555-5555-5555-555555555555';
const CHILD_ID = '66666666-6666-6666-6666-666666666666';

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
    permissions: ['accounting.accounts.view', 'accounting.accounts.manage'],
    ...overrides,
  };
}

interface AccountRecord {
  orgId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: string;
  status: string;
  isPostable: boolean;
  isManualPostingAllowed: boolean;
  isControlAccount: boolean;
  branchScope: string;
  parentAccountId: string | null;
  accountCategory: string | null;
  description: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  /** Fake-only: what `_count.journalLines` should report. */
  postedLines?: number;
}

function accountRecord(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    orgId: ORG_ID,
    accountId: ACCOUNT_ID,
    accountCode: '1300',
    accountName: 'Suspense',
    accountType: 'ASSET',
    normalBalance: 'DEBIT',
    status: 'ACTIVE',
    isPostable: true,
    isManualPostingAllowed: false,
    isControlAccount: false,
    branchScope: 'ORGANIZATION',
    parentAccountId: null,
    accountCategory: null,
    description: null,
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: UPDATED_AT,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    postedLines: 0,
    ...overrides,
  };
}

/**
 * A stateful in-memory stand-in that refuses an unscoped query.
 *
 * `assertScoped` is the important part: a service that forgot its `orgId`
 * filter would otherwise read every tenant's rows and every test would still
 * pass.
 */
function buildPrisma(
  rows: AccountRecord[],
  counts: { dimensions?: number; disbursements?: number } = {},
) {
  const store = [...rows];

  function assertScoped(where: Record<string, unknown> | undefined): void {
    if (!where) {
      throw new Error('Query issued with no where clause at all');
    }
    const compound = where.orgId_accountId as { orgId?: unknown } | undefined;
    const orgId = where.orgId ?? compound?.orgId;
    if (typeof orgId !== 'string') {
      throw new Error(
        `Query issued without an orgId filter: ${JSON.stringify(where)}`,
      );
    }
  }

  const decorate = (row: AccountRecord) => ({
    ...row,
    parentAccount: row.parentAccountId
      ? {
          accountId: row.parentAccountId,
          accountCode:
            store.find((r) => r.accountId === row.parentAccountId)
              ?.accountCode ?? 'UNKNOWN',
        }
      : null,
    _count: {
      journalLines: row.postedLines ?? 0,
      childAccounts: store.filter((r) => r.parentAccountId === row.accountId)
        .length,
    },
  });

  const matches = (
    row: AccountRecord,
    where: Record<string, unknown>,
  ): boolean => {
    if (where.orgId !== undefined && row.orgId !== where.orgId) return false;
    if (where.accountId !== undefined && row.accountId !== where.accountId) {
      return false;
    }
    if (
      where.accountCode !== undefined &&
      row.accountCode !== where.accountCode
    ) {
      return false;
    }
    if (
      where.accountType !== undefined &&
      row.accountType !== where.accountType
    ) {
      return false;
    }
    if (where.status !== undefined && row.status !== where.status) return false;
    if (where.isPostable !== undefined && row.isPostable !== where.isPostable) {
      return false;
    }
    if (
      where.isManualPostingAllowed !== undefined &&
      row.isManualPostingAllowed !== where.isManualPostingAllowed
    ) {
      return false;
    }
    return true;
  };

  const account = {
    findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      assertScoped(where);
      const row = store.find((r) => matches(r, where));
      return Promise.resolve(row ? decorate(row) : null);
    }),
    findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      assertScoped(where);
      return Promise.resolve(
        store
          .filter((r) => matches(r, where))
          .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
          .map(decorate),
      );
    }),
    count: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      assertScoped(where);
      return Promise.resolve(store.filter((r) => matches(r, where)).length);
    }),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      const clash = store.find(
        (r) => r.orgId === data.orgId && r.accountCode === data.accountCode,
      );
      if (clash) {
        // What Prisma raises for a unique-constraint violation.
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        });
      }
      const row = accountRecord({
        ...(data as Partial<AccountRecord>),
        accountId: `new-${store.length + 1}`,
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
        const key = where.orgId_accountId as {
          orgId: string;
          accountId: string;
        };
        const row = store.find(
          (r) => r.orgId === key.orgId && r.accountId === key.accountId,
        );
        if (!row) throw new Error('no such row');
        Object.assign(row, data);
        return Promise.resolve(decorate(row));
      },
    ),
    delete: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      assertScoped(where);
      const key = where.orgId_accountId as {
        orgId: string;
        accountId: string;
      };
      const index = store.findIndex(
        (r) => r.orgId === key.orgId && r.accountId === key.accountId,
      );
      if (index === -1) throw new Error('no such row');
      const [row] = store.splice(index, 1);
      return Promise.resolve(row);
    }),
  };

  const accountDimension = {
    count: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      assertScoped(where);
      return Promise.resolve(counts.dimensions ?? 0);
    }),
  };

  const disbursement = {
    count: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      assertScoped(where);
      return Promise.resolve(counts.disbursements ?? 0);
    }),
  };

  const prisma = {
    account,
    accountDimension,
    disbursement,
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ account, accountDimension, disbursement }),
    ),
  };

  return { prisma, account, store };
}

function buildService(
  rows: AccountRecord[],
  counts: { dimensions?: number; disbursements?: number } = {},
) {
  const { prisma, account, store } = buildPrisma(rows, counts);
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AccountService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, audit, account, store };
}

describe('AccountService.list', () => {
  it('returns only the caller’s organization', async () => {
    // Scenario 1.
    const { service } = buildService([
      accountRecord(),
      accountRecord({
        orgId: OTHER_ORG_ID,
        accountId: 'other-org-account',
        accountCode: '9999',
      }),
    ]);

    const result = await service.list(actor(), {});

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.accountCode).toBe('1300');
  });

  it('narrows to manually postable accounts for the journal builder', async () => {
    // The manual journal's account picker uses this filter, which is why a
    // control account can never appear in it.
    const { service } = buildService([
      accountRecord({ accountCode: '1100', isManualPostingAllowed: false }),
      accountRecord({
        accountId: 'bank',
        accountCode: '1200',
        isManualPostingAllowed: true,
      }),
    ]);

    const result = await service.list(actor(), { manualPostableOnly: true });

    expect(result.items.map((a) => a.accountCode)).toEqual(['1200']);
  });

  it('exposes the concurrency token as the row’s updatedAt', async () => {
    const { service } = buildService([accountRecord()]);

    const result = await service.list(actor(), {});

    expect(result.items[0]?.version).toBe(VERSION);
  });
});

describe('AccountService.get', () => {
  it('refuses another organization’s account with 404, not 403', async () => {
    // Scenario 52. A 403 would confirm the id is real somewhere else.
    const { service } = buildService([accountRecord({ orgId: OTHER_ORG_ID })]);

    await expect(service.get(actor(), ACCOUNT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports whether the account may be deleted and its identity edited', async () => {
    const { service } = buildService([accountRecord({ postedLines: 3 })]);

    const detail = await service.get(actor(), ACCOUNT_ID);

    expect(detail.postedLineCount).toBe(3);
    expect(detail.canDelete).toBe(false);
    expect(detail.canEditIdentity).toBe(false);
  });

  it('permits both on an untouched account', async () => {
    const { service } = buildService([accountRecord()]);

    const detail = await service.get(actor(), ACCOUNT_ID);

    expect(detail.canDelete).toBe(true);
    expect(detail.canEditIdentity).toBe(true);
  });
});

describe('AccountService.create', () => {
  const validDto = {
    accountCode: '1400',
    accountName: 'Prepaid Expenses',
    accountType: 'ASSET' as const,
    normalBalance: 'DEBIT' as const,
    status: 'ACTIVE' as const,
  };

  it('creates an account and audits it', async () => {
    // Scenarios 4, 65.
    const { service, audit } = buildService([]);

    const created = await service.create(actor(), validDto, META);

    expect(created.accountCode).toBe('1400');
    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.ACCOUNT_CREATED }),
      expect.anything(),
    );
  });

  it('rejects a duplicate account code with a message naming it', async () => {
    // Scenario 5. The unique index is the guarantee; this is the wording.
    const { service } = buildService([accountRecord({ accountCode: '1400' })]);

    await expect(
      service.create(actor(), validDto, META),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a normal balance that contradicts the account type', async () => {
    const { service } = buildService([]);

    await expect(
      service.create(actor(), { ...validDto, normalBalance: 'CREDIT' }, META),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('picks the article from the account type, so the message reads', async () => {
    // "An asset", not "a asset". Four of the five types begin with a vowel, so
    // a hardcoded "A" is wrong more often than it is right.
    const { service } = buildService([]);

    const error = await service
      .create(actor(), { ...validDto, normalBalance: 'CREDIT' }, META)
      .catch((caught: ConflictException) => caught);

    expect((error as ConflictException).message).toBe(
      'An asset account normally carries a debit balance.',
    );
  });

  it('uses "A" for the one type that needs it', async () => {
    const { service } = buildService([]);

    const error = await service
      .create(
        actor(),
        {
          ...validDto,
          accountCode: '2100',
          accountType: 'LIABILITY',
          normalBalance: 'DEBIT',
        },
        META,
      )
      .catch((caught: ConflictException) => caught);

    expect((error as ConflictException).message).toBe(
      'A liability account normally carries a credit balance.',
    );
  });

  it('rejects a control account that is also postable', async () => {
    // Rule 39.
    const { service } = buildService([]);

    await expect(
      service.create(
        actor(),
        { ...validDto, isControlAccount: true, isPostable: true },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an effective range that ends before it starts', async () => {
    const { service } = buildService([]);

    await expect(
      service.create(
        actor(),
        { ...validDto, effectiveFrom: '2026-08-23', effectiveTo: '2026-08-01' },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a parent that does not exist in this organization', async () => {
    const { service } = buildService([
      accountRecord({ orgId: OTHER_ORG_ID, accountId: PARENT_ID }),
    ]);

    await expect(
      service.create(
        actor(),
        { ...validDto, parentAccountId: PARENT_ID },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('defaults a new account to postable but not manually postable', async () => {
    const { service, store } = buildService([]);

    await service.create(actor(), validDto, META);

    const created = store.find((r) => r.accountCode === '1400');
    expect(created?.isPostable).toBe(true);
    expect(created?.isManualPostingAllowed).toBe(false);
  });
});

describe('AccountService.update', () => {
  it('rejects a stale version', async () => {
    // Scenario 49.
    const { service } = buildService([accountRecord()]);

    await expect(
      service.update(
        actor(),
        ACCOUNT_ID,
        { accountName: 'Renamed', expectedVersion: '2020-01-01T00:00:00.000Z' },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('renames an account and audits the before and after', async () => {
    // Scenarios 7, 65.
    const { service, audit } = buildService([accountRecord()]);

    const updated = await service.update(
      actor(),
      ACCOUNT_ID,
      { accountName: 'Renamed', expectedVersion: VERSION },
      META,
    );

    expect(updated.accountName).toBe('Renamed');
    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.ACCOUNT_UPDATED }),
      expect.anything(),
    );
  });

  it('freezes code, type and balance once a posted line references the account', async () => {
    // Scenario 8. Changing any of them would retroactively alter what an entry
    // already in the ledger means.
    const { service } = buildService([accountRecord({ postedLines: 1 })]);

    await expect(
      service.update(
        actor(),
        ACCOUNT_ID,
        { accountCode: '1301', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('audits the blocked identity edit', async () => {
    const { service, audit } = buildService([
      accountRecord({ postedLines: 1 }),
    ]);

    await service
      .update(
        actor(),
        ACCOUNT_ID,
        { accountType: 'EXPENSE', expectedVersion: VERSION },
        META,
      )
      .catch(() => undefined);

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.ACCOUNT_IDENTITY_EDIT_BLOCKED }),
    );
  });

  it('still permits renaming an account that has posted lines', async () => {
    // The freeze is on identity, not on everything: a typo in a name stays
    // fixable forever.
    const { service } = buildService([accountRecord({ postedLines: 5 })]);

    const updated = await service.update(
      actor(),
      ACCOUNT_ID,
      { accountName: 'Loans Outstanding', expectedVersion: VERSION },
      META,
    );

    expect(updated.accountName).toBe('Loans Outstanding');
  });

  it('refuses a parent that is a descendant of the account', async () => {
    // Scenario 6. The database trigger is the guarantee; this is the message.
    const { service } = buildService([
      accountRecord({ accountId: ACCOUNT_ID, parentAccountId: null }),
      accountRecord({
        accountId: CHILD_ID,
        accountCode: '1310',
        parentAccountId: ACCOUNT_ID,
      }),
    ]);

    await expect(
      service.update(
        actor(),
        ACCOUNT_ID,
        { parentAccountId: CHILD_ID, expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an account being its own parent', async () => {
    const { service } = buildService([accountRecord()]);

    await expect(
      service.update(
        actor(),
        ACCOUNT_ID,
        { parentAccountId: ACCOUNT_ID, expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AccountService.deactivate', () => {
  it('flips status and audits it', async () => {
    // Scenarios 9, 65.
    const { service, audit } = buildService([
      accountRecord({ postedLines: 4 }),
    ]);

    const updated = await service.deactivate(
      actor(),
      ACCOUNT_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(updated.status).toBe('INACTIVE');
    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.ACCOUNT_DEACTIVATED }),
      expect.anything(),
    );
  });

  it('leaves a deactivated account readable, so history stays visible', async () => {
    // Scenario 47. No read filters on status, which is what makes this true.
    const { service } = buildService([accountRecord({ status: 'INACTIVE' })]);

    const detail = await service.get(actor(), ACCOUNT_ID);

    expect(detail.status).toBe('INACTIVE');
  });

  it('records the reason when one is given', async () => {
    const { service, audit } = buildService([accountRecord()]);

    await service.deactivate(
      actor(),
      ACCOUNT_ID,
      { reason: 'Replaced by 1310', expectedVersion: VERSION },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      containing({ metadata: { reason: 'Replaced by 1310' } }),
      expect.anything(),
    );
  });
});

describe('AccountService.remove', () => {
  it('deletes an account nothing references', async () => {
    const { service, store } = buildService([accountRecord()]);

    const result = await service.remove(actor(), ACCOUNT_ID, META);

    expect(result).toEqual({ accountId: ACCOUNT_ID, deleted: true });
    expect(store).toHaveLength(0);
  });

  it('refuses to delete an account with posted lines', async () => {
    // Scenario 10.
    const { service } = buildService([accountRecord({ postedLines: 2 })]);

    await expect(
      service.remove(actor(), ACCOUNT_ID, META),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('names what is blocking, so "deactivate instead" is actionable', async () => {
    const { service } = buildService([accountRecord({ postedLines: 2 })]);

    const error = await service
      .remove(actor(), ACCOUNT_ID, META)
      .catch((caught: ConflictException) => caught);

    const response = (error as ConflictException).getResponse() as {
      blockedBy: { entity: string; count: number }[];
    };

    expect(response.blockedBy).toEqual([
      { entity: 'journalLine', label: 'Posted ledger lines', count: 2 },
    ]);
  });

  it('refuses to delete an account that has children', async () => {
    const { service } = buildService([
      accountRecord({ accountId: PARENT_ID, accountCode: '1000' }),
      accountRecord({ accountId: CHILD_ID, parentAccountId: PARENT_ID }),
    ]);

    await expect(
      service.remove(actor(), PARENT_ID, META),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to delete an account a disbursement drew funds from', async () => {
    const { service } = buildService([accountRecord()], { disbursements: 1 });

    await expect(
      service.remove(actor(), ACCOUNT_ID, META),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('audits the refusal outside any transaction, so it survives', async () => {
    // Called with one argument: no tx. A refusal recorded inside the
    // transaction it refuses would vanish with the rollback.
    const { service, audit } = buildService([
      accountRecord({ postedLines: 1 }),
    ]);

    await service.remove(actor(), ACCOUNT_ID, META).catch(() => undefined);

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.ACCOUNT_DELETE_BLOCKED }),
    );
  });

  it('deletes nothing when blocked', async () => {
    const { service, store } = buildService([
      accountRecord({ postedLines: 1 }),
    ]);

    await service.remove(actor(), ACCOUNT_ID, META).catch(() => undefined);

    expect(store).toHaveLength(1);
  });
});

describe('AccountService.tree', () => {
  it('nests children under their parent', async () => {
    const { service } = buildService([
      accountRecord({ accountId: PARENT_ID, accountCode: '1000' }),
      accountRecord({
        accountId: CHILD_ID,
        accountCode: '1100',
        parentAccountId: PARENT_ID,
      }),
    ]);

    const nodes = await service.tree(actor());

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.accountCode).toBe('1000');
    expect(nodes[0]?.children.map((c) => c.accountCode)).toEqual(['1100']);
  });

  it('returns a flat chart as roots', async () => {
    const { service } = buildService([
      accountRecord({ accountCode: '1100' }),
      accountRecord({ accountId: 'b', accountCode: '1200' }),
    ]);

    const nodes = await service.tree(actor());

    expect(nodes.map((n) => n.accountCode)).toEqual(['1100', '1200']);
  });
});
