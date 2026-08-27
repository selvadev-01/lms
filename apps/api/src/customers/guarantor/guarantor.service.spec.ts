import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { BranchService } from '../../organizations/branch.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CustomerService } from '../customer/customer.service';
import { GuarantorService } from './guarantor.service';

/**
 * Guarantors and consent (Module 04, Scenarios 24-26).
 *
 * Two behaviours carry the weight, and both are about consent meaning something.
 *
 * **Consent is never assumed.** A newly added guarantor starts PENDING, because
 * creating one already consenting would record an agreement nobody gave.
 *
 * **Changing who the guarantor is invalidates it.** If the mobile number moves,
 * the person who agreed is not necessarily the person now on the record, so the
 * consent resets rather than carrying over.
 *
 * The timestamp is also asserted to accompany GIVEN and only GIVEN — a rejection
 * has a decision but no consent, and a timestamp against it would read as though
 * one had been given.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const GUARANTOR_ID = '44444444-4444-4444-4444-444444444444';
const UNKNOWN_ID = '55555555-5555-5555-5555-555555555555';
const BRANCH_ID = '66666666-6666-6666-6666-666666666666';

/**
 * The concurrency token every write carries — the row's `updatedAt` as an ISO
 * string, which is what `toGuarantorSummary` hands the client as `version`.
 * Kept in step with `build()`'s `updatedAt` below.
 */
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
    permissions: ['customers.guarantors.manage'],
    ...overrides,
  };
}

/**
 * Matches the fixture row's mobile, so a create with these details is a
 * *duplicate* on the same customer. Use it for update, consent and duplicate
 * tests; use {@link NEW_DETAILS} to exercise a plain create.
 */
const DETAILS = {
  fullName: 'Ravi Shankar',
  mobile: '9876543211',
  address: '9 Temple Street',
  relationship: 'Brother',
};

/** A mobile no existing guarantor holds, so the duplicate guard stays quiet. */
const NEW_DETAILS = { ...DETAILS, mobile: '9876549999' };

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

function containingString(fragment: string): unknown {
  return expect.stringContaining(fragment) as unknown;
}

function build() {
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
    consentStatus: 'PENDING' as string,
    consentAt: null as Date | null,
    consentBy: null as string | null,
    kycStatus: 'NOT_REQUIRED' as string,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    // Doubles as the optimistic-concurrency token; `VERSION` below is the value
    // a caller would send back as `expectedVersion`.
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const client = {
    guarantor: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.orgId !== ORG_ID) {
          throw new Error('guarantor.findMany must be tenant-filtered');
        }
        return Promise.resolve([{ ...guarantor }]);
      }),
      /**
       * Serves two different lookups, and must distinguish them.
       *
       * `findInScope` queries by `guarantorId`; the duplicate pre-check queries
       * by `mobile`. A mock that answered both from the id alone would report
       * "no duplicate" for every create, silently disabling Scenario 10.
       */
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.orgId !== ORG_ID) {
          throw new Error('guarantor.findFirst must be tenant-filtered');
        }
        // Without this, a guarantor id from another customer would resolve.
        if (args.where.customerId === undefined) {
          throw new Error('guarantor.findFirst must be scoped to the customer');
        }

        if (args.where.mobile !== undefined) {
          return Promise.resolve(
            args.where.mobile === guarantor.mobile ? { ...guarantor } : null,
          );
        }

        return Promise.resolve(
          args.where.guarantorId === GUARANTOR_ID ? { ...guarantor } : null,
        );
      }),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        if (args.data.orgId !== ORG_ID) {
          throw new Error('guarantor.create must carry the caller orgId');
        }
        return Promise.resolve({ ...guarantor, ...args.data });
      }),
      update: jest.fn(
        (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const key = args.where.orgId_guarantorId as { orgId: string };
          if (key.orgId !== ORG_ID) {
            throw new Error('guarantor.update must be tenant-filtered');
          }
          Object.assign(guarantor, args.data);
          return Promise.resolve({ ...guarantor });
        },
      ),
      delete: jest.fn(() => Promise.resolve({})),
    },
    // The only `Restrict` relation, and so the only thing that blocks a delete
    // (GUARANTOR_DEPENDENCIES). Zero by default: most tests are not about the
    // blocked path, and one that is overrides it.
    loanGuarantor: {
      count: jest.fn(() => Promise.resolve(0)),
    },
  };

  const prisma = {
    ...client,
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn(client),
    ),
  } as unknown as PrismaService;

  const customersMocks = {
    findInScope: jest
      .fn()
      .mockResolvedValue({ customerId: CUSTOMER_ID, branchId: BRANCH_ID }),
  };
  const customers = customersMocks as unknown as CustomerService;

  const branchesMocks = {
    assertBranchOperational: jest.fn().mockResolvedValue(undefined),
  };
  const branches = branchesMocks as unknown as BranchService;

  const service = new GuarantorService(
    prisma,
    audit as unknown as AuditService,
    customers,
    branches,
  );

  return {
    service,
    audit,
    customersMocks,
    branchesMocks,
    client,
    guarantor,
  };
}

