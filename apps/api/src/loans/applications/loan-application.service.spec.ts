import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { CustomerService } from '../../customers/customer/customer.service';
import type { BranchService } from '../../organizations/branch.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateLoanApplicationDto } from './dto/loan-application.dto';
import type { LoanApplicationCompletenessService } from './loan-application-completeness.service';
import { LoanApplicationService } from './loan-application.service';
import type { LoanSchemeService } from '../products/loan-scheme.service';
import { notificationEventsStub } from '../../notifications/testing/notification-events.stub';

/**
 * Application creation, scoping and the application-number allocator.
 *
 * What carries the weight:
 *
 * 1. **Branch comes from the customer, never from the request.** Scenarios 41-43
 *    are meant to be impossible to express rather than merely refused, so the
 *    test asserts the written `branchId` regardless of what the payload claimed.
 * 2. **The number allocator sorts numerically.** A lexical `orderBy desc` is the
 *    bug that already bit customer codes once: `APP-ZZ04` sorts above
 *    `APP-000007`, `parseInt` yields NaN, and the allocator proposes a number
 *    that already exists. Pinned with a fixture containing exactly that shape.
 * 3. **Scheme terms are copied at creation**, which is what makes Scenario 39
 *    hold without the application module doing anything later.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const CUSTOMER_ID = '44444444-4444-4444-4444-444444444444';
const CUSTOMER_BRANCH = '55555555-5555-5555-5555-555555555555';
const OTHER_BRANCH = '66666666-6666-6666-6666-666666666666';
const SCHEME_ID = '77777777-7777-7777-7777-777777777777';
const PRODUCT_ID = '88888888-8888-8888-8888-888888888888';

const META: RequestMeta = {
  requestId: '99999999-9999-9999-9999-999999999999',
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
    permissions: ['loans.applications.view', 'loans.applications.create'],
    ...overrides,
  };
}

function validDto(): CreateLoanApplicationDto {
  return {
    customerId: CUSTOMER_ID,
    loanSchemeId: SCHEME_ID,
    requestedAmountPaise: '10000000',
    purpose: 'Working capital',
    interestType: 'REDUCING',
    interestRateBps: '1200',
    repaymentFrequency: 'MONTHLY',
    durationCount: 12,
  };
}

interface Harness {
  service: LoanApplicationService;
  audit: { record: jest.Mock };
  applicationCreate: jest.Mock;
  findMany: jest.Mock;
}

function harness(
  options: {
    customerStatus?: string;
    existingNumbers?: string[];
    schemeRateBps?: bigint;
  } = {},
): Harness {
  const applicationCreate = jest.fn(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...data, applicationId: 'created-id' }),
  );

  const findMany = jest.fn(() =>
    Promise.resolve(
      (options.existingNumbers ?? []).map((applicationNumber) => ({
        applicationNumber,
      })),
    ),
  );

  const loanApplication = {
    create: applicationCreate,
    findMany,
    findFirst: jest.fn(() => Promise.resolve(null)),
  };

  const tx = { loanApplication };
  const prisma = {
    ...tx,
    loanApplicationDocument: { findMany: jest.fn(() => Promise.resolve([])) },
    $transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as PrismaService;

  const audit = { record: jest.fn(() => Promise.resolve()) };

  const customers = {
    findInScope: jest.fn(() =>
      Promise.resolve({
        customerId: CUSTOMER_ID,
        branchId: CUSTOMER_BRANCH,
        status: options.customerStatus ?? 'ACTIVE',
      }),
    ),
  } as unknown as CustomerService;

  const branches = {
    assertBranchOperational: jest.fn(() => Promise.resolve()),
  } as unknown as BranchService;

  const schemes = {
    assertSelectable: jest.fn(() =>
      Promise.resolve({
        loanProductId: PRODUCT_ID,
        interestRateBps: options.schemeRateBps ?? 1_200n,
      }),
    ),
  } as unknown as LoanSchemeService;

  const completeness = {
    guarantorReadiness: jest.fn(() =>
      Promise.resolve({ satisfied: true, blockers: [] }),
    ),
    evaluate: jest.fn(),
  } as unknown as LoanApplicationCompletenessService;

  const events = notificationEventsStub();

  const service = new LoanApplicationService(
    prisma,
    audit as unknown as AuditService,
    customers,
    branches,
    schemes,
    completeness,
    events.service,
  );

  // `create` re-reads through getById; stubbed so the tests can assert on the
  // write rather than on a second read path they are not exercising.
  jest.spyOn(service, 'getById').mockResolvedValue({} as never);

  return { service, audit, applicationCreate, findMany };
}

describe('branch scope is derived, not accepted', () => {
  it("takes the branch from the customer's own record", async () => {
    const { service, applicationCreate } = harness();

    await service.create(actor(), validDto(), META);

    expect(applicationCreate).toHaveBeenCalledWith(
      containing({
        data: containing({ branchId: CUSTOMER_BRANCH, orgId: ORG_ID }),
      }),
    );
  });

  it('ignores a branchId smuggled into the payload (Scenario 43)', async () => {
    // There is no `branchId` field on the DTO, so `forbidNonWhitelisted` rejects
    // this at the edge in production. Asserted here too: if the field were ever
    // added to the DTO, this test fails rather than the scope silently widening.
    const { service, applicationCreate } = harness();

    await service.create(
      actor(),
      { ...validDto(), branchId: OTHER_BRANCH } as CreateLoanApplicationDto & {
        branchId: string;
      },
      META,
    );

    expect(applicationCreate).toHaveBeenCalledWith(
      containing({ data: containing({ branchId: CUSTOMER_BRANCH }) }),
    );
  });

  it('refuses a customer who is not active', async () => {
    const { service, applicationCreate, audit } = harness({
      customerStatus: 'INACTIVE',
    });

    await expect(
      service.create(actor(), validDto(), META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(applicationCreate).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_APPLICATION_CREATE_REJECTED }),
    );
  });

  it('resolves the customer through CustomerService rather than re-deriving scope', async () => {
    // Module 04 Rule 27: a second definition of which customers a caller can
    // reach is the easiest place for branch scope to be forgotten.
    const { service } = harness();
    const customers = (
      service as unknown as { customers: { findInScope: jest.Mock } }
    ).customers;

    await service.create(actor(), validDto(), META);

    expect(customers.findInScope).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOMER_ID,
      META,
    );
  });
});

describe('application number allocation', () => {
  it('starts at APP-000001 for the first application', async () => {
    const { service, applicationCreate } = harness({ existingNumbers: [] });

    await service.create(actor(), validDto(), META);

    expect(applicationCreate).toHaveBeenCalledWith(
      containing({ data: containing({ applicationNumber: 'APP-000001' }) }),
    );
  });

  it('takes the numeric maximum, not the lexical one', async () => {
    // The bug this pins bit customer codes once already: a lexical sort puts
    // APP-ZZ04 above APP-000007, parseInt("ZZ04") is NaN, and the allocator then
    // proposes a number that already exists — surfacing as a misleading 503.
    const { service, applicationCreate } = harness({
      existingNumbers: ['APP-000007', 'APP-ZZ04', 'APP-000002'],
    });

    await service.create(actor(), validDto(), META);

    expect(applicationCreate).toHaveBeenCalledWith(
      containing({ data: containing({ applicationNumber: 'APP-000008' }) }),
    );
  });

  it('ignores numbers that do not match the exact shape', async () => {
    const { service, applicationCreate } = harness({
      existingNumbers: ['APP-', 'APP-abc', 'APP-12X', 'APP-000003'],
    });

    await service.create(actor(), validDto(), META);

    expect(applicationCreate).toHaveBeenCalledWith(
      containing({ data: containing({ applicationNumber: 'APP-000004' }) }),
    );
  });

  it('translates a racing duplicate into a 409, never a 503', async () => {
    // The pre-read cannot exclude a concurrent create; the unique index is the
    // real guarantee. Untranslated, P2002 renders as a 503 about the auth service.
    const { service, applicationCreate } = harness();
    applicationCreate.mockRejectedValueOnce(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );

    await expect(
      service.create(actor(), validDto(), META),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('terms are copied from the scheme', () => {
  it('stores the product resolved from the scheme, not one supplied by the caller', async () => {
    const { service, applicationCreate } = harness();

    await service.create(actor(), validDto(), META);

    expect(applicationCreate).toHaveBeenCalledWith(
      containing({ data: containing({ loanProductId: PRODUCT_ID }) }),
    );
  });

  it('stores money as bigint paise and rate as bigint bps', async () => {
    const { service, applicationCreate } = harness();

    await service.create(actor(), validDto(), META);

    expect(applicationCreate).toHaveBeenCalledWith(
      containing({
        data: containing({
          requestedAmountPaise: 10_000_000n,
          interestRateBps: 1_200n,
        }),
      }),
    );
  });

  it('creates in DRAFT', async () => {
    const { service, applicationCreate } = harness();

    await service.create(actor(), validDto(), META);

    expect(applicationCreate).toHaveBeenCalledWith(
      containing({ data: containing({ status: 'DRAFT' }) }),
    );
  });

  it('validates the scheme through assertSelectable', async () => {
    const { service } = harness();
    const schemes = (
      service as unknown as { schemes: { assertSelectable: jest.Mock } }
    ).schemes;

    await service.create(actor(), validDto(), META);

    expect(schemes.assertSelectable).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      SCHEME_ID,
      'MONTHLY',
      12,
    );
  });
});

describe('rate override', () => {
  it('accepts a rate equal to the scheme without the override permission', async () => {
    const { service, applicationCreate } = harness({ schemeRateBps: 1_200n });

    await service.create(actor(), validDto(), META);

    expect(applicationCreate).toHaveBeenCalled();
  });

  it('refuses an off-scheme rate that is not CUSTOM_RATE', async () => {
    // Rules 53/54: pricing off the scheme is a deliberate act, and REDUCING at a
    // rate the scheme does not carry is a typo rather than a decision.
    const { service } = harness({ schemeRateBps: 1_200n });

    await expect(
      service.create(actor(), { ...validDto(), interestRateBps: '1500' }, META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a CUSTOM_RATE override without the permission', async () => {
    const { service } = harness({ schemeRateBps: 1_200n });

    await expect(
      service.create(
        actor(),
        { ...validDto(), interestType: 'CUSTOM_RATE', interestRateBps: '1500' },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows a CUSTOM_RATE override for a caller holding the permission', async () => {
    const { service, applicationCreate } = harness({ schemeRateBps: 1_200n });

    await service.create(
      actor({
        permissions: [
          'loans.applications.create',
          'loans.applications.override_rate',
        ],
      }),
      { ...validDto(), interestType: 'CUSTOM_RATE', interestRateBps: '1500' },
      META,
    );

    expect(applicationCreate).toHaveBeenCalledWith(
      containing({ data: containing({ interestRateBps: 1_500n }) }),
    );
  });
});

describe('scope denial', () => {
  it('answers 404 for an application outside the caller scope', async () => {
    // 404 rather than 403: a 403 would confirm the id exists, which is the
    // disclosure Scenarios 3 and 4 are about.
    const { service, audit } = harness();

    await expect(
      service.findInScope(
        actor(),
        'dddddddd-dddd-dddd-dddd-dddddddddddd',
        META,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_APPLICATION_SCOPE_DENIED }),
    );
  });

  it('applies the branch filter for a branch-scoped caller', async () => {
    const { service } = harness();
    const prisma = (
      service as unknown as {
        prisma: { loanApplication: { findFirst: jest.Mock } };
      }
    ).prisma;

    await expect(
      service.findInScope(
        actor({ branchId: CUSTOMER_BRANCH }),
        'dddddddd-dddd-dddd-dddd-dddddddddddd',
        META,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.loanApplication.findFirst).toHaveBeenCalledWith(
      containing({ where: containing({ branchId: CUSTOMER_BRANCH }) }),
    );
  });

  it('applies no branch filter for an organization-wide caller', async () => {
    const { service } = harness();
    const prisma = (
      service as unknown as {
        prisma: { loanApplication: { findFirst: jest.Mock } };
      }
    ).prisma;

    await expect(
      service.findInScope(
        actor(),
        'dddddddd-dddd-dddd-dddd-dddddddddddd',
        META,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    const call = prisma.loanApplication.findFirst.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(call[0].where).not.toHaveProperty('branchId');
  });
});

describe('EMI preview', () => {
  it('returns a schedule as decimal strings', () => {
    const { service } = harness();

    const preview = service.preview({
      principalPaise: '10000000',
      annualRateBps: '1200',
      interestType: 'REDUCING',
      frequency: 'MONTHLY',
      durationCount: 12,
      startDate: '2026-01-15',
    });

    expect(preview.installmentCount).toBe(12);
    expect(preview.firstDueDate).toBe('2026-02-15');
    expect(typeof preview.totalPayablePaise).toBe('string');
    expect(preview.installments).toHaveLength(12);
  });

  it('turns a calculation failure into a 400, not a null result', () => {
    // The caller asked for a schedule and there isn't one; a null would read as
    // "no interest" to anything that did not check.
    const { service } = harness();

    expect(() =>
      service.preview({
        principalPaise: '0',
        annualRateBps: '1200',
        interestType: 'REDUCING',
        frequency: 'MONTHLY',
        durationCount: 12,
      }),
    ).toThrow(BadRequestException);
  });
});
