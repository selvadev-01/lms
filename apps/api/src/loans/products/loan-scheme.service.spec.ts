import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { LoanSchemeService } from './loan-scheme.service';

/**
 * Loan Schemes — selectability, activation guard and the duration delete guard.
 *
 * The selectability rule carries the most weight, because Module 07 leans on it
 * for Scenarios 10, 11, 38 and 44. It has three independent halves, and each has
 * its own test: the scheme's status, its product's status, and whether any
 * active duration option exists. A rule that checked only two of the three would
 * still pass a naive happy-path test, so they are pinned separately.
 *
 * `assertSelectable` is tested directly rather than through submit, because it
 * is the seam Module 07 will call inside its own transaction — the contract that
 * matters is this function's, not its eventual caller's.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const SCHEME_ID = '44444444-4444-4444-4444-444444444444';
const PRODUCT_ID = '55555555-5555-5555-5555-555555555555';
const DURATION_ID = '66666666-6666-6666-6666-666666666666';
const UNKNOWN_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const VERSION = '2026-08-19T12:00:00.000Z';
const STALE_VERSION = '2026-08-19T11:00:00.000Z';

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
    permissions: [
      'loans.schemes.view',
      'loans.schemes.manage',
      'loans.schemes.activate',
    ],
    ...overrides,
  };
}

type DurationRow = {
  loanSchemeDurationId: string;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  durationCount: number;
  status: 'ACTIVE' | 'INACTIVE';
};

type SchemeRow = {
  orgId: string;
  loanSchemeId: string;
  loanProductId: string;
  code: string;
  name: string;
  interestType: 'FLAT' | 'REDUCING' | 'CUSTOM_RATE';
  interestRateBps: bigint;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
  loanProduct: {
    code: string;
    name: string;
    loanType: 'PERSONAL' | 'BUSINESS' | 'GOLD' | 'VEHICLE';
    status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  };
  durations: DurationRow[];
};

function buildDuration(overrides: Partial<DurationRow> = {}): DurationRow {
  return {
    loanSchemeDurationId: DURATION_ID,
    frequency: 'MONTHLY',
    durationCount: 12,
    status: 'ACTIVE',
    ...overrides,
  };
}

function buildScheme(overrides: Partial<SchemeRow> = {}): SchemeRow {
  return {
    orgId: ORG_ID,
    loanSchemeId: SCHEME_ID,
    loanProductId: PRODUCT_ID,
    code: 'SCH-PERS-RED',
    name: 'Personal Reducing 12%',
    interestType: 'REDUCING',
    interestRateBps: 1_200n,
    status: 'ACTIVE',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date(VERSION),
    loanProduct: {
      code: 'PROD-PERSONAL',
      name: 'Personal Loan',
      loanType: 'PERSONAL',
      status: 'ACTIVE',
    },
    durations: [buildDuration()],
    ...overrides,
  };
}

interface Harness {
  service: LoanSchemeService;
  audit: { record: jest.Mock };
  schemeUpdate: jest.Mock;
  durationDelete: jest.Mock;
  applicationCount: jest.Mock;
  prisma: PrismaService;
}

function harness(
  rows: SchemeRow[] = [buildScheme()],
  applicationCount = 0,
): Harness {
  const findUnique = jest.fn((args: { where: Record<string, unknown> }) => {
    if ('orgId_code' in args.where) {
      const key = args.where.orgId_code as { orgId: string; code: string };
      return Promise.resolve(
        rows.find((row) => row.orgId === key.orgId && row.code === key.code) ??
          null,
      );
    }
    const key = args.where.orgId_loanSchemeId as {
      orgId: string;
      loanSchemeId: string;
    };
    return Promise.resolve(
      rows.find(
        (row) =>
          row.orgId === key.orgId && row.loanSchemeId === key.loanSchemeId,
      ) ?? null,
    );
  });

  const schemeUpdate = jest.fn(({ data }: { data: Partial<SchemeRow> }) =>
    Promise.resolve(buildScheme({ ...data, updatedAt: new Date() })),
  );

  const loanScheme = {
    findMany: jest.fn(({ where }: { where: { orgId: string } }) =>
      Promise.resolve(rows.filter((row) => row.orgId === where.orgId)),
    ),
    findUnique,
    create: jest.fn(({ data }: { data: Partial<SchemeRow> }) =>
      Promise.resolve(buildScheme(data)),
    ),
    update: schemeUpdate,
  };

  const durationDelete = jest.fn(() => Promise.resolve({}));
  const loanSchemeDuration = {
    create: jest.fn(({ data }: { data: Partial<DurationRow> }) =>
      Promise.resolve(buildDuration(data)),
    ),
    update: jest.fn(() => Promise.resolve({})),
    delete: durationDelete,
  };

  const applicationCountMock = jest.fn(() => Promise.resolve(applicationCount));
  const loanApplication = { count: applicationCountMock };
  const loanProduct = {
    findUnique: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      const key = where.orgId_loanProductId as {
        orgId: string;
        loanProductId: string;
      };
      return Promise.resolve(
        key.orgId === ORG_ID && key.loanProductId === PRODUCT_ID
          ? { orgId: ORG_ID, loanProductId: PRODUCT_ID, status: 'ACTIVE' }
          : null,
      );
    }),
  };

  const tx = { loanScheme, loanSchemeDuration, loanApplication, loanProduct };
  const prisma = {
    ...tx,
    $transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as PrismaService;

  const audit = { record: jest.fn(() => Promise.resolve()) };

  return {
    service: new LoanSchemeService(prisma, audit as unknown as AuditService),
    audit,
    schemeUpdate,
    durationDelete,
    applicationCount: applicationCountMock,
    prisma,
  };
}

describe('LoanSchemeService — tenancy', () => {
  it('refuses a scheme in another organization as not found', async () => {
    const { service, audit } = harness([
      buildScheme({ orgId: OTHER_ORG_ID, loanSchemeId: UNKNOWN_ID }),
    ]);

    await expect(
      service.getById(actor(), UNKNOWN_ID, META),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_SCHEME_SCOPE_DENIED }),
    );
  });

  it('serializes the rate as a string, never a number', async () => {
    // JSON.stringify throws on a raw bigint, and Number() would start losing
    // precision. The string is the only representation that survives the wire.
    const { service } = harness();

    const detail = await service.getById(actor(), SCHEME_ID, META);

    expect(detail.interestRateBps).toBe('1200');
    expect(typeof detail.interestRateBps).toBe('string');
  });
});

describe('LoanSchemeService — activation guard', () => {
  const activate = { status: 'ACTIVE' as const, expectedVersion: VERSION };

  it('activates a scheme that has an active duration option', async () => {
    const { service, schemeUpdate } = harness([
      buildScheme({ status: 'DRAFT' }),
    ]);

    await service.setStatus(actor(), SCHEME_ID, activate, META);

    expect(schemeUpdate).toHaveBeenCalled();
  });

  it('refuses to activate a scheme with no duration options', async () => {
    // A scheme nothing can be borrowed over would appear in the wizard's picker
    // and then fail every submission against it.
    const { service, schemeUpdate, audit } = harness([
      buildScheme({ status: 'DRAFT', durations: [] }),
    ]);

    await expect(
      service.setStatus(actor(), SCHEME_ID, activate, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(schemeUpdate).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_SCHEME_ACTIVATION_BLOCKED }),
    );
  });

  it('refuses to activate when every duration option is inactive', async () => {
    // Distinct from having none at all: the rows exist, so a guard that only
    // counted rows rather than active ones would wrongly pass here.
    const { service, schemeUpdate } = harness([
      buildScheme({
        status: 'DRAFT',
        durations: [buildDuration({ status: 'INACTIVE' })],
      }),
    ]);

    await expect(
      service.setStatus(actor(), SCHEME_ID, activate, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(schemeUpdate).not.toHaveBeenCalled();
  });

  it('applies no such guard when deactivating', async () => {
    // Withdrawing a scheme must always be possible; the guard exists to stop a
    // useless scheme going live, not to trap one in service.
    const { service, schemeUpdate } = harness([buildScheme({ durations: [] })]);

    await service.setStatus(
      actor(),
      SCHEME_ID,
      { status: 'INACTIVE', expectedVersion: VERSION },
      META,
    );

    expect(schemeUpdate).toHaveBeenCalled();
  });

  it('checks the version before changing status', async () => {
    const { service, schemeUpdate } = harness([
      buildScheme({ status: 'DRAFT' }),
    ]);

    await expect(
      service.setStatus(
        actor(),
        SCHEME_ID,
        { ...activate, expectedVersion: STALE_VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(schemeUpdate).not.toHaveBeenCalled();
  });
});

describe('LoanSchemeService — assertSelectable', () => {
  /** The seam Module 07 calls inside its own submit transaction. */
  function callAssert(rows: SchemeRow[], frequency = 'MONTHLY', count = 12) {
    const { service, prisma } = harness(rows);
    return service.assertSelectable(
      prisma,
      ORG_ID,
      SCHEME_ID,
      frequency as 'MONTHLY',
      count,
    );
  }

  it('accepts an active scheme under an active product with a matching term', async () => {
    await expect(callAssert([buildScheme()])).resolves.toBeDefined();
  });

  it('refuses when the scheme itself is inactive (Scenario 10)', async () => {
    await expect(
      callAssert([buildScheme({ status: 'INACTIVE' })]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses when the product is inactive even though the scheme is active', async () => {
    // The second half of the rule. A scheme active under a withdrawn product is
    // exactly what a status cascade would have hidden.
    await expect(
      callAssert([
        buildScheme({
          loanProduct: {
            code: 'PROD-PERSONAL',
            name: 'Personal Loan',
            loanType: 'PERSONAL',
            status: 'INACTIVE',
          },
        }),
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a frequency the scheme does not offer (Scenario 11)', async () => {
    await expect(
      callAssert([buildScheme()], 'WEEKLY', 12),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a duration count the scheme does not offer (Scenario 11)', async () => {
    // The pair is the unit: 12 monthly being offered says nothing about 18.
    await expect(
      callAssert([buildScheme()], 'MONTHLY', 18),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a term whose option exists but is deactivated', async () => {
    await expect(
      callAssert([
        buildScheme({ durations: [buildDuration({ status: 'INACTIVE' })] }),
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a scheme in another organization (Scenario 44)', async () => {
    await expect(
      callAssert([buildScheme({ orgId: OTHER_ORG_ID })]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LoanSchemeService — duration delete guard', () => {
  it('deletes an option nothing references', async () => {
    const { service, durationDelete } = harness([buildScheme()], 0);

    await service.removeDuration(actor(), SCHEME_ID, DURATION_ID, META);

    expect(durationDelete).toHaveBeenCalled();
  });

  it('refuses to delete an option applications already use', async () => {
    // There is no FK from LoanApplication to LoanSchemeDuration — the
    // application stores the frequency and count as values — so nothing in the
    // database would stop this. The guard is the only thing that does.
    const { service, durationDelete, audit } = harness([buildScheme()], 3);

    await expect(
      service.removeDuration(actor(), SCHEME_ID, DURATION_ID, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(durationDelete).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_SCHEME_DURATION_DELETE_BLOCKED }),
      expect.anything(),
    );
  });

  it('counts only applications on the same scheme and matching term', async () => {
    const { service, applicationCount } = harness([buildScheme()], 0);

    await service.removeDuration(actor(), SCHEME_ID, DURATION_ID, META);

    expect(applicationCount).toHaveBeenCalledWith(
      containing({
        where: containing({
          orgId: ORG_ID,
          loanSchemeId: SCHEME_ID,
          repaymentFrequency: 'MONTHLY',
          durationCount: 12,
        }),
      }),
    );
  });

  it('refuses an unknown duration id', async () => {
    const { service } = harness();

    await expect(
      service.removeDuration(actor(), SCHEME_ID, UNKNOWN_ID, META),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
