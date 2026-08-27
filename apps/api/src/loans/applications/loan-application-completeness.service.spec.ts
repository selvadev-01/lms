import type { GuarantorService } from '../../customers/guarantor/guarantor.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LoanApplicationCompletenessService,
  requiredDocumentTypes,
} from './loan-application-completeness.service';
import type { ApplicationWithRelations } from './loan-application.mapper';

/**
 * The submit gate.
 *
 * Each of the nine checks gets its own test, because they are independent and a
 * gate that quietly stopped running one of them would still pass a happy-path
 * test. The shape assertions matter too: step 6 renders a stable list with green
 * ticks, which only works if every check is always returned rather than only the
 * failing ones.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const APPLICATION_ID = '44444444-4444-4444-4444-444444444444';
const CUSTOMER_ID = '77777777-7777-7777-7777-777777777777';
const SCHEME_ID = '55555555-5555-5555-5555-555555555555';

const VERSION = '2026-08-19T12:00:00.000Z';

function buildApplication(
  overrides: Partial<ApplicationWithRelations> = {},
): ApplicationWithRelations {
  return {
    orgId: ORG_ID,
    applicationId: APPLICATION_ID,
    applicationNumber: 'APP-000001',
    branchId: '66666666-6666-6666-6666-666666666666',
    customerId: CUSTOMER_ID,
    loanProductId: '99999999-9999-9999-9999-999999999999',
    loanSchemeId: SCHEME_ID,
    requestedAmountPaise: 10_000_000n,
    purpose: 'Working capital',
    interestType: 'REDUCING',
    interestRateBps: 1_200n,
    repaymentFrequency: 'MONTHLY',
    durationCount: 12,
    status: 'DRAFT',
    rejectionReason: null,
    submittedAt: null,
    approvedAt: null,
    approvedBy: null,
    sanctionedAt: null,
    customerRespondedAt: null,
    agreementSignedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date(VERSION),
    customer: { fullName: 'Anitha Raman', customerCode: 'CUST001' },
    branch: { name: 'Chennai Main Branch' },
    loanProduct: { code: 'PROD-PERSONAL', loanType: 'PERSONAL' },
    loanScheme: { code: 'SCH-PERS-RED', name: 'Personal Reducing 12%' },
    ...overrides,
  };
}

interface Options {
  customerStatus?: string;
  schemeStatus?: string;
  productStatus?: string;
  schemeRateBps?: bigint;
  durations?: { status: string; frequency: string; durationCount: number }[];
  documentTypes?: string[];
  schemeMissing?: boolean;
}

function harness(options: Options = {}) {
  const prisma = {
    customer: {
      findUnique: jest.fn(() =>
        Promise.resolve({ status: options.customerStatus ?? 'ACTIVE' }),
      ),
    },
    loanScheme: {
      findUnique: jest.fn(() =>
        Promise.resolve(
          options.schemeMissing
            ? null
            : {
                status: options.schemeStatus ?? 'ACTIVE',
                interestType: 'REDUCING',
                interestRateBps: options.schemeRateBps ?? 1_200n,
                loanProduct: { status: options.productStatus ?? 'ACTIVE' },
                durations: options.durations ?? [
                  { status: 'ACTIVE', frequency: 'MONTHLY', durationCount: 12 },
                ],
              },
        ),
      ),
    },
    loanApplicationDocument: {
      findMany: jest.fn(() =>
        Promise.resolve(
          (options.documentTypes ?? ['ID', 'INCOME']).map((documentType) => ({
            documentType,
          })),
        ),
      ),
    },
  } as unknown as PrismaService;

  const guarantors = {
    evaluateReadiness: jest.fn(),
  } as unknown as GuarantorService;

  return {
    service: new LoanApplicationCompletenessService(prisma, guarantors),
    prisma,
  };
}

/**
 * `expect.objectContaining` is typed `any`, which trips `no-unsafe-assignment`
 * as soon as it is nested inside an object literal. Narrowing it once here keeps
 * the assertions both readable and type-safe.
 */
function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

const READY = { satisfied: true, blockers: [] };

function checkFor(
  result: { checks: { key: string; satisfied: boolean; reason?: string }[] },
  key: string,
) {
  const check = result.checks.find((candidate) => candidate.key === key);
  if (!check) throw new Error(`no check for ${key}`);
  return check;
}

