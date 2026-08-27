import { NotFoundException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { PrismaService } from '../../prisma/prisma.service';
import { GuarantorDirectoryService } from './guarantor-directory.service';
import type { GuarantorDocumentService } from './guarantor-document.service';

/**
 * The organization-scoped guarantor directory (GUA-001, GUA-002).
 *
 * Two properties carry the weight here, and both are about not disclosing what
 * the caller has no business seeing.
 *
 * **Branch confinement runs through the customer.** `Guarantor` has no
 * `branchId` of its own (Rule 10), so a branch-scoped caller must be filtered by
 * `customer.branchId`. The filter has to be in the query rather than applied
 * after the fetch, or an out-of-scope guarantor is loaded into memory before
 * anything decides the caller may not see it.
 *
 * **A miss is a 404, never a 403.** Scenario 5 asks that a direct identifier not
 * reach another organization's data; answering 403 would confirm the id exists,
 * which is itself the disclosure being guarded against.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const GUARANTOR_ID = '44444444-4444-4444-4444-444444444444';
const BRANCH_ID = '55555555-5555-5555-5555-555555555555';

const META: RequestMeta = {
  requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  ipAddress: '203.0.113.11',
  userAgent: 'jest',
};

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: ACTOR_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['customers.guarantors.view'],
    ...overrides,
  };
}

function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function build(options: { found?: boolean } = {}) {
  const row = {
    orgId: ORG_ID,
    guarantorId: GUARANTOR_ID,
    customerId: CUSTOMER_ID,
    fullName: 'Ravi Shankar',
    mobile: '9876543211',
    address: '9 Temple Street',
    relationship: 'Brother',
    status: 'ACTIVE' as string,
    deactivatedAt: null as Date | null,
    deactivationReason: null as string | null,
    consentStatus: 'GIVEN' as string,
    consentAt: new Date('2026-08-01T00:00:00.000Z'),
    consentBy: ACTOR_ID as string | null,
    kycStatus: 'APPROVED' as string,
    kycSubmittedAt: null as Date | null,
    kycReviewedAt: null as Date | null,
    kycReviewedBy: null as string | null,
    kycRevisionReason: null as string | null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    customer: {
      fullName: 'Meena Kumari',
      customerCode: 'CUST005',
      branchId: BRANCH_ID,
    },
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  /**
   * Held as plainly-typed `jest.fn()`s and cast only where the service needs
   * them. Asserting against `guarantorMocks.findMany` directly would read the
   * method off a `PrismaService`-typed object, which trips `unbound-method` —
   * the pattern Module 03's specs settled on.
   */
  const guarantorMocks = {
    findMany: jest.fn((args: { where: Record<string, unknown> }) => {
      if (args.where.orgId !== ORG_ID) {
        throw new Error('guarantor.findMany must be tenant-filtered');
      }
      return Promise.resolve([{ ...row }]);
    }),
    findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
      if (args.where.orgId !== ORG_ID) {
        throw new Error('guarantor.findFirst must be tenant-filtered');
      }
      return Promise.resolve(options.found === false ? null : { ...row });
    }),
  };

  const prisma = { guarantor: guarantorMocks } as unknown as PrismaService;

  const documentsMocks = { list: jest.fn().mockResolvedValue([]) };

  const service = new GuarantorDirectoryService(
    prisma,
    audit as unknown as AuditService,
    documentsMocks as unknown as GuarantorDocumentService,
  );

  return { service, audit, guarantorMocks, documentsMocks };
}

