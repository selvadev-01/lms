import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CustomerService } from './customer.service';
import { KycService, REQUIRED_KYC_DOCUMENTS } from './kyc.service';

/**
 * The KYC review workflow (Module 04, Scenarios 6-12).
 *
 * Three things carry the weight.
 *
 * **The required document set.** Approval must be refused for an incomplete or
 * unverified pack (Scenario 7), and "present but nobody checked it" has to count
 * as incomplete — otherwise a reviewer can approve documents no one verified,
 * which is the opposite of what Rule 6 asks for.
 *
 * **Approval and activation are one transaction.** Scenario 39 requires that a
 * failed commit not leave the customer falsely ACTIVE. Asserted by making the
 * transaction throw and checking the customer did not move.
 *
 * **The revision loop.** `REVISION_REQUIRED` and `REJECTED` are different
 * outcomes — the first expects the customer to come back — and a resubmission
 * must clear the stale reason so a branch is not shown a demand they already
 * answered.
 *
 * Scope is not re-tested here: every path reaches its customer through
 * `CustomerService.findInScope`, which has its own spec. What is asserted is
 * that this service actually calls it.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const LOCAL_CUSTOMER_ID = '44444444-4444-4444-4444-444444444444';
const KYC_ID = '55555555-5555-5555-5555-555555555555';

const META: RequestMeta = {
  requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  ipAddress: '203.0.113.11',
  userAgent: 'jest',
};

const VERSION = new Date('2026-08-02T00:00:00.000Z').toISOString();

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: ACTOR_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    branchId: null,
    roles: ['BRANCH_ADMIN'],
    permissions: ['customers.kyc.approve'],
    ...overrides,
  };
}

type DocFixture = {
  documentType: string;
  verificationStatus: string;
  supersededAt?: Date | null;
};

/** A complete, fully verified pack — the only state approval accepts. */
const COMPLETE: DocFixture[] = REQUIRED_KYC_DOCUMENTS.map((documentType) => ({
  documentType,
  verificationStatus: 'VERIFIED',
  supersededAt: null,
}));

/**
 * `expect.objectContaining` and `expect.stringContaining` are typed `any`,
 * which trips `no-unsafe-assignment` as soon as either is nested inside an
 * object literal. Narrowing them once here keeps the assertions below both
 * readable and type-safe — the same helper `branch.service.spec.ts` introduced
 * for Module 02.
 */
function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function build(
  options: {
    kycStatus?: string;
    customerType?: 'KYC' | 'LOCAL';
    documents?: DocFixture[];
    customerStatus?: string;
  } = {},
) {
  const kyc = {
    orgId: ORG_ID,
    kycId: KYC_ID,
    customerId: CUSTOMER_ID,
    status: options.kycStatus ?? 'SUBMITTED',
    submittedAt: new Date('2026-08-01T00:00:00.000Z'),
    reviewedAt: null as Date | null,
    reviewedBy: null as string | null,
    revisionReason: null as string | null,
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  };

  const customer = {
    customerId: CUSTOMER_ID,
    customerType: options.customerType ?? ('KYC' as const),
    status: options.customerStatus ?? 'PENDING',
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const client = {
    customerKyc: {
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.orgId !== ORG_ID) {
          throw new Error('customerKyc.findFirst must be tenant-filtered');
        }
        return Promise.resolve({ ...kyc });
      }),
      update: jest.fn(
        (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const key = args.where.orgId_kycId as { orgId: string };
          if (key.orgId !== ORG_ID) {
            throw new Error('customerKyc.update must be tenant-filtered');
          }
          Object.assign(kyc, args.data);
          return Promise.resolve({ ...kyc });
        },
      ),
    },
    customer: {
      update: jest.fn(
        (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const key = args.where.orgId_customerId as { orgId: string };
          if (key.orgId !== ORG_ID) {
            throw new Error('customer.update must be tenant-filtered');
          }
          Object.assign(customer, args.data);
          return Promise.resolve({ ...customer });
        },
      ),
    },
    customerDocument: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.orgId !== ORG_ID) {
          throw new Error('customerDocument.findMany must be tenant-filtered');
        }
        // The service must exclude superseded rows, or a replaced-but-verified
        // document would keep an incomplete pack looking complete.
        if (args.where.supersededAt !== null) {
          throw new Error(
            'customerDocument.findMany must exclude superseded versions',
          );
        }
        return Promise.resolve(options.documents ?? COMPLETE);
      }),
    },
    user: { findFirst: jest.fn(() => Promise.resolve({ name: 'Reviewer' })) },
  };

  const prisma = {
    ...client,
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn(client),
    ),
  } as unknown as PrismaService;

  /**
   * The mock is held in its own binding and asserted on directly, following
   * `buildSessions` in `user.service.spec.ts`.
   *
   * Reading a method off the `as unknown as CustomerService` value instead trips
   * `unbound-method`: the rule fires on any member access whose object *type* is
   * a real class, and no cast at the assertion changes that. Keeping the
   * `jest.fn()` addressable on its own removes the class from the picture.
   */
  const findInScope = jest.fn().mockResolvedValue(customer);
  const customers = { findInScope } as unknown as CustomerService;

  const service = new KycService(
    prisma,
    audit as unknown as AuditService,
    customers,
  );

  return { service, prisma, audit, findInScope, client, kyc, customer };
}

