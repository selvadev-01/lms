import { BadRequestException, ConflictException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ApplicationTransitionService } from '../applications/application-transition.service';
import { CreditAssessmentService } from './credit-assessment.service';
import { LoanApplicationCompletenessService } from '../applications/loan-application-completeness.service';
import { LoanApplicationReviewService } from './loan-application-review.service';
import type { LoanApplicationService } from '../applications/loan-application.service';
import type { ApplicationStatus } from '@lms/types';

import type { ApplicationWithRelations } from '../applications/loan-application.mapper';
import type { LoanSchemeService } from '../products/loan-scheme.service';
import {
  notificationEventsStub,
  type NotificationEventsStub,
} from '../../notifications/testing/notification-events.stub';

/**
 * The reviewer's lifecycle — transition legality and the concurrency guard.
 *
 * The guard tests carry almost all the weight here, because the bug they pin is
 * invisible to every other kind of test. `updateMany` returns `{ count }` and
 * does *not* throw when it matches nothing, so a service that omits the
 * `count === 0` check still passes a happy-path test, still compiles, and still
 * silently lets two concurrent decisions both "succeed" (Scenario 52).
 *
 * The Prisma stand-in models that faithfully: `updateMany` compares the WHERE
 * against the row's current status and timestamp and returns a real count. A
 * guard that dropped either key from the WHERE would start returning 1 where
 * these tests expect 0.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-4444-444444444444';
const SCHEME_ID = '55555555-5555-5555-5555-555555555555';

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
      'loans.applications.review',
      'loans.applications.modify_terms',
      'loans.approve',
      'loans.applications.reject',
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
    loanSchemeId: SCHEME_ID,
    requestedAmountPaise: 10_000_000n,
    purpose: 'Working capital',
    interestType: 'REDUCING',
    interestRateBps: 1_200n,
    repaymentFrequency: 'MONTHLY',
    durationCount: 12,
    status: 'UNDER_REVIEW',
    rejectionReason: null,
    submittedAt: new Date('2026-08-10T00:00:00.000Z'),
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

interface Harness {
  service: LoanApplicationReviewService;
  /** Module 16 — what the service raised after each committed decision. */
  events: NotificationEventsStub;
  audit: { record: jest.Mock };
  updateMany: jest.Mock;
  reviewCreate: jest.Mock;
  /** The live row the stand-in arbitrates against, so a test can move it. */
  row: { status: ApplicationStatus; updatedAt: Date };
  /** How many times the document stand-in has been read. */
  documentReads: () => number;
  /** The current credit assessment, or null. */
  assessment: { assessmentResult: string | null } | null;
}

const COMPLETE_DOCUMENTS = [{ documentType: 'ID' }, { documentType: 'INCOME' }];

function harness(
  application = buildApplication(),
  options: {
    documents?: { documentType: string }[];
    /**
     * A different answer per read, for proving that a check run twice is not
     * the same as a check run once. Index N answers read N; the last entry
     * answers every read beyond it.
     */
    documentsPerRead?: { documentType: string }[][];
    assessment?: { assessmentResult: string | null } | null;
  } = {},
): Harness {
  // Approval needs ID and INCOME for a PERSONAL product, and a PASS assessment.
  // Both default to satisfied so a test that is not about a gate does not have
  // to set one up; the gate tests override them.
  const perRead = options.documentsPerRead ?? [
    options.documents ?? COMPLETE_DOCUMENTS,
  ];
  const assessment =
    options.assessment === undefined
      ? { assessmentResult: 'PASS' as string | null }
      : options.assessment;

  return buildHarness(application, perRead, assessment);
}

