import { ConflictException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CustomerService } from '../customer/customer.service';
import type { GuarantorDocumentService } from './guarantor-document.service';
import { GuarantorKycService } from './guarantor-kyc.service';

/**
 * Guarantor KYC review (Module 05, Scenarios 20-25).
 *
 * The load-bearing property is **separation**. Rule 18 and Scenario 22 require
 * that guarantor KYC and borrower KYC be independent, and Rule 75 that one is
 * never evidence for the other. Here that is asserted directly: approving a
 * guarantor must leave the `customer` and `customerKyc` delegates untouched. If
 * a future edit ever adds a convenience write — "approve the guarantor, activate
 * the customer" — those tests are what catch it.
 *
 * Second: **approval is gated on verified documents** (Scenario 21). Uploading
 * is not verifying, so a pack of unreviewed files cannot be approved however
 * complete it looks, and the blocked attempt is audited as its own action rather
 * than as a rejection — nobody decided against it.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const GUARANTOR_ID = '44444444-4444-4444-4444-444444444444';

const VERSION = '2026-08-01T00:00:00.000Z';
const STALE_VERSION = '2026-07-01T00:00:00.000Z';

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
    roles: ['BRANCH_ADMIN'],
    permissions: ['customers.guarantors.kyc.review'],
    ...overrides,
  };
}

function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function build(options: { kycStatus?: string; missing?: string[] } = {}) {
  const guarantor = {
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
    kycStatus: options.kycStatus ?? 'SUBMITTED',
    kycSubmittedAt: null as Date | null,
    kycReviewedAt: null as Date | null,
    kycReviewedBy: null as string | null,
    kycRevisionReason: null as string | null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const client = {
    guarantor: {
      findFirst: jest.fn(() => Promise.resolve({ ...guarantor })),
      update: jest.fn((args: { data: Record<string, unknown> }) => {
        Object.assign(guarantor, args.data);
        return Promise.resolve({ ...guarantor });
      }),
    },
    /**
     * Present so that a write to either would be observable. Scenario 22 is
     * asserted by these never being called — a mock that omitted them would
     * throw instead, which is a weaker and less legible signal.
     */
    customer: { update: jest.fn(), findFirst: jest.fn() },
    customerKyc: { update: jest.fn(), findFirst: jest.fn() },
  };

  const prisma = {
    ...client,
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn(client),
    ),
  } as unknown as PrismaService;

  const customersMocks = {
    findInScope: jest.fn().mockResolvedValue({ customerId: CUSTOMER_ID }),
  };

  const documentsMocks = {
    missingRequirements: jest.fn().mockResolvedValue(options.missing ?? []),
  };

  const service = new GuarantorKycService(
    prisma,
    audit as unknown as AuditService,
    customersMocks as unknown as CustomerService,
    documentsMocks as unknown as GuarantorDocumentService,
  );

  return { service, audit, client, documentsMocks, guarantor };
}