describe('KycService.get', () => {
  it('resolves the customer through the shared scope check', async () => {
    const { service, findInScope } = build();
    await service.get(actor(), CUSTOMER_ID, META);

    expect(findInScope).toHaveBeenCalled();
  });

  it('audits the read', async () => {
    const { service, audit } = build();
    await service.get(actor(), CUSTOMER_ID, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.CUSTOMER_KYC_VIEWED }),
    );
  });

  it('carries a version handle for the next write', async () => {
    const { service } = build();
    const record = await service.get(actor(), CUSTOMER_ID, META);

    expect(jest.mocked(record).version).toBe(VERSION);
  });
});

describe('KycService.submit', () => {
  it('moves a pending record to SUBMITTED', async () => {
    const { service } = build({ kycStatus: 'PENDING' });
    const record = await service.submit(
      actor(),
      CUSTOMER_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(jest.mocked(record).status).toBe('SUBMITTED');
  });

  // Scenario 6 — completeness is checked at approval, not at submission, so a
  // branch can submit what it has and let a reviewer see the gap.
  it('accepts a submission with no documents at all', async () => {
    const { service } = build({ kycStatus: 'PENDING', documents: [] });

    await expect(
      service.submit(actor(), CUSTOMER_ID, { expectedVersion: VERSION }, META),
    ).resolves.toBeDefined();
  });

  // Scenario 13 — a LOCAL customer is defined by not being in this queue.
  it('refuses to submit KYC for a LOCAL customer', async () => {
    const { service } = build({ customerType: 'LOCAL' });

    await expect(
      service.submit(
        actor(),
        LOCAL_CUSTOMER_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(/Local customer/);
  });

  it('refuses to resubmit an approved record', async () => {
    const { service } = build({ kycStatus: 'APPROVED' });

    await expect(
      service.submit(actor(), CUSTOMER_ID, { expectedVersion: VERSION }, META),
    ).rejects.toThrow(ConflictException);
  });

  // The old reason described the pack that has just been replaced.
  it('clears a stale revision reason on resubmission', async () => {
    const { service, kyc } = build({ kycStatus: 'REVISION_REQUIRED' });
    kyc.revisionReason = 'Address proof is illegible';

    const record = await service.submit(
      actor(),
      CUSTOMER_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(jest.mocked(record).revisionReason).toBeUndefined();
  });

  it('refuses a submission carrying a stale version', async () => {
    const { service } = build();

    await expect(
      service.submit(
        actor(),
        CUSTOMER_ID,
        { expectedVersion: '2020-01-01T00:00:00.000Z' },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('KycService.review', () => {
  const approve = { decision: 'APPROVE' as const, expectedVersion: VERSION };

  // Scenario 9 — approval activates the customer.
  it('approves a complete pack and activates the customer', async () => {
    const { service, customer } = build();
    const record = await service.review(actor(), CUSTOMER_ID, approve, META);

    expect(jest.mocked(record).status).toBe('APPROVED');
    expect(jest.mocked(customer).status).toBe('ACTIVE');
  });

  // Scenario 7 — a missing category blocks approval.
  it('refuses approval when a required document is missing', async () => {
    const { service } = build({
      documents: COMPLETE.filter((d) => d.documentType !== 'PHOTO'),
    });

    await expect(
      service.review(actor(), CUSTOMER_ID, approve, META),
    ).rejects.toThrow(/PHOTO/);
  });

  it('refuses approval when no documents exist at all', async () => {
    const { service } = build({ documents: [] });

    await expect(
      service.review(actor(), CUSTOMER_ID, approve, META),
    ).rejects.toThrow(ConflictException);
  });

  // Present is not enough — somebody has to have checked it.
  it('refuses approval when a required document is unverified', async () => {
    const { service } = build({
      documents: COMPLETE.map((d) =>
        d.documentType === 'ADDRESS'
          ? { ...d, verificationStatus: 'PENDING' }
          : d,
      ),
    });

    await expect(
      service.review(actor(), CUSTOMER_ID, approve, META),
    ).rejects.toThrow(/verified/);
  });

  it('refuses approval when a required document was rejected', async () => {
    const { service } = build({
      documents: COMPLETE.map((d) =>
        d.documentType === 'ID' ? { ...d, verificationStatus: 'REJECTED' } : d,
      ),
    });

    await expect(
      service.review(actor(), CUSTOMER_ID, approve, META),
    ).rejects.toThrow(ConflictException);
  });

  it('audits a blocked approval with what was missing', async () => {
    const { service, audit } = build({ documents: [] });

    await service.review(actor(), CUSTOMER_ID, approve, META).catch(() => {});

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_KYC_APPROVAL_BLOCKED,
        metadata: containing({
          missing: [...REQUIRED_KYC_DOCUMENTS],
        }),
      }),
    );
  });

  // Scenario 8 — the revision loop.
  it('returns a pack for revision with its reason recorded', async () => {
    const { service } = build();
    const record = await service.review(
      actor(),
      CUSTOMER_ID,
      {
        decision: 'REQUEST_REVISION',
        reason: 'Address proof is illegible',
        expectedVersion: VERSION,
      },
      META,
    );

    expect(jest.mocked(record).status).toBe('REVISION_REQUIRED');
    expect(jest.mocked(record).revisionReason).toBe(
      'Address proof is illegible',
    );
  });

  // A revision does not need a complete pack — that is the point of it.
  it('allows a revision request against an incomplete pack', async () => {
    const { service } = build({ documents: [] });

    await expect(
      service.review(
        actor(),
        CUSTOMER_ID,
        {
          decision: 'REQUEST_REVISION',
          reason: 'Nothing uploaded',
          expectedVersion: VERSION,
        },
        META,
      ),
    ).resolves.toBeDefined();
  });

  // Refusing KYC is not the same decision as deactivating a customer.
  it('does not change customer status on a rejection', async () => {
    const { service, customer } = build({ customerStatus: 'PENDING' });
    await service.review(
      actor(),
      CUSTOMER_ID,
      {
        decision: 'REJECT',
        reason: 'Documents belong to another person',
        expectedVersion: VERSION,
      },
      META,
    );

    expect(jest.mocked(customer).status).toBe('PENDING');
  });

  it('records the reviewing actor on the record', async () => {
    const { service, kyc } = build();
    await service.review(actor(), CUSTOMER_ID, approve, META);

    expect(jest.mocked(kyc).reviewedBy).toBe(ACTOR_ID);
  });

  // Scenario 34 — the audit names the approving actor and the result.
  it('audits an approval with the decision and the activation', async () => {
    const { service, audit } = build();
    await service.review(actor(), CUSTOMER_ID, approve, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_KYC_APPROVED,
        actorUserId: ACTOR_ID,
        metadata: containing({
          decision: 'APPROVE',
          customerActivated: true,
        }),
      }),
      expect.anything(),
    );
  });

  it.each([
    ['REQUEST_REVISION', AuditAction.CUSTOMER_KYC_REVISION_REQUESTED],
    ['REJECT', AuditAction.CUSTOMER_KYC_REJECTED],
  ])('audits a %s decision under its own action', async (decision, action) => {
    const { service, audit } = build();
    await service.review(
      actor(),
      CUSTOMER_ID,
      {
        decision: decision as 'REQUEST_REVISION' | 'REJECT',
        reason: 'A reason',
        expectedVersion: VERSION,
      },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action }),
      expect.anything(),
    );
  });

  it('refuses to review an already-approved record', async () => {
    const { service } = build({ kycStatus: 'APPROVED' });

    await expect(
      service.review(actor(), CUSTOMER_ID, approve, META),
    ).rejects.toThrow(ConflictException);
  });

  // Scenario 40 — two reviewers deciding differently on the same record.
  it('refuses a review carrying a stale version', async () => {
    const { service } = build();

    await expect(
      service.review(
        actor(),
        CUSTOMER_ID,
        { ...approve, expectedVersion: '2020-01-01T00:00:00.000Z' },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  // Scenario 39 — the customer must not be left falsely ACTIVE.
  it('does not activate the customer when the transaction fails', async () => {
    const { service, prisma, customer } = build();
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(
      new Error('connection lost'),
    );

    await expect(
      service.review(actor(), CUSTOMER_ID, approve, META),
    ).rejects.toThrow('connection lost');

    expect(jest.mocked(customer).status).toBe('PENDING');
  });

  it('records a failed approval so the attempt is visible', async () => {
    const { service, prisma, audit } = build();
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(
      new Error('connection lost'),
    );

    await service.review(actor(), CUSTOMER_ID, approve, META).catch(() => {});

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_KYC_PERSISTENCE_FAILED,
      }),
    );
  });

  it('refuses when the customer has no KYC record', async () => {
    const { service, client } = build();
    (client.customerKyc.findFirst as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      service.review(actor(), CUSTOMER_ID, approve, META),
    ).rejects.toThrow(NotFoundException);
  });
});