function buildHarness(
  application: ApplicationWithRelations,
  documentsPerRead: { documentType: string }[][],
  assessment: { assessmentResult: string | null } | null,
): Harness {
  // The single row every updateMany is judged against.
  const row = { status: application.status, updatedAt: application.updatedAt };

  /**
   * A faithful `updateMany`: it compares the WHERE against the row's *current*
   * state and returns a count. This is what makes the concurrency tests real —
   * a guard missing `status` or `updatedAt` would match here and return 1.
   */
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
      // Every write bumps the timestamp, exactly as @updatedAt does.
      row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
      return Promise.resolve({ count: 1 });
    },
  );

  const reviewCreate = jest.fn(() => Promise.resolve({}));

  // Answers each read from `documentsPerRead`, so a test can make the second
  // read differ from the first and prove the inner re-check catches what the
  // outer pass let through.
  let reads = 0;
  const documentFindMany = jest.fn(() => {
    const answer =
      documentsPerRead[Math.min(reads, documentsPerRead.length - 1)] ?? [];
    reads += 1;
    return Promise.resolve(answer);
  });
  const assessmentFindFirst = jest.fn(() => Promise.resolve(assessment));

  const tx = {
    loanApplication: { updateMany },
    loanApplicationReview: { create: reviewCreate },
    loanApplicationDocument: { findMany: documentFindMany },
    creditAssessment: { findFirst: assessmentFindFirst },
  };

  const prisma = {
    ...tx,
    user: { findMany: jest.fn(() => Promise.resolve([])) },
    loanApplicationReview: {
      ...tx.loanApplicationReview,
      findMany: jest.fn(() => Promise.resolve([])),
    },
    $transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as PrismaService;

  const audit = { record: jest.fn(() => Promise.resolve()) };

  const applications = {
    findInScope: jest.fn(() => Promise.resolve(application)),
    getById: jest.fn(() => Promise.resolve({})),
  } as unknown as LoanApplicationService;

  const schemes = {
    assertSelectable: jest.fn(() =>
      Promise.resolve({ interestRateBps: 1_200n }),
    ),
  } as unknown as LoanSchemeService;

  // The real transition service, not a stand-in: it *is* the guard these tests
  // exist to pin, and mocking it would leave nothing under test.
  const transitions = new ApplicationTransitionService(
    prisma,
    audit as unknown as AuditService,
  );

  // Also real. `missingDocuments` is a pure read over the document stand-in,
  // and the approval gate's behaviour is exactly what it returns.
  const completeness = new LoanApplicationCompletenessService(
    prisma,
    {} as never,
  );

  const assessments = new CreditAssessmentService(
    prisma,
    audit as unknown as AuditService,
    applications,
  );

  const events = notificationEventsStub();

  return {
    service: new LoanApplicationReviewService(
      prisma,
      audit as unknown as AuditService,
      applications,
      schemes,
      transitions,
      completeness,
      assessments,
      events.service,
    ),
    events,
    audit,
    updateMany,
    reviewCreate,
    row,
    documentReads: () => reads,
    assessment,
  };
}

