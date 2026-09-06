import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateLoanProductDto } from './dto/create-loan-product.dto';
import type { SetLoanConfigStatusDto } from './dto/set-loan-config-status.dto';
import type { UpdateLoanProductDto } from './dto/update-loan-product.dto';
import { LoanProductService } from './loan-product.service';

/**
 * Loan Products — tenancy, concurrency and the create/status lifecycle.
 *
 * What carries the weight here:
 *
 * 1. **Tenancy.** Every query must name the caller's own `orgId`, and a product
 *    in another organization must be indistinguishable from one that does not
 *    exist. The Prisma stand-in throws on an unmodelled `where` shape, so a
 *    query that stopped filtering by org would fail rather than quietly pass.
 * 2. **Concurrency.** `expectedVersion` is the ISO `updatedAt`; a stale one is a
 *    409 and must leave the row untouched.
 * 3. **DRAFT on create.** A product is never born ACTIVE, however privileged the
 *    caller — activation is a separate decision under a separate permission.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const PRODUCT_ID = '44444444-4444-4444-4444-444444444444';
const UNKNOWN_PRODUCT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

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
      'loans.products.view',
      'loans.products.manage',
      'loans.products.activate',
    ],
    ...overrides,
  };
}

type ProductRow = {
  orgId: string;
  loanProductId: string;
  code: string;
  name: string;
  loanType: string;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
};

function buildProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    orgId: ORG_ID,
    loanProductId: PRODUCT_ID,
    code: 'PROD-PERSONAL',
    name: 'Personal Loan',
    loanType: 'PERSONAL',
    status: 'ACTIVE',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date(VERSION),
    ...overrides,
  };
}

interface Harness {
  service: LoanProductService;
  audit: { record: jest.Mock };
  productUpdate: jest.Mock;
  productCreate: jest.Mock;
}

/**
 * Builds the service over a Prisma stand-in seeded with `rows`.
 *
 * Lookups honour `orgId` for real rather than ignoring it, so a service that
 * dropped the tenant filter would start returning another organization's row and
 * the tenancy tests would fail — which is the point of modelling it at all.
 */
function harness(
  rows: ProductRow[] = [buildProduct()],
  /** Loan type code -> its master-data status. Omit to accept any type. */
  loanTypeOptions?: Record<string, 'ACTIVE' | 'INACTIVE'>,
): Harness {
  const findUnique = jest.fn(
    ({
      where,
    }: {
      where: { orgId_loanProductId: { orgId: string; loanProductId: string } };
    }) => {
      const key = where.orgId_loanProductId;
      return Promise.resolve(
        rows.find(
          (row) =>
            row.orgId === key.orgId && row.loanProductId === key.loanProductId,
        ) ?? null,
      );
    },
  );

  const findUniqueByCode = jest.fn(
    ({ where }: { where: { orgId_code: { orgId: string; code: string } } }) => {
      const key = where.orgId_code;
      return Promise.resolve(
        rows.find((row) => row.orgId === key.orgId && row.code === key.code) ??
          null,
      );
    },
  );

  const productUpdate = jest.fn(({ data }: { data: Partial<ProductRow> }) =>
    Promise.resolve(buildProduct({ ...data, updatedAt: new Date() })),
  );

  const productCreate = jest.fn(({ data }: { data: Partial<ProductRow> }) =>
    Promise.resolve(buildProduct(data)),
  );

  const loanProduct = {
    findMany: jest.fn(({ where }: { where: { orgId: string } }) =>
      Promise.resolve(rows.filter((row) => row.orgId === where.orgId)),
    ),
    findUnique: jest.fn((args: { where: Record<string, unknown> }) =>
      'orgId_code' in args.where
        ? findUniqueByCode(args as never)
        : findUnique(args as never),
    ),
    create: productCreate,
    update: productUpdate,
  };

  const loanScheme = { findMany: jest.fn(() => Promise.resolve([])) };

  /**
   * The `LOAN_TYPE` option list this org offers.
   *
   * `create` and `update` now refuse a loan type that is not an ACTIVE row
   * here — the column is an open string since types became master data, so
   * without this check a typo would create a product of a type no dropdown
   * offers. The default answers ACTIVE for anything, keeping the existing tests
   * about codes, versions and status about those things; the tests that care
   * pass `loanTypeOptions` explicitly.
   */
  const masterDataValue = {
    findUnique: jest.fn(
      ({ where }: { where: { orgId_category_code: { code: string } } }) => {
        const code = where.orgId_category_code.code;
        if (!loanTypeOptions) return Promise.resolve({ status: 'ACTIVE' });
        return Promise.resolve(
          code in loanTypeOptions ? { status: loanTypeOptions[code] } : null,
        );
      },
    ),
  };

  const prisma = {
    loanProduct,
    loanScheme,
    masterDataValue,
    $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
      callback({ loanProduct, loanScheme, masterDataValue }),
    ),
  } as unknown as PrismaService;

  const audit = { record: jest.fn(() => Promise.resolve()) };

  return {
    service: new LoanProductService(prisma, audit as unknown as AuditService),
    audit,
    productUpdate,
    productCreate,
  };
}