describe('GuarantorKycService.submit', () => {
  // NOT_REQUIRED is the ordinary starting point: submitting is what asserts KYC
  // applies to this guarantor, since no loan product has said so yet.
  it.each(['NOT_REQUIRED', 'PENDING', 'REVISION_REQUIRED', 'REJECTED'])(
    'accepts a submission from %s',
    async (kycStatus) => {
      const { service } = build({ kycStatus });

      const updated = await service.submit(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { expectedVersion: VERSION },
        META,
      );

      expect(jest.mocked(updated).kycStatus).toBe('SUBMITTED');
    },
  );

  it('refuses to resubmit an approved pack', async () => {
    const { service } = build({ kycStatus: 'APPROVED' });

    await expect(
      service.submit(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses a second submission while one is awaiting review', async () => {
    const { service } = build({ kycStatus: 'SUBMITTED' });

    await expect(
      service.submit(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  // The reason described the previous pack; leaving it would make a corrected
  // submission still look faulty.
  it('clears the previous revision reason', async () => {
    const { service, client } = build({ kycStatus: 'REVISION_REQUIRED' });

    await service.submit(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(client.guarantor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ kycRevisionReason: null }),
      }),
    );
  });

  it('refuses a stale version', async () => {
    const { service } = build({ kycStatus: 'PENDING' });

    await expect(
      service.submit(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { expectedVersion: STALE_VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('GuarantorKycService.review', () => {
  it('approves when every required document is verified', async () => {
    const { service } = build({ missing: [] });

    const updated = await service.review(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { decision: 'APPROVE', expectedVersion: VERSION },
      META,
    );

    expect(jest.mocked(updated).kycStatus).toBe('APPROVED');
  });

  // Scenario 21 — a pack of unreviewed files is incomplete however full it is.
  it('refuses approval while a required document is unverified', async () => {
    const { service } = build({ missing: ['ADDRESS'] });

    await expect(
      service.review(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { decision: 'APPROVE', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('names what is missing', async () => {
    const { service } = build({ missing: ['ADDRESS'] });

    await expect(
      service.review(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { decision: 'APPROVE', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(/ADDRESS/);
  });

  // A blocked approval is not a rejection: nobody decided against this pack,
  // and an audit trail conflating the two would misattribute the refusal.
  it('audits a blocked approval as its own action', async () => {
    const { service, audit } = build({ missing: ['ID'] });

    await expect(
      service.review(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { decision: 'APPROVE', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_KYC_APPROVAL_BLOCKED,
      }),
    );
  });

  // Scenario 23 — the reason is what the resubmission acts on.
  it('retains the reason on a revision request', async () => {
    const { service, client } = build();

    await service.review(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      {
        decision: 'REQUEST_REVISION',
        reason: 'Address proof is illegible',
        expectedVersion: VERSION,
      },
      META,
    );

    expect(client.guarantor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({
          kycStatus: 'REVISION_REQUIRED',
          kycRevisionReason: 'Address proof is illegible',
        }),
      }),
    );
  });

  it('does not check documents when sending back for revision', async () => {
    const { service, documentsMocks } = build({ missing: ['ID', 'ADDRESS'] });

    await service.review(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      {
        decision: 'REQUEST_REVISION',
        reason: 'Please resubmit',
        expectedVersion: VERSION,
      },
      META,
    );

    expect(documentsMocks.missingRequirements).not.toHaveBeenCalled();
  });

  it('records the reviewer and the time', async () => {
    const { service, client } = build();

    await service.review(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { decision: 'APPROVE', expectedVersion: VERSION },
      META,
    );

    expect(client.guarantor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ kycReviewedBy: ACTOR_ID }),
      }),
    );
  });

  it('refuses to review a guarantor whose KYC was never submitted', async () => {
    const { service } = build({ kycStatus: 'NOT_REQUIRED' });

    await expect(
      service.review(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { decision: 'APPROVE', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('audits the approval', async () => {
    const { service, audit } = build();

    await service.review(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { decision: 'APPROVE', expectedVersion: VERSION },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_KYC_APPROVED,
        oldData: containing({ kycStatus: 'SUBMITTED' }),
        newData: containing({ kycStatus: 'APPROVED' }),
      }),
      expect.anything(),
    );
  });
});

/**
 * Scenario 22 / Rules 18, 75 — guarantor KYC is separate from the borrower's.
 *
 * These four assertions are the reason the separation is structural rather than
 * conventional: there is no code path from this service to the customer's
 * record, and if one is ever added these fail.
 */
describe('GuarantorKycService — separation from borrower KYC', () => {
  it('never writes to the customer when approving', async () => {
    const { service, client } = build();

    await service.review(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { decision: 'APPROVE', expectedVersion: VERSION },
      META,
    );

    expect(client.customer.update).not.toHaveBeenCalled();
  });

  it('never writes to the customer KYC record when approving', async () => {
    const { service, client } = build();

    await service.review(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { decision: 'APPROVE', expectedVersion: VERSION },
      META,
    );

    expect(client.customerKyc.update).not.toHaveBeenCalled();
  });

  it('never reads the customer KYC record to decide', async () => {
    const { service, client } = build();

    await service.review(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { decision: 'APPROVE', expectedVersion: VERSION },
      META,
    );

    expect(client.customerKyc.findFirst).not.toHaveBeenCalled();
  });

  /**
   * The guarantor's own lifecycle is untouched too. Approving paperwork is not
   * the same decision as making someone available for new relationships, and
   * conflating them would let a KYC approval silently undo a deactivation.
   */
  it('does not activate a deactivated guarantor', async () => {
    const { service, client } = build();

    await service.review(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { decision: 'APPROVE', expectedVersion: VERSION },
      META,
    );

    const call = jest.mocked(client.guarantor.update).mock.calls[0]?.[0] as
      { data: Record<string, unknown> } | undefined;

    expect(call?.data.status).toBeUndefined();
  });
});
