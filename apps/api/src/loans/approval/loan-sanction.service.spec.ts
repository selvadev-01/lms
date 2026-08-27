import { ConflictException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ApplicationTransitionService } from '../applications/application-transition.service';
import { LoanSanctionService } from './loan-sanction.service';
import type { LoanApplicationService } from '../applications/loan-application.service';
import type { ApplicationWithRelations } from '../applications/loan-application.mapper';
import type { ApplicationStatus } from '@lms/types';

/**
 * Module 08 — sanction, customer response and agreement signing.
 *
 * The load-bearing assertions here are the ones a later "tidy-up" would break
 * without noticing:
 *
 * 1. **A decline lands on REJECTED, not CUSTOMER_REJECTED.** The Prisma enum
 *    carries CUSTOMER_REJECTED and nothing writes it, which makes it a standing
 *    invitation. Rule 13 unifies the two, and a test is the only thing that
 *    keeps that decision from being "fixed".
 * 2. **The letter has its own guard.** The application's status guard would
 *    usually catch a second response first, so the letter's own
 *    `count === 0` check looks redundant — until the two disagree.
 * 3. **Terms are snapshotted, not supplied.** The letter must carry the
 *    application's terms, which is what stops sanctioned terms drifting from
 *    approved ones.
 *
 * The Prisma stand-in models `updateMany` faithfully for both the application
 * and the letter: each compares the WHERE against live state and returns a real
 * count, so a guard that dropped a key would start returning 1 here.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-4444-444444444444';

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
      'loans.applications.view',
      'loans.applications.sanction.issue',
      'loans.applications.sanction.record_response',
      'loans.applications.agreement.record',
    ],
    ...overrides,
  };
}

function buildApplication(
  overrides: Partial<ApplicationWithRelations> = {},
): ApplicationWithRelations {
  return {
    orgId: ORG_ID,
    applicationId: APPLICATION_ID,
    applicationNumber: 'APP-000001',
    branchId: '66666666-6666-6666-6666-666666666666',
    customerId: '77777777-7777-7777-7777-777777777777',
    loanProductId: '99999999-9999-9999-9999-999999999999',
    loanSchemeId: '55555555-5555-5555-5555-555555555555',
    requestedAmountPaise: 10_000_000n,
    purpose: 'Working capital',
    interestType: 'REDUCING',
    interestRateBps: 1_200n,
    repaymentFrequency: 'MONTHLY',
    durationCount: 12,
    status: 'APPROVED',
    rejectionReason: null,
    submittedAt: new Date('2026-08-10T00:00:00.000Z'),
    approvedAt: new Date('2026-08-18T00:00:00.000Z'),
    approvedBy: USER_ID,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date(VERSION),
    customer: { fullName: 'Anitha Raman', customerCode: 'CUST001' },
    branch: { name: 'Chennai Main Branch' },
    loanProduct: { code: 'PROD-PERSONAL', loanType: 'PERSONAL' },
    loanScheme: { code: 'SCH-PERS-RED', name: 'Personal Reducing 12%' },
    ...overrides,
  } as unknown as ApplicationWithRelations;
}

interface LetterState {
  customerResponse: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  agreementSignedAt: Date | null;
}

function harness(
  application = buildApplication(),
  letter: LetterState | null = null,
) {
  const row = { status: application.status, updatedAt: application.updatedAt };

  const updateMany = jest.fn(
    ({
      where,
      data,
    }: {
      where: { status?: ApplicationStatus; updatedAt?: Date };
      data: { status?: ApplicationStatus } & Record<string, unknown>;
    }) => {
      const statusMatches =
        where.status === undefined || where.status === row.status;
      const versionMatches =
        where.updatedAt === undefined ||
        where.updatedAt.getTime() === row.updatedAt.getTime();

      if (!statusMatches || !versionMatches)
        return Promise.resolve({ count: 0 });

      if (data.status !== undefined) row.status = data.status;
      row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
      return Promise.resolve({ count: 1 });
    },
  );

  const letterCreate = jest.fn(() => Promise.resolve({}));

  /** The letter's own guard, modelled as faithfully as the application's. */
  const letterUpdateMany = jest.fn(
    ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (!letter) return Promise.resolve({ count: 0 });

      if (
        where.customerResponse !== undefined &&
        where.customerResponse !== letter.customerResponse
      )
        return Promise.resolve({ count: 0 });

      if (
        'agreementSignedAt' in where &&
        where.agreementSignedAt === null &&
        letter.agreementSignedAt !== null
      )
        return Promise.resolve({ count: 0 });

      if (data.customerResponse)
        letter.customerResponse =
          data.customerResponse as LetterState['customerResponse'];
      if (data.agreementSignedAt)
        letter.agreementSignedAt = data.agreementSignedAt as Date;

      return Promise.resolve({ count: 1 });
    },
  );

  const reviewCreate = jest.fn(() => Promise.resolve({}));

  const tx = {
    loanApplication: { updateMany },
    loanApplicationReview: { create: reviewCreate },
    sanctionLetter: {
      create: letterCreate,
      updateMany: letterUpdateMany,
      findMany: jest.fn(() => Promise.resolve([])),
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
  };

  const prisma = {
    ...tx,
    user: { findFirst: jest.fn(() => Promise.resolve(null)) },
    $transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as PrismaService;

  const audit = { record: jest.fn(() => Promise.resolve()) };

  const applications = {
    findInScope: jest.fn(() => Promise.resolve(application)),
    getById: jest.fn(() => Promise.resolve({})),
  } as unknown as LoanApplicationService;

  const transitions = new ApplicationTransitionService(
    prisma,
    audit as unknown as AuditService,
  );

  return {
    service: new LoanSanctionService(prisma, applications, transitions),
    audit,
    updateMany,
    letterCreate,
    letterUpdateMany,
    reviewCreate,
    row,
    letter,
    applications,
  };
}

describe('issuing a sanction letter (Scenarios 30, 31)', () => {
  it('moves an approved application to SANCTIONED and stamps the time', async () => {
    const { service, updateMany, row } = harness();

    await service.issue(
      actor(),
      APPLICATION_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(updateMany).toHaveBeenCalledWith(
      containing({
        data: containing({ status: 'SANCTIONED' }),
      }),
    );
    expect(row.status).toBe('SANCTIONED');
  });

  /**
   * Snapshotting is what makes "can sanctioned terms differ from approved
   * terms" answer itself. If the letter ever took its terms from the request,
   * a reissue at different terms would silently bypass the approval.
   */
  it('snapshots the terms from the application, not the request', async () => {
    const { service, letterCreate } = harness();

    await service.issue(
      actor(),
      APPLICATION_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(letterCreate).toHaveBeenCalledWith(
      containing({
        data: containing({
          sanctionedAmountPaise: 10_000_000n,
          interestRateBps: 1_200n,
          interestType: 'REDUCING',
          repaymentFrequency: 'MONTHLY',
          durationCount: 12,
          issuedBy: USER_ID,
        }),
      }),
    );
  });

  it('allocates the first sanction number as SL-000001', async () => {
    const { service, letterCreate } = harness();

    await service.issue(
      actor(),
      APPLICATION_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(letterCreate).toHaveBeenCalledWith(
      containing({ data: containing({ sanctionNumber: 'SL-000001' }) }),
    );
  });

  /** Scenario 31. Structural: UNDER_REVIEW is in no `from` list for issue. */
  it('refuses to sanction an application still under review', async () => {
    const { service, updateMany, letterCreate, audit } = harness(
      buildApplication({ status: 'UNDER_REVIEW' }),
    );

    await expect(
      service.issue(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
    expect(letterCreate).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_APPLICATION_TRANSITION_REJECTED,
        metadata: containing({ reason: 'ILLEGAL_FROM_UNDER_REVIEW' }),
      }),
    );
  });

  it('refuses a second letter for an already sanctioned application', async () => {
    const { service, letterCreate } = harness(
      buildApplication({ status: 'SANCTIONED' }),
    );

    await expect(
      service.issue(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(letterCreate).not.toHaveBeenCalled();
  });

  it('refuses a stale version without creating a letter', async () => {
    const { service, updateMany, letterCreate } = harness();

    await expect(
      service.issue(
        actor(),
        APPLICATION_ID,
        { expectedVersion: STALE_VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
    expect(letterCreate).not.toHaveBeenCalled();
  });

  it('refuses terms that produce no schedule, before any write', async () => {
    const { service, updateMany, letterCreate } = harness(
      buildApplication({ requestedAmountPaise: 0n }),
    );

    await expect(
      service.issue(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
    expect(letterCreate).not.toHaveBeenCalled();
  });
});

describe('customer acceptance (Scenario 33)', () => {
  it('moves a sanctioned application to CUSTOMER_ACCEPTED', async () => {
    const { service, row } = harness(
      buildApplication({ status: 'SANCTIONED' }),
      { customerResponse: 'PENDING', agreementSignedAt: null },
    );

    await service.accept(
      actor(),
      APPLICATION_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(row.status).toBe('CUSTOMER_ACCEPTED');
  });

  it('marks the letter accepted and records who transcribed it', async () => {
    const { service, letterUpdateMany, letter } = harness(
      buildApplication({ status: 'SANCTIONED' }),
      { customerResponse: 'PENDING', agreementSignedAt: null },
    );

    await service.accept(
      actor(),
      APPLICATION_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(letterUpdateMany).toHaveBeenCalledWith(
      containing({
        where: containing({ customerResponse: 'PENDING' }),
        data: containing({
          customerResponse: 'ACCEPTED',
          responseRecordedBy: USER_ID,
        }),
      }),
    );
    expect(letter?.customerResponse).toBe('ACCEPTED');
  });

  /**
   * The letter's own guard doing work the application's status guard would
   * normally have done. If the two ever disagree, this is what refuses.
   */
  it('refuses a second response on a letter already answered', async () => {
    const { service } = harness(buildApplication({ status: 'SANCTIONED' }), {
      customerResponse: 'ACCEPTED',
      agreementSignedAt: null,
    });

    await expect(
      service.accept(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(/already had a response|already been recorded/i);
  });
});

describe('customer decline (Scenario 32, Rule 13)', () => {
  /**
   * The single most important assertion in this file.
   *
   * Rule 13 unifies an admin rejection and a customer decline into one REJECTED
   * status. The Prisma enum's unused CUSTOMER_REJECTED value is a standing
   * invitation to "fix" this; the test is what makes such a change fail loudly
   * instead of quietly forking every `status === 'REJECTED'` consumer.
   */
  it('lands on REJECTED, never on CUSTOMER_REJECTED', async () => {
    const { service, updateMany, row } = harness(
      buildApplication({ status: 'SANCTIONED' }),
      { customerResponse: 'PENDING', agreementSignedAt: null },
    );

    await service.decline(
      actor(),
      APPLICATION_ID,
      { declineReason: 'Found cheaper credit', expectedVersion: VERSION },
      META,
    );

    expect(row.status).toBe('REJECTED');
    expect(updateMany).not.toHaveBeenCalledWith(
      containing({ data: containing({ status: 'CUSTOMER_REJECTED' }) }),
    );
  });

  it("copies the decline reason onto the application's rejection reason", async () => {
    // The unified REJECTED status carries no information on its own (Rule 40),
    // so losing this would make a declined application indistinguishable from
    // any other rejection.
    const { service, updateMany } = harness(
      buildApplication({ status: 'SANCTIONED' }),
      { customerResponse: 'PENDING', agreementSignedAt: null },
    );

    await service.decline(
      actor(),
      APPLICATION_ID,
      { declineReason: 'Found cheaper credit', expectedVersion: VERSION },
      META,
    );

    expect(updateMany).toHaveBeenCalledWith(
      containing({
        data: containing({ rejectionReason: 'Found cheaper credit' }),
      }),
    );
  });

  /**
   * With one status for both, the review row's SANCTION type is the only thing
   * telling a customer's decline apart from an admin's rejection.
   */
  it('writes a SANCTION review row, distinguishing it from an admin rejection', async () => {
    const { service, reviewCreate } = harness(
      buildApplication({ status: 'SANCTIONED' }),
      { customerResponse: 'PENDING', agreementSignedAt: null },
    );

    await service.decline(
      actor(),
      APPLICATION_ID,
      { declineReason: 'Found cheaper credit', expectedVersion: VERSION },
      META,
    );

    expect(reviewCreate).toHaveBeenCalledWith(
      containing({
        data: containing({
          reviewType: 'SANCTION',
          decision: 'REJECTED',
          rejectionReason: 'Found cheaper credit',
        }),
      }),
    );
  });

  it('audits the decline distinctly from an admin rejection', async () => {
    const { service, audit } = harness(
      buildApplication({ status: 'SANCTIONED' }),
      { customerResponse: 'PENDING', agreementSignedAt: null },
    );

    await service.decline(
      actor(),
      APPLICATION_ID,
      { declineReason: 'Found cheaper credit', expectedVersion: VERSION },
      META,
    );

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_SANCTION_DECLINED }),
      expect.anything(),
    );
  });

  it('refuses to decline an application that was never sanctioned', async () => {
    const { service, updateMany } = harness(
      buildApplication({ status: 'APPROVED' }),
    );

    await expect(
      service.decline(
        actor(),
        APPLICATION_ID,
        { declineReason: 'Too late', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('recording the signed agreement (Scenarios 33, 34)', () => {
  it('moves an accepted application to AGREEMENT_SIGNED', async () => {
    const { service, row } = harness(
      buildApplication({ status: 'CUSTOMER_ACCEPTED' }),
      { customerResponse: 'ACCEPTED', agreementSignedAt: null },
    );

    await service.recordAgreement(
      actor(),
      APPLICATION_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(row.status).toBe('AGREEMENT_SIGNED');
  });

  /** Acceptance cannot be skipped: a signature needs something to sign. */
  it('refuses to record a signature before the customer accepted', async () => {
    const { service, updateMany } = harness(
      buildApplication({ status: 'SANCTIONED' }),
      { customerResponse: 'PENDING', agreementSignedAt: null },
    );

    await expect(
      service.recordAgreement(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('stores the supplied signed date and reference', async () => {
    const { service, letterUpdateMany } = harness(
      buildApplication({ status: 'CUSTOMER_ACCEPTED' }),
      { customerResponse: 'ACCEPTED', agreementSignedAt: null },
    );

    await service.recordAgreement(
      actor(),
      APPLICATION_ID,
      {
        signedDate: '2026-08-15',
        agreementReference: 'AGR-2026-0042',
        expectedVersion: VERSION,
      },
      META,
    );

    expect(letterUpdateMany).toHaveBeenCalledWith(
      containing({
        data: containing({
          agreementReference: 'AGR-2026-0042',
          agreementSignedRecordedBy: USER_ID,
        }),
      }),
    );
  });

  it('refuses a second signature on the same letter', async () => {
    const { service } = harness(
      buildApplication({ status: 'CUSTOMER_ACCEPTED' }),
      {
        customerResponse: 'ACCEPTED',
        agreementSignedAt: new Date('2026-08-15T00:00:00.000Z'),
      },
    );

    await expect(
      service.recordAgreement(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('scope', () => {
  /**
   * Scope is `LoanApplicationService.findInScope`'s job, and this service must
   * not soften its refusal into a different error or a null. A second reading
   * of which applications a caller can reach is the easiest place for branch
   * scope to be quietly lost.
   */
  it('propagates a scope refusal from issue untouched', async () => {
    const { service, applications } = harness();
    const denied = new Error('not reachable');
    (applications.findInScope as jest.Mock).mockRejectedValueOnce(denied);

    await expect(
      service.issue(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBe(denied);
  });

  it('propagates a scope refusal from accept untouched', async () => {
    const { service, applications } = harness();
    const denied = new Error('not reachable');
    (applications.findInScope as jest.Mock).mockRejectedValueOnce(denied);

    await expect(
      service.accept(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBe(denied);
  });
});