describe('LoanProductService — tenancy', () => {
  it('scopes the list to the caller organization', async () => {
    const { service } = harness([
      buildProduct(),
      buildProduct({
        orgId: OTHER_ORG_ID,
        loanProductId: UNKNOWN_PRODUCT,
        code: 'OTHER',
      }),
    ]);

    const products = await service.list(actor(), {}, META);

    expect(products).toHaveLength(1);
    expect(products[0]?.code).toBe('PROD-PERSONAL');
  });

  it('refuses a product belonging to another organization as not found', async () => {
    // Indistinguishable from a product that does not exist: telling the two
    // apart would let a caller enumerate another tenant's product ids.
    const { service, audit } = harness([
      buildProduct({ orgId: OTHER_ORG_ID, loanProductId: UNKNOWN_PRODUCT }),
    ]);

    await expect(
      service.getById(actor(), UNKNOWN_PRODUCT, META),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_PRODUCT_SCOPE_DENIED,
        entityId: UNKNOWN_PRODUCT,
      }),
    );
  });

  it('audits a read', async () => {
    const { service, audit } = harness();

    await service.getById(actor(), PRODUCT_ID, META);

    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_PRODUCT_VIEWED,
        entityId: PRODUCT_ID,
      }),
    );
  });
});

describe('LoanProductService — create', () => {
  const dto: CreateLoanProductDto = {
    code: 'PROD-NEW',
    name: 'New Product',
    loanType: 'BUSINESS',
  };

  it('creates in DRAFT even for a caller holding the activate permission', async () => {
    // A product with no schemes cannot be borrowed against, so publishing it the
    // moment it is named would put an empty shell in the wizard's picker.
    const { service, productCreate } = harness([]);

    await service.create(actor(), dto, META);

    expect(productCreate).toHaveBeenCalledWith(
      containing({ data: containing({ status: 'DRAFT', orgId: ORG_ID }) }),
    );
  });

  it('takes orgId from the session, never from the payload', async () => {
    const { service, productCreate } = harness([]);

    await service.create(
      actor(),
      { ...dto, orgId: OTHER_ORG_ID } as CreateLoanProductDto & {
        orgId: string;
      },
      META,
    );

    expect(productCreate).toHaveBeenCalledWith(
      containing({ data: containing({ orgId: ORG_ID }) }),
    );
  });

  it('refuses a duplicate code with a 409, not a 503', async () => {
    const { service, audit } = harness([buildProduct({ code: 'PROD-NEW' })]);

    await expect(service.create(actor(), dto, META)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_PRODUCT_CREATE_REJECTED }),
    );
  });

  it('translates a racing unique violation into a 409', async () => {
    // The pre-check cannot exclude a concurrent create, so P2002 is the real
    // guarantee. Untranslated it reaches AllExceptionsFilter and renders as a
    // 503 about the authentication service.
    const { service } = harness([]);
    const prismaError = Object.assign(new Error('unique'), { code: 'P2002' });
    (
      service as unknown as { prisma: { loanProduct: { create: jest.Mock } } }
    ).prisma.loanProduct.create.mockRejectedValueOnce(prismaError);

    await expect(service.create(actor(), dto, META)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  // Loan types are per-tenant master data, so the column is an open string and
  // the DTO can only check its shape. Whether the code names a real type is a
  // question only the database can answer, and this is where it is asked.
  it('refuses a loan type this organization does not offer', async () => {
    const { service } = harness([], { PERSONAL: 'ACTIVE' });

    await expect(
      service.create(actor(), { ...dto, loanType: 'PERSONNAL' }, META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Retiring a type is how an admin stops new products being created against
  // it. That only works if this layer refuses it.
  it('refuses a loan type that has been deactivated', async () => {
    const { service } = harness([], { GOLD: 'INACTIVE' });

    await expect(
      service.create(actor(), { ...dto, loanType: 'GOLD' }, META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // The reason the change was made: a type this codebase never named must work.
  it('accepts a loan type the tenant defined for itself', async () => {
    const { service, productCreate } = harness([], { TRACTOR: 'ACTIVE' });

    await service.create(actor(), { ...dto, loanType: 'TRACTOR' }, META);

    // `containing` rather than a bare `objectContaining`: the latter is typed
    // `any`, which trips no-unsafe-assignment once nested in an object literal.
    expect(productCreate).toHaveBeenCalledWith(
      containing({ data: containing({ loanType: 'TRACTOR' }) }),
    );
  });
});

describe('LoanProductService — concurrency', () => {
  const update: UpdateLoanProductDto = {
    name: 'Renamed',
    loanType: 'PERSONAL',
    expectedVersion: VERSION,
  };

  it('accepts an edit carrying the current version', async () => {
    const { service, productUpdate } = harness();

    await service.update(actor(), PRODUCT_ID, update, META);

    expect(productUpdate).toHaveBeenCalled();
  });

  // The loan type check runs only when the type actually changes. Re-checking an
  // unchanged one would make a product whose type was since retired uneditable:
  // renaming it would be refused over a field the caller never touched.
  it('allows a rename when the unchanged loan type has been retired', async () => {
    const { service, productUpdate } = harness(undefined, {
      PERSONAL: 'INACTIVE',
    });

    await service.update(actor(), PRODUCT_ID, update, META);

    expect(productUpdate).toHaveBeenCalled();
  });

  it('rejects a stale version and leaves the row untouched', async () => {
    const { service, productUpdate, audit } = harness();

    await expect(
      service.update(
        actor(),
        PRODUCT_ID,
        { ...update, expectedVersion: STALE_VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(productUpdate).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_PRODUCT_CONCURRENT_EDIT_REJECTED }),
    );
  });
});

describe('LoanProductService — status', () => {
  const status: SetLoanConfigStatusDto = {
    status: 'INACTIVE',
    reason: 'Withdrawn',
    expectedVersion: VERSION,
  };

  it('deactivates and audits with the reason', async () => {
    const { service, audit } = harness();

    await service.setStatus(actor(), PRODUCT_ID, status, META);

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_PRODUCT_DEACTIVATED }),
      expect.anything(),
    );
  });

  it('refuses a no-op transition', async () => {
    const { service } = harness([buildProduct({ status: 'INACTIVE' })]);

    await expect(
      service.setStatus(actor(), PRODUCT_ID, status, META),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('checks the version before changing status', async () => {
    const { service, productUpdate } = harness();

    await expect(
      service.setStatus(
        actor(),
        PRODUCT_ID,
        { ...status, expectedVersion: STALE_VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(productUpdate).not.toHaveBeenCalled();
  });
});