describe('the happy path', () => {
  it('is submittable when every check passes', async () => {
    const { service, prisma } = harness();

    const result = await service.evaluate(prisma, buildApplication(), READY);

    expect(result.submittable).toBe(true);
    expect(result.checks.every((check) => check.satisfied)).toBe(true);
  });

  it('always returns all nine checks, in a fixed order', async () => {
    // Step 6 renders a stable list with green ticks; a response that shrank as
    // problems were fixed would make the summary jump around.
    const { service, prisma } = harness();

    const result = await service.evaluate(prisma, buildApplication(), READY);

    expect(result.checks.map((check) => check.key)).toEqual([
      'CUSTOMER_ACTIVE',
      'SCHEME_ACTIVE',
      'DURATION_SUPPORTED',
      'AMOUNT_VALID',
      'PURPOSE_PRESENT',
      'RATE_VALID',
      'GUARANTORS_READY',
      'DOCUMENTS_COMPLETE',
      'EMI_COMPUTES',
    ]);
  });

  it('carries the version so step 6 can submit without re-fetching', async () => {
    const { service, prisma } = harness();

    const result = await service.evaluate(prisma, buildApplication(), READY);

    expect(result.version).toBe(VERSION);
  });
});

describe('each check fails independently', () => {
  it('fails on an inactive customer', async () => {
    const { service, prisma } = harness({ customerStatus: 'INACTIVE' });

    const result = await service.evaluate(prisma, buildApplication(), READY);

    expect(result.submittable).toBe(false);
    expect(checkFor(result, 'CUSTOMER_ACTIVE').satisfied).toBe(false);
  });

  it('fails on a deactivated scheme (Scenario 10)', async () => {
    const { service, prisma } = harness({ schemeStatus: 'INACTIVE' });

    const result = await service.evaluate(prisma, buildApplication(), READY);

    expect(checkFor(result, 'SCHEME_ACTIVE').reason).toBe('SCHEME_INACTIVE');
  });

  it('fails on a withdrawn product even when the scheme is active', async () => {
    // The second half of selectability, and the one a status cascade would hide.
    const { service, prisma } = harness({ productStatus: 'INACTIVE' });

    const result = await service.evaluate(prisma, buildApplication(), READY);

    expect(checkFor(result, 'SCHEME_ACTIVE').reason).toBe('PRODUCT_INACTIVE');
  });

  it('fails on a term the scheme does not offer (Scenario 11)', async () => {
    const { service, prisma } = harness({
      durations: [{ status: 'ACTIVE', frequency: 'MONTHLY', durationCount: 6 }],
    });

    const result = await service.evaluate(prisma, buildApplication(), READY);

    expect(checkFor(result, 'DURATION_SUPPORTED').reason).toBe(
      'TERM_NOT_OFFERED',
    );
  });

  it('fails on a term whose option exists but is deactivated', async () => {
    const { service, prisma } = harness({
      durations: [
        { status: 'INACTIVE', frequency: 'MONTHLY', durationCount: 12 },
      ],
    });

    const result = await service.evaluate(prisma, buildApplication(), READY);

    expect(checkFor(result, 'DURATION_SUPPORTED').satisfied).toBe(false);
  });

  it('fails on a zero amount (Scenario 8)', async () => {
    const { service, prisma } = harness();

    const result = await service.evaluate(
      prisma,
      buildApplication({ requestedAmountPaise: 0n }),
      READY,
    );

    expect(checkFor(result, 'AMOUNT_VALID').satisfied).toBe(false);
  });

  it('fails on a missing purpose (Rule 11)', async () => {
    // The column is nullable but the rule is not, so this is the only thing
    // enforcing it — the database would happily accept the row.
    const { service, prisma } = harness();

    const result = await service.evaluate(
      prisma,
      buildApplication({ purpose: null }),
      READY,
    );

    expect(checkFor(result, 'PURPOSE_PRESENT').satisfied).toBe(false);
  });

  it('fails on a whitespace-only purpose', async () => {
    const { service, prisma } = harness();

    const result = await service.evaluate(
      prisma,
      buildApplication({ purpose: '   ' }),
      READY,
    );

    expect(checkFor(result, 'PURPOSE_PRESENT').satisfied).toBe(false);
  });

  it('fails on an off-scheme rate that is not CUSTOM_RATE', async () => {
    const { service, prisma } = harness({ schemeRateBps: 1_200n });

    const result = await service.evaluate(
      prisma,
      buildApplication({ interestRateBps: 1_800n }),
      READY,
    );

    expect(checkFor(result, 'RATE_VALID').reason).toBe(
      'RATE_DIFFERS_FROM_SCHEME',
    );
  });

  it('accepts an off-scheme rate under CUSTOM_RATE', async () => {
    const { service, prisma } = harness({ schemeRateBps: 1_200n });

    const result = await service.evaluate(
      prisma,
      buildApplication({
        interestRateBps: 1_800n,
        interestType: 'CUSTOM_RATE',
      }),
      READY,
    );

    expect(checkFor(result, 'RATE_VALID').satisfied).toBe(true);
  });

  it('fails when a guarantor is unusable', async () => {
    const { service, prisma } = harness();

    const result = await service.evaluate(prisma, buildApplication(), {
      satisfied: false,
      blockers: [{ guarantorId: 'g1', reasons: ['CONSENT_PENDING'] }],
    });

    expect(checkFor(result, 'GUARANTORS_READY').satisfied).toBe(false);
  });

  it('passes when the customer has no guarantors at all (D-APP-2)', async () => {
    // Absence never blocks: whether a guarantor was required is this module's
    // call, and the source never says one is (Q-APP-95).
    const { service, prisma } = harness();

    const result = await service.evaluate(prisma, buildApplication(), READY);

    expect(checkFor(result, 'GUARANTORS_READY').satisfied).toBe(true);
  });

  it('fails and names the missing documents (Scenario 18)', async () => {
    const { service, prisma } = harness({ documentTypes: ['ID'] });

    const result = await service.evaluate(prisma, buildApplication(), READY);

    expect(checkFor(result, 'DOCUMENTS_COMPLETE').satisfied).toBe(false);
    expect(result.missingDocumentTypes).toEqual(['INCOME']);
  });

  it('fails when the terms produce no schedule (Scenario 12)', async () => {
    const { service, prisma } = harness();

    const result = await service.evaluate(
      prisma,
      buildApplication({ durationCount: 0 }),
      READY,
    );

    expect(checkFor(result, 'EMI_COMPUTES').satisfied).toBe(false);
    // No partial schedule is offered alongside the failure.
    expect(result.emi).toBeNull();
  });
});