describe('GuarantorDirectoryService.list', () => {
  it('returns guarantors across the organization', async () => {
    const { service } = build();
    const rows = await service.list(actor(), {}, META);

    expect(rows).toHaveLength(1);
  });

  /**
   * A directory is a browsing surface, so a full column of third-party mobile
   * numbers would be a standing disclosure to anyone who opens the page
   * (Q-GUAR-65).
   */
  it('masks the mobile in the list', async () => {
    const { service } = build();
    const rows = await service.list(actor(), {}, META);

    expect(jest.mocked(rows[0]).mobile).not.toBe('9876543211');
    expect(jest.mocked(rows[0]).mobile).toContain('X');
  });

  // The filter must be in the query: an out-of-scope guarantor should never be
  // loaded into memory at all.
  it('confines a branch-scoped caller through the customer relation', async () => {
    const { service, guarantorMocks } = build();

    await service.list(actor({ branchId: BRANCH_ID }), {}, META);

    expect(guarantorMocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: containing({ customer: { branchId: BRANCH_ID } }),
      }),
    );
  });

  it('does not confine an organization-wide caller', async () => {
    const { service, guarantorMocks } = build();

    await service.list(actor({ branchId: null }), {}, META);

    const call = guarantorMocks.findMany.mock.calls[0]?.[0] as
      { where: Record<string, unknown> } | undefined;

    expect(call?.where.customer).toBeUndefined();
  });

  it('applies the status filter', async () => {
    const { service, guarantorMocks } = build();

    await service.list(actor(), { status: 'INACTIVE' }, META);

    expect(guarantorMocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: containing({ status: 'INACTIVE' }) }),
    );
  });

  // Q-GUAR-63 — "who guaranteed CUST005" is the question a branch actually asks.
  it('searches by name, mobile and customer together', async () => {
    const { service, guarantorMocks } = build();

    await service.list(actor(), { search: 'Ravi' }, META);

    const call = guarantorMocks.findMany.mock.calls[0]?.[0] as
      { where: { OR?: unknown[] } } | undefined;

    expect(call?.where.OR).toHaveLength(4);
  });

  it('audits the search', async () => {
    const { service, audit } = build();

    await service.list(actor(), { search: 'Ravi' }, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_LISTED,
        metadata: containing({ search: 'Ravi' }),
      }),
    );
  });
});

describe('GuarantorDirectoryService.findOne', () => {
  it('returns the guarantor with their customer', async () => {
    const { service } = build();
    const profile = await service.findOne(actor(), GUARANTOR_ID, META);

    expect(profile.guarantor.customerCode).toBe('CUST005');
    expect(profile.guarantor.customerName).toBe('Meena Kumari');
  });

  // Read from the customer, never stored on the guarantor (Rule 10).
  it('reports the branch from the customer', async () => {
    const { service } = build();
    const profile = await service.findOne(actor(), GUARANTOR_ID, META);

    expect(profile.guarantor.branchId).toBe(BRANCH_ID);
  });

  // Opening one record is a deliberate act, separately audited — unlike
  // browsing the list, where the numbers stay masked.
  it('shows the full mobile on the detail view', async () => {
    const { service } = build();
    const profile = await service.findOne(actor(), GUARANTOR_ID, META);

    expect(profile.guarantor.mobile).toBe('9876543211');
  });

  it('includes the guarantor documents', async () => {
    const { service, documentsMocks } = build();
    await service.findOne(actor(), GUARANTOR_ID, META);

    expect(documentsMocks.list).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      META,
    );
  });

  it('audits the view', async () => {
    const { service, audit } = build();
    await service.findOne(actor(), GUARANTOR_ID, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_VIEWED,
      }),
    );
  });

  // Scenario 5 — a 403 would confirm the id exists.
  it('answers not-found for a guarantor outside scope', async () => {
    const { service } = build({ found: false });

    await expect(service.findOne(actor(), GUARANTOR_ID, META)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('audits the denied access', async () => {
    const { service, audit } = build({ found: false });

    await expect(service.findOne(actor(), GUARANTOR_ID, META)).rejects.toThrow(
      NotFoundException,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_ACCESS_DENIED,
      }),
    );
  });

  it('confines a branch-scoped caller on the detail lookup too', async () => {
    const { service, guarantorMocks } = build();

    await service.findOne(actor({ branchId: BRANCH_ID }), GUARANTOR_ID, META);

    expect(guarantorMocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: containing({ customer: { branchId: BRANCH_ID } }),
      }),
    );
  });
});