describe('GuarantorService.create', () => {
  // Scenario 24.
  it('links a guarantor to the customer', async () => {
    const { service } = build();
    const created = await service.create(
      actor(),
      CUSTOMER_ID,
      NEW_DETAILS,
      META,
    );

    expect(jest.mocked(created).customerId).toBe(CUSTOMER_ID);
    expect(jest.mocked(created).fullName).toBe('Ravi Shankar');
  });

  // Consent is a separate, deliberate act.
  it('starts a new guarantor at PENDING consent', async () => {
    const { service, client } = build();
    await service.create(actor(), CUSTOMER_ID, NEW_DETAILS, META);

    expect(client.guarantor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ consentStatus: 'PENDING' }),
      }),
    );
  });

  it('audits the addition with a masked mobile', async () => {
    const { service, audit } = build();
    await service.create(actor(), CUSTOMER_ID, NEW_DETAILS, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_ADDED,
        metadata: containing({
          mobile: containingString('X'),
        }),
      }),
      expect.anything(),
    );
  });

  it('resolves the customer through the shared scope check', async () => {
    const { service, customersMocks } = build();
    await service.create(actor(), CUSTOMER_ID, NEW_DETAILS, META);

    expect(customersMocks.findInScope).toHaveBeenCalled();
  });
});