describe('required document types by product (D-APP-3)', () => {
  it('requires ID and income for an unsecured product', () => {
    expect(requiredDocumentTypes('PERSONAL')).toEqual(['ID', 'INCOME']);
    expect(requiredDocumentTypes('BUSINESS')).toEqual(['ID', 'INCOME']);
  });

  it('additionally requires collateral for gold and vehicle', () => {
    // A gold loan with no collateral document is the case this exists to stop.
    expect(requiredDocumentTypes('GOLD')).toEqual([
      'ID',
      'INCOME',
      'COLLATERAL',
    ]);
    expect(requiredDocumentTypes('VEHICLE')).toEqual([
      'ID',
      'INCOME',
      'COLLATERAL',
    ]);
  });

  it('demands collateral on a gold application that lacks it', async () => {
    const { service, prisma } = harness({ documentTypes: ['ID', 'INCOME'] });

    const result = await service.evaluate(
      prisma,
      buildApplication({
        loanProduct: { code: 'PROD-GOLD', loanType: 'GOLD' },
      }),
      READY,
    );

    expect(result.missingDocumentTypes).toEqual(['COLLATERAL']);
  });

  it('ignores superseded and rejected documents when counting', async () => {
    // A replaced document evidences nothing, and a rejected one was reviewed and
    // found wanting — so the requirement is still outstanding in both cases.
    const { service, prisma } = harness();

    await service.evaluate(prisma, buildApplication(), READY);

    const findMany = (
      prisma as unknown as { loanApplicationDocument: { findMany: jest.Mock } }
    ).loanApplicationDocument.findMany;

    expect(findMany).toHaveBeenCalledWith(
      containing({
        where: containing({
          supersededAt: null,
          status: { not: 'REJECTED' },
        }),
      }),
    );
  });
});