describe('transition legality', () => {
  it('takes a submitted application into review', async () => {
    const { service, row } = harness(buildApplication({ status: 'SUBMITTED' }));

    await service.startReview(actor(), APPLICATION_ID, VERSION, META);

    expect(row.status).toBe('UNDER_REVIEW');
  });

  it('refuses to start review on a draft', async () => {
    const { service, updateMany } = harness(
      buildApplication({ status: 'DRAFT' }),
    );

    await expect(
      service.startReview(actor(), APPLICATION_ID, VERSION, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses to approve an application that was already rejected (Rule 85)', async () => {
    // There is no reopen lifecycle in the source, so REJECTED has no outgoing
    // transition at all — the refusal is structural, not a status check bolted on.
    const { service, updateMany, audit } = harness(
      buildApplication({ status: 'REJECTED' }),
    );

    await expect(
      service.approve(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(/already been rejected/i);

    expect(updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_APPLICATION_TRANSITION_REJECTED }),
    );
  });

  /**
   * The message deliberately no longer says "already been approved". Since
   * Module 08, APPROVED is not terminal — it moves on to SANCTIONED — so a
   * refusal claiming otherwise would contradict the state machine. The generic
   * illegal-transition wording is the correct one; the refusal itself is what
   * Rule 86 needs, and it still holds.
   */
  it('refuses to reject an application that was already approved (Rule 86)', async () => {
    const { service, updateMany } = harness(
      buildApplication({ status: 'APPROVED' }),
    );

    await expect(
      service.reject(
        actor(),
        APPLICATION_ID,
        { rejectionReason: 'Changed my mind', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(/APPROVED cannot move to REJECTED/i);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses to change an application whose agreement is already signed', async () => {
    const { service, updateMany } = harness(
      buildApplication({ status: 'AGREEMENT_SIGNED' }),
    );

    await expect(
      service.reject(
        actor(),
        APPLICATION_ID,
        { rejectionReason: 'Too late', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(/signed agreement and is awaiting disbursal/i);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('allows rejection straight from SUBMITTED without a review pass', async () => {
    // Forcing a reviewer to claim an application before refusing it would be
    // ceremony rather than control (T10).
    const { service, row } = harness(buildApplication({ status: 'SUBMITTED' }));

    await service.reject(
      actor(),
      APPLICATION_ID,
      { rejectionReason: 'Insufficient income', expectedVersion: VERSION },
      META,
    );

    expect(row.status).toBe('REJECTED');
  });

  it('stores the rejection reason on the row and in the review history', async () => {
    const { service, updateMany, reviewCreate } = harness();

    await service.reject(
      actor(),
      APPLICATION_ID,
      { rejectionReason: 'Insufficient income', expectedVersion: VERSION },
      META,
    );

    expect(updateMany).toHaveBeenCalledWith(
      containing({
        data: containing({ rejectionReason: 'Insufficient income' }),
      }),
    );
    expect(reviewCreate).toHaveBeenCalledWith(
      containing({
        data: containing({
          decision: 'REJECTED',
          rejectionReason: 'Insufficient income',
        }),
      }),
    );
  });
});

describe('the concurrency guard (Scenario 52)', () => {
  it('commits exactly one of a concurrent approve and reject', async () => {
    // Both callers read the same version, as two reviewers with the screen open
    // would. The first write moves the row; the second must find nothing to
    // match and be refused rather than overwriting the first decision.
    const { service, row } = harness();

    await service.approve(
      actor(),
      APPLICATION_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(row.status).toBe('APPROVED');

    await expect(
      service.reject(
        actor(),
        APPLICATION_ID,
        { rejectionReason: 'Too risky', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    // The first decision stands. This is the assertion the whole guard exists
    // for: without it the row would read REJECTED here.
    expect(row.status).toBe('APPROVED');
  });

  it('refuses a stale version even when the status is still legal', async () => {
    // Caught before the write, by comparing the caller's belief against the row
    // that was just read. The database guard alone would *not* catch this: it
    // compares `before.updatedAt`, a value the service read for itself, which
    // always matches. Both checks are needed — this one closes the window before
    // the read, the guard closes the window between the read and the write.
    const { service, updateMany, audit } = harness();

    await expect(
      service.approve(
        actor(),
        APPLICATION_ID,
        { expectedVersion: STALE_VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_APPLICATION_CONCURRENT_EDIT_REJECTED,
        metadata: containing({ stage: 'PRE_READ' }),
      }),
    );
  });

  it('puts both the status and the version in the WHERE clause', async () => {
    // Pins the guard's shape directly. Dropping either key would leave the
    // service passing every other test in this file while reopening the race.
    const { service, updateMany } = harness();

    await service.approve(
      actor(),
      APPLICATION_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(updateMany).toHaveBeenCalledWith(
      containing({
        where: containing({
          orgId: ORG_ID,
          applicationId: APPLICATION_ID,
          status: 'UNDER_REVIEW',
          updatedAt: new Date(VERSION),
        }),
      }),
    );
  });

  it('rejects an unparseable version as a 400, not a 409', async () => {
    // An Invalid Date would match nothing and produce a 409 blaming a phantom
    // concurrent editor, when the real fault is the request.
    const { service, updateMany } = harness();

    await expect(
      service.approve(
        actor(),
        APPLICATION_ID,
        { expectedVersion: 'yesterday' },
        META,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('modify terms', () => {
  const dto = {
    interestType: 'REDUCING' as const,
    interestRateBps: '1400',
    repaymentFrequency: 'MONTHLY' as const,
    durationCount: 18,
    comments: 'Reduced exposure',
    expectedVersion: VERSION,
  };

  it('records the terms as they were before the change', async () => {
    // Storing the *previous* values is what makes the original submitted terms
    // recoverable from the oldest MODIFY_TERMS row (Scenario 60).
    const { service, reviewCreate } = harness();

    await service.modifyTerms(actor(), APPLICATION_ID, dto, META);

    expect(reviewCreate).toHaveBeenCalledWith(
      containing({
        data: containing({
          reviewType: 'MODIFY_TERMS',
          decision: 'TERMS_MODIFIED',
          previousInterestRateBps: 1_200n,
          previousDurationCount: 12,
          previousFrequency: 'MONTHLY',
          previousInterestType: 'REDUCING',
        }),
      }),
    );
  });

  it('leaves the application under review', async () => {
    // Modifying terms is not a decision on the application's fate; it still
    // needs an approve or reject afterwards.
    const { service, row } = harness();

    await service.modifyTerms(actor(), APPLICATION_ID, dto, META);

    expect(row.status).toBe('UNDER_REVIEW');
  });

  it('refuses terms that produce no repayment schedule (Rule 68)', async () => {
    const { service, updateMany } = harness();

    await expect(
      service.modifyTerms(
        actor(),
        APPLICATION_ID,
        { ...dto, durationCount: 0 },
        META,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses to modify terms outside review', async () => {
    const { service } = harness(buildApplication({ status: 'SUBMITTED' }));

    await expect(
      service.modifyTerms(actor(), APPLICATION_ID, dto, META),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('checks the revised term against the scheme', async () => {
    // A reviewer may reprice within the scheme, not invent a term outside it.
    const { service } = harness();
    const schemes = (
      service as unknown as { schemes: { assertSelectable: jest.Mock } }
    ).schemes;

    await service.modifyTerms(actor(), APPLICATION_ID, dto, META);

    expect(schemes.assertSelectable).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      SCHEME_ID,
      'MONTHLY',
      18,
    );
  });
});

describe('approval', () => {
  it('refuses to approve terms that produce no schedule', async () => {
    // Rule 68 enforced independently of Modify Terms: approval fails closed
    // rather than trusting whoever last touched the terms.
    const { service, updateMany } = harness(
      buildApplication({ requestedAmountPaise: 0n }),
    );

    await expect(
      service.approve(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('stamps the approver and time', async () => {
    const { service, updateMany } = harness();

    await service.approve(
      actor(),
      APPLICATION_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(updateMany).toHaveBeenCalledWith(
      containing({
        data: containing({ status: 'APPROVED', approvedBy: USER_ID }),
      }),
    );
  });

  // --- Module 08 gates ------------------------------------------------------

  it('refuses approval while a mandatory document is outstanding (Scenario 6)', async () => {
    // Submit already checked this, but a verifier can reject a document *after*
    // submission, which reopens the requirement without reopening the
    // application. Approval is where that is caught.
    const { service, updateMany, audit } = harness(buildApplication(), {
      documents: [{ documentType: 'ID' }],
    });

    await expect(
      service.approve(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_APPLICATION_APPROVE_BLOCKED,
        metadata: containing({ reason: 'DOCUMENTS_MISSING' }),
      }),
    );
  });

  it('names the missing document types in the refusal', async () => {
    const { service } = harness(buildApplication(), { documents: [] });

    await expect(
      service.approve(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toMatchObject({
      response: { missingDocumentTypes: ['ID', 'INCOME'] },
    });
  });

  it('refuses approval with no credit assessment (Scenario 8)', async () => {
    const { service, updateMany, audit } = harness(buildApplication(), {
      assessment: null,
    });

    await expect(
      service.approve(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_APPLICATION_APPROVE_BLOCKED,
        metadata: containing({ reason: 'ASSESSMENT_MISSING' }),
      }),
    );
  });

  it('refuses approval on an incomplete assessment', async () => {
    const { service, updateMany } = harness(buildApplication(), {
      assessment: { assessmentResult: null },
    });

    await expect(
      service.approve(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
  });

  /**
   * Scenario 9, and the single most important gate in the module: a failed
   * credit verification must never be treated as a successful one.
   */
  it('refuses approval on a FAILED credit assessment (Scenario 9)', async () => {
    const { service, updateMany, audit } = harness(buildApplication(), {
      assessment: { assessmentResult: 'FAIL' },
    });

    await expect(
      service.approve(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_APPLICATION_APPROVE_BLOCKED,
        metadata: containing({ reason: 'ASSESSMENT_NOT_PASSED' }),
      }),
    );
  });

  /**
   * MANUAL_REVIEW blocks as firmly as FAIL. It means "a human must decide", and
   * an unresolved check must not become a pass by being ambiguous. The reviewer
   * who has decided records a fresh PASS; the MANUAL_REVIEW row survives as
   * superseded, which is what makes that decision auditable.
   */
  it('refuses approval on a MANUAL_REVIEW assessment', async () => {
    const { service, updateMany } = harness(buildApplication(), {
      assessment: { assessmentResult: 'MANUAL_REVIEW' },
    });

    await expect(
      service.approve(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
  });

  /**
   * Scenario 13 — outstanding More Info blocks approval — needs no gate. It is
   * structural: MORE_INFO_REQUIRED is in no `from` list for approve, so such an
   * application cannot be approved at all. This test is what keeps that true.
   */
  it('refuses approval while information is outstanding (Scenario 13)', async () => {
    const { service, updateMany, audit } = harness(
      buildApplication({ status: 'MORE_INFO_REQUIRED' }),
    );

    await expect(
      service.approve(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({
        action: AuditAction.LOAN_APPLICATION_TRANSITION_REJECTED,
        metadata: containing({ reason: 'ILLEGAL_FROM_MORE_INFO_REQUIRED' }),
      }),
    );
  });

  /**
   * The inner re-check earning its place. The outer gate sees a complete set of
   * documents; the set empties before the transaction's own read. Without the
   * `inTransaction` pass the approval would commit against a state that no
   * longer holds — the assessment analogue of Scenario 51.
   */
  /**
   * The inner re-check earning its place.
   *
   * The document stand-in answers the *first* read (the outer gate) with a
   * complete set and every read after it with nothing, which is exactly a
   * verifier rejecting a document between the check and the write. Only the
   * in-transaction pass can catch that; without it the approval commits against
   * a state that no longer holds.
   *
   * Asserts on `updateMany`'s call count rather than on `row.status`, because
   * the `$transaction` stand-in runs the callback directly and does not model
   * rollback — a status assertion here would be testing the stand-in, not the
   * service. The count proves the write was attempted and the throw came after.
   */
  it('re-checks the gates inside the transaction (Rule 48)', async () => {
    const { service, updateMany, documentReads } = harness(buildApplication(), {
      documentsPerRead: [
        [{ documentType: 'ID' }, { documentType: 'INCOME' }],
        [],
      ],
    });

    await expect(
      service.approve(
        actor(),
        APPLICATION_ID,
        { expectedVersion: VERSION },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    // Read twice: once by the outer gate, once inside the transaction.
    expect(documentReads()).toBe(2);
    // The outer gate passed, so the write was attempted before the inner
    // re-check refused it.
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('writes no loan or disbursement row (Rules 47, 48; Scenario 30)', async () => {
    // Approval is not disbursement. The only tables this service may touch are
    // the application and its review history.
    const { service } = harness();
    const prisma = (service as unknown as { prisma: Record<string, unknown> })
      .prisma;

    await service.approve(
      actor(),
      APPLICATION_ID,
      { expectedVersion: VERSION },
      META,
    );

    expect(prisma).not.toHaveProperty('loan');
    expect(prisma).not.toHaveProperty('disbursement');
  });
});