describe('GuarantorService.recordConsent', () => {
  // Scenario 25 — the decision and its time.
  it('records GIVEN with a server timestamp', async () => {
    const { service } = build();
    const updated = await service.recordConsent(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { consentStatus: 'GIVEN', expectedVersion: VERSION },
      META,
    );

    expect(jest.mocked(updated).consentStatus).toBe('GIVEN');
    expect(jest.mocked(updated).consentAt).toBeDefined();
  });

  // A rejection has a decision but no consent.
  it.each(['PENDING', 'REJECTED'])(
    'records %s with no consent timestamp',
    async (consentStatus) => {
      const { service } = build();
      const updated = await service.recordConsent(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        {
          consentStatus: consentStatus as 'PENDING' | 'REJECTED',
          expectedVersion: VERSION,
        },
        META,
      );

      expect(jest.mocked(updated).consentAt).toBeUndefined();
    },
  );

  it('audits the consent decision', async () => {
    const { service, audit } = build();
    await service.recordConsent(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { consentStatus: 'GIVEN', expectedVersion: VERSION },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_CONSENT_RECORDED,
        oldData: containing({ consentStatus: 'PENDING' }),
        newData: containing({ consentStatus: 'GIVEN' }),
      }),
      expect.anything(),
    );
  });

  it('refuses a guarantor that does not belong to the customer', async () => {
    const { service } = build();

    await expect(
      service.recordConsent(
        actor(),
        CUSTOMER_ID,
        UNKNOWN_ID,
        { consentStatus: 'GIVEN', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('GuarantorService.update', () => {
  it('applies an edit', async () => {
    const { service } = build();
    const updated = await service.update(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { ...DETAILS, relationship: 'Cousin', expectedVersion: VERSION },
      META,
    );

    expect(jest.mocked(updated).relationship).toBe('Cousin');
  });

  // The person who agreed is not necessarily the person now recorded.
  it('resets consent when the mobile number changes', async () => {
    const { service, guarantor } = build();
    guarantor.consentStatus = 'GIVEN';
    guarantor.consentAt = new Date();

    const updated = await service.update(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { ...DETAILS, mobile: '9876500000', expectedVersion: VERSION },
      META,
    );

    expect(jest.mocked(updated).consentStatus).toBe('PENDING');
    expect(jest.mocked(updated).consentAt).toBeUndefined();
  });

  it('keeps consent when the mobile number is unchanged', async () => {
    const { service, guarantor } = build();
    guarantor.consentStatus = 'GIVEN';

    const updated = await service.update(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { ...DETAILS, fullName: 'Ravi S', expectedVersion: VERSION },
      META,
    );

    expect(jest.mocked(updated).consentStatus).toBe('GIVEN');
  });

  it('audits a consent reset', async () => {
    const { service, audit } = build();
    await service.update(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { ...DETAILS, mobile: '9876500000', expectedVersion: VERSION },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_UPDATED,
        metadata: containing({ consentReset: true }),
      }),
      expect.anything(),
    );
  });
});

describe('GuarantorService.remove', () => {
  it('deletes the guarantor', async () => {
    const { service, client } = build();
    await service.remove(actor(), CUSTOMER_ID, GUARANTOR_ID, META);

    expect(client.guarantor.delete).toHaveBeenCalled();
  });

  it('audits the record before deleting it', async () => {
    const { service, audit } = build();
    await service.remove(actor(), CUSTOMER_ID, GUARANTOR_ID, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_REMOVED,
        oldData: containing({ fullName: 'Ravi Shankar' }),
      }),
      expect.anything(),
    );
  });

  it('refuses a guarantor that does not belong to the customer', async () => {
    const { service } = build();

    await expect(
      service.remove(actor(), CUSTOMER_ID, UNKNOWN_ID, META),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('GuarantorService.list', () => {
  it('returns the customer guarantors', async () => {
    const { service } = build();
    const rows = await service.list(actor(), CUSTOMER_ID, META);

    expect(rows).toHaveLength(1);
  });

  it('resolves the customer through the shared scope check', async () => {
    const { service, customersMocks } = build();
    await service.list(actor(), CUSTOMER_ID, META);

    expect(customersMocks.findInScope).toHaveBeenCalled();
  });

  // Scenario 1 — "inactive guarantors are clearly identified" is a rendering
  // decision, so the row must reach the caller rather than being filtered here.
  it('returns inactive guarantors rather than hiding them', async () => {
    const { service, guarantor } = build();
    guarantor.status = 'INACTIVE';

    const rows = await service.list(actor(), CUSTOMER_ID, META);

    expect(rows).toHaveLength(1);
    expect(jest.mocked(rows[0]).status).toBe('INACTIVE');
  });
});

/**
 * Module 05 — duplicate detection (Scenario 10, Q-GUAR-4).
 *
 * A soft flag rather than a unique constraint: the same person may legitimately
 * guarantee more than one customer, so only the unambiguous mistake — the same
 * mobile twice on the same customer — is caught, and `force` is the caller
 * saying they meant it.
 */
describe('GuarantorService.create — duplicates', () => {
  it('refuses a same-mobile guarantor on the same customer', async () => {
    const { service } = build();

    await expect(
      service.create(actor(), CUSTOMER_ID, DETAILS, META),
    ).rejects.toThrow(ConflictException);
  });

  it('audits the duplicate it flagged', async () => {
    const { service, audit } = build();

    await expect(
      service.create(actor(), CUSTOMER_ID, DETAILS, META),
    ).rejects.toThrow(ConflictException);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_DUPLICATE_FLAGGED,
      }),
    );
  });

  it('creates anyway when the caller confirms', async () => {
    const { service, client } = build();

    await service.create(
      actor(),
      CUSTOMER_ID,
      { ...DETAILS, force: true },
      META,
    );

    expect(client.guarantor.create).toHaveBeenCalled();
  });

  // Recorded distinctly from a clean create, so "we warned and they proceeded"
  // is answerable after the fact.
  it('audits a confirmed override separately', async () => {
    const { service, audit } = build();

    await service.create(
      actor(),
      CUSTOMER_ID,
      { ...DETAILS, force: true },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_DUPLICATE_OVERRIDDEN,
      }),
      expect.anything(),
    );
  });

  it('does not flag a different mobile on the same customer', async () => {
    const { service, client } = build();

    await service.create(
      actor(),
      CUSTOMER_ID,
      { ...DETAILS, mobile: '9876500001' },
      META,
    );

    expect(client.guarantor.create).toHaveBeenCalled();
  });
});

/** Scenario 35 — an inactive branch takes no new guarantor relationships. */
describe('GuarantorService.create — branch state', () => {
  it('refuses when the customer branch is not operational', async () => {
    const { service, branchesMocks } = build();
    branchesMocks.assertBranchOperational.mockRejectedValueOnce(
      new ConflictException('This branch is inactive'),
    );

    await expect(
      service.create(
        actor(),
        CUSTOMER_ID,
        { ...DETAILS, mobile: '9876500002' },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  // The branch checked is the customer's, never one the caller could name.
  it('checks the branch the customer belongs to', async () => {
    const { service, branchesMocks } = build();

    await service.create(
      actor(),
      CUSTOMER_ID,
      { ...DETAILS, mobile: '9876500003' },
      META,
    );

    expect(branchesMocks.assertBranchOperational).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      BRANCH_ID,
    );
  });

  // Scenario 44 — the failure leaves a trace rather than passing silently.
  it('audits a persistence failure', async () => {
    const { service, audit, branchesMocks } = build();
    branchesMocks.assertBranchOperational.mockRejectedValueOnce(
      new Error('connection lost'),
    );

    await expect(
      service.create(
        actor(),
        CUSTOMER_ID,
        { ...DETAILS, mobile: '9876500004' },
        META,
      ),
    ).rejects.toThrow('connection lost');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_PERSISTENCE_FAILED,
      }),
    );
  });
});

/** Scenario 46 / Q-GUAR-67 — optimistic concurrency on every write. */
describe('GuarantorService — concurrency', () => {
  it('refuses an update carrying a stale version', async () => {
    const { service } = build();

    await expect(
      service.update(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { ...DETAILS, expectedVersion: STALE_VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('leaves the row untouched when the version is stale', async () => {
    const { service, client } = build();

    await expect(
      service.update(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { ...DETAILS, expectedVersion: STALE_VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);

    expect(client.guarantor.update).not.toHaveBeenCalled();
  });

  it('audits the rejected concurrent edit', async () => {
    const { service, audit } = build();

    await expect(
      service.update(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { ...DETAILS, expectedVersion: STALE_VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_CONCURRENT_EDIT_REJECTED,
      }),
    );
  });

  it('refuses consent carrying a stale version', async () => {
    const { service } = build();

    await expect(
      service.recordConsent(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { consentStatus: 'GIVEN', expectedVersion: STALE_VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

/** Rule 23, Scenario 15 — who recorded the decision, and when. */
describe('GuarantorService.recordConsent — actor', () => {
  it('records the acting user on GIVEN', async () => {
    const { service, client } = build();

    await service.recordConsent(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { consentStatus: 'GIVEN', expectedVersion: VERSION },
      META,
    );

    expect(client.guarantor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ consentBy: ACTOR_ID }),
      }),
    );
  });

  // A rejection has a decision but no consent, so it has no consenting party.
  it('clears the actor on a rejection', async () => {
    const { service, client } = build();

    await service.recordConsent(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { consentStatus: 'REJECTED', expectedVersion: VERSION },
      META,
    );

    expect(client.guarantor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ consentBy: null }),
      }),
    );
  });
});

/** Scenarios 28, 30 — deactivation preserves everything downstream. */
describe('GuarantorService.deactivate', () => {
  it('marks the guarantor inactive with a reason', async () => {
    const { service } = build();

    const updated = await service.deactivate(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { reason: 'Withdrew from the arrangement', expectedVersion: VERSION },
      META,
    );

    expect(jest.mocked(updated).status).toBe('INACTIVE');
    expect(jest.mocked(updated).deactivationReason).toBe(
      'Withdrew from the arrangement',
    );
    expect(jest.mocked(updated).deactivatedAt).toBeDefined();
  });

  /**
   * Rules 35 and 38 — the load-bearing assertion of this whole module.
   *
   * Deactivation must not detach a historical loan relationship. If a future
   * edit ever adds a `loanGuarantor` write to this path, this test is what
   * catches it.
   */
  it('never touches the loan guarantor relationships', async () => {
    const { service, client } = build();

    await service.deactivate(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { reason: 'Withdrew', expectedVersion: VERSION },
      META,
    );

    expect(client.guarantor.delete).not.toHaveBeenCalled();
    expect(client.loanGuarantor.count).not.toHaveBeenCalled();
  });

  it('audits the deactivation with the status change', async () => {
    const { service, audit } = build();

    await service.deactivate(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { reason: 'Withdrew', expectedVersion: VERSION },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_DEACTIVATED,
        oldData: containing({ status: 'ACTIVE' }),
        newData: containing({ status: 'INACTIVE' }),
      }),
      expect.anything(),
    );
  });

  it('refuses to deactivate an already inactive guarantor', async () => {
    const { service, guarantor } = build();
    guarantor.status = 'INACTIVE';

    await expect(
      service.deactivate(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { reason: 'Withdrew', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('restores an inactive guarantor on reactivate', async () => {
    const { service, guarantor } = build();
    guarantor.status = 'INACTIVE';

    const updated = await service.reactivate(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(jest.mocked(updated).status).toBe('ACTIVE');
    expect(jest.mocked(updated).deactivatedAt).toBeUndefined();
  });
});

/** Rule 36 — an inactive guarantor is not editable or consentable. */
describe('GuarantorService — inactive guard', () => {
  it('refuses an edit on an inactive guarantor', async () => {
    const { service, guarantor } = build();
    guarantor.status = 'INACTIVE';

    await expect(
      service.update(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { ...DETAILS, expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses consent on an inactive guarantor', async () => {
    const { service, guarantor } = build();
    guarantor.status = 'INACTIVE';

    await expect(
      service.recordConsent(
        actor(),
        CUSTOMER_ID,
        GUARANTOR_ID,
        { consentStatus: 'GIVEN', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  // Scenario 27 — the rule Module 07 will call rather than re-derive.
  it('refuses to mark an inactive guarantor selectable', async () => {
    const { service, guarantor } = build();
    guarantor.status = 'INACTIVE';

    await expect(
      service.assertSelectable(actor(), CUSTOMER_ID, GUARANTOR_ID, META),
    ).rejects.toThrow(ConflictException);
  });

  it('audits a blocked selection', async () => {
    const { service, audit, guarantor } = build();
    guarantor.status = 'INACTIVE';

    await expect(
      service.assertSelectable(actor(), CUSTOMER_ID, GUARANTOR_ID, META),
    ).rejects.toThrow(ConflictException);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_SELECTION_BLOCKED,
      }),
    );
  });

  it('allows selecting an active guarantor', async () => {
    const { service } = build();

    await expect(
      service.assertSelectable(actor(), CUSTOMER_ID, GUARANTOR_ID, META),
    ).resolves.toBeDefined();
  });
});

/** Scenarios 31-33, 55 — deletion is refused where a loan refers to it. */
describe('GuarantorService.remove — blockers', () => {
  it('blocks the delete when a loan references the guarantor', async () => {
    const { service, client } = build();
    client.loanGuarantor.count.mockResolvedValueOnce(2);

    const outcome = await service.remove(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      META,
    );

    expect(outcome.deleted).toBe(false);
    if (!outcome.deleted) {
      expect(outcome.blockedBy).toEqual([
        expect.objectContaining({ entity: 'loanGuarantor', count: 2 }),
      ]);
    }
  });

  it('does not delete the row when blocked', async () => {
    const { service, client } = build();
    client.loanGuarantor.count.mockResolvedValueOnce(1);

    await service.remove(actor(), CUSTOMER_ID, GUARANTOR_ID, META);

    expect(client.guarantor.delete).not.toHaveBeenCalled();
  });

  it('audits the blocked attempt', async () => {
    const { service, audit, client } = build();
    client.loanGuarantor.count.mockResolvedValueOnce(1);

    await service.remove(actor(), CUSTOMER_ID, GUARANTOR_ID, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_DELETE_BLOCKED,
      }),
    );
  });

  it('deletes when nothing references the guarantor', async () => {
    const { service, client } = build();

    const outcome = await service.remove(
      actor(),
      CUSTOMER_ID,
      GUARANTOR_ID,
      META,
    );

    expect(outcome.deleted).toBe(true);
    expect(client.guarantor.delete).toHaveBeenCalled();
  });
});

/**
 * The loan-application gate (Scenarios 7, 17, 41-43).
 *
 * `required` is always null: this module answers "are these guarantors usable",
 * never "was one needed" — that belongs to the loan product (Q-GUAR-11).
 */
describe('GuarantorService.evaluateReadiness', () => {
  it('never claims to know whether a guarantor was required', async () => {
    const { service } = build();
    const readiness = await service.evaluateReadiness(
      actor(),
      CUSTOMER_ID,
      META,
    );

    expect(readiness.required).toBeNull();
  });

  // Scenarios 7, 43 — a customer with no guarantors is not this module's
  // failure to report. Returning false would gate every no-guarantor loan.
  it('is satisfied when the customer has no guarantors', async () => {
    const { service, client } = build();
    client.guarantor.findMany.mockResolvedValueOnce([]);

    const readiness = await service.evaluateReadiness(
      actor(),
      CUSTOMER_ID,
      META,
    );

    expect(readiness.satisfied).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
  });

  it('blocks on pending consent', async () => {
    const { service } = build();
    const readiness = await service.evaluateReadiness(
      actor(),
      CUSTOMER_ID,
      META,
    );

    expect(readiness.satisfied).toBe(false);
    expect(jest.mocked(readiness.blockers[0]).reasons).toContain(
      'CONSENT_PENDING',
    );
  });

  it('is satisfied once consent is given and KYC is not required', async () => {
    const { service, guarantor } = build();
    guarantor.consentStatus = 'GIVEN';

    const readiness = await service.evaluateReadiness(
      actor(),
      CUSTOMER_ID,
      META,
    );

    expect(readiness.satisfied).toBe(true);
  });

  // NOT_REQUIRED is complete, not incomplete — only a KYC that was started and
  // has not been approved blocks.
  it('blocks on KYC that is started but unapproved', async () => {
    const { service, guarantor } = build();
    guarantor.consentStatus = 'GIVEN';
    guarantor.kycStatus = 'SUBMITTED';

    const readiness = await service.evaluateReadiness(
      actor(),
      CUSTOMER_ID,
      META,
    );

    expect(readiness.satisfied).toBe(false);
    expect(jest.mocked(readiness.blockers[0]).reasons).toContain(
      'KYC_INCOMPLETE',
    );
  });

  it('blocks on an inactive guarantor', async () => {
    const { service, guarantor } = build();
    guarantor.consentStatus = 'GIVEN';
    guarantor.status = 'INACTIVE';

    const readiness = await service.evaluateReadiness(
      actor(),
      CUSTOMER_ID,
      META,
    );

    expect(readiness.satisfied).toBe(false);
    expect(jest.mocked(readiness.blockers[0]).reasons).toContain('INACTIVE');
  });
});

/** Scenarios 4, 5, 37 — a miss is audited and answered 404, never 403. */
describe('GuarantorService — scope denial', () => {
  it('audits an out-of-scope guarantor lookup', async () => {
    const { service, audit } = build();

    await expect(
      service.findOne(actor(), CUSTOMER_ID, UNKNOWN_ID, META),
    ).rejects.toThrow(NotFoundException);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_GUARANTOR_ACCESS_DENIED,
      }),
    );
  });
});
