import { ConflictException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreditAssessmentService,
  type AssessmentRow,
} from './credit-assessment.service';
import type { LoanApplicationService } from '../applications/loan-application.service';
import type { ApplicationWithRelations } from '../applications/loan-application.mapper';
import type { ApplicationStatus } from '@lms/types';

/**
 * Module 08 — credit assessment.
 *
 * Two behaviours carry the weight here, and both are invisible to a happy-path
 * test:
 *
 * 1. **Supersession, not editing.** `record` must displace the current row and
 *    insert a new one. A service that updated in place would pass any test that
 *    only checked the result afterwards, while silently destroying the finding
 *    an earlier decision was taken against.
 * 2. **A failed check is not a pass.** `assertApprovable` must refuse FAIL
 *    *and* MANUAL_REVIEW. Scenario 9 is precisely the case where an ambiguous
 *    or failed verification quietly becomes an approval.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-4444-444444444444';
const ASSESSMENT_ID = '55555555-5555-5555-5555-555555555555';

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
      'loans.applications.assessment.view',
      'loans.applications.assessment.record',
    ],
    ...overrides,
  };
}

function buildApplication(
  status: ApplicationStatus = 'UNDER_REVIEW',
): ApplicationWithRelations {
  return {
    orgId: ORG_ID,
    applicationId: APPLICATION_ID,
    status,
  } as unknown as ApplicationWithRelations;
}

function buildAssessment(
  overrides: Partial<AssessmentRow> = {},
): AssessmentRow {
  return {
    assessmentId: ASSESSMENT_ID,
    applicationId: APPLICATION_ID,
    cibilScore: 760,
    incomeVerified: true,
    incomeMonthlyPaise: 5_000_000n,
    assessmentResult: 'PASS',
    assessmentNotes: null,
    assessedBy: USER_ID,
    assessedAt: new Date('2026-08-20T00:00:00.000Z'),
    supersededAt: null,
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    ...overrides,
  };
}

function harness(application = buildApplication(), rows: AssessmentRow[] = []) {
  const updateMany = jest.fn(
    ({ where }: { where: Record<string, unknown> }) => {
      // Faithful: only rows matching the WHERE are counted, so a supersede that
      // dropped `supersededAt: null` would start displacing already-superseded
      // rows and this count would change.
      const matched = rows.filter(
        (row) =>
          (where.supersededAt === null) === (row.supersededAt === null) &&
          where.applicationId === row.applicationId,
      );
      return Promise.resolve({ count: matched.length });
    },
  );

  const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve(buildAssessment(data as Partial<AssessmentRow>)),
  );

  const findFirst = jest.fn(() =>
    Promise.resolve(rows.find((row) => row.supersededAt === null) ?? null),
  );

  const findMany = jest.fn(() => Promise.resolve(rows));

  const applicationUpdateMany = jest.fn(() => Promise.resolve({ count: 1 }));

  const tx = {
    creditAssessment: { updateMany, create, findFirst, findMany },
    loanApplication: { updateMany: applicationUpdateMany },
  };

  const prisma = {
    ...tx,
    user: { findMany: jest.fn(() => Promise.resolve([])) },
    $transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as PrismaService;

  const audit = { record: jest.fn(() => Promise.resolve()) };

  const applications = {
    findInScope: jest.fn(() => Promise.resolve(application)),
  } as unknown as LoanApplicationService;

  return {
    service: new CreditAssessmentService(
      prisma,
      audit as unknown as AuditService,
      applications,
    ),
    audit,
    updateMany,
    create,
    applicationUpdateMany,
    applications,
    /** What `approve` would hand the gate: a client, not a bare object. */
    tx: tx as unknown as PrismaService,
  };
}

const DTO = {
  cibilScore: 780,
  incomeVerified: true,
  assessmentResult: 'PASS' as const,
};

describe('recording an assessment', () => {
  it('supersedes the current assessment rather than editing it', async () => {
    const { service, updateMany, create } = harness(buildApplication(), [
      buildAssessment(),
    ]);

    await service.record(actor(), APPLICATION_ID, DTO, META);

    // The WHERE must name `supersededAt: null` — without it, a re-assessment
    // would stamp every historical row and the history would collapse.
    expect(updateMany).toHaveBeenCalledWith(
      containing({
        where: containing({
          applicationId: APPLICATION_ID,
          supersededAt: null,
        }),
      }),
    );
    expect(create).toHaveBeenCalled();
  });

  it('takes the assessor from the actor, never from the request', async () => {
    const { service, create } = harness();

    await service.record(
      actor(),
      APPLICATION_ID,
      // A client naming someone else as the assessor must not be believed:
      // it would attribute a finding to a person who never made it.
      { ...DTO, assessedBy: 'not-this-user' } as never,
      META,
    );

    expect(create).toHaveBeenCalledWith(
      containing({ data: containing({ assessedBy: USER_ID }) }),
    );
  });

  /**
   * Pins the deliberate decision that recording an assessment does not bump the
   * application's version. It is not a lifecycle transition, and bumping would
   * invalidate an approve form a reviewer already has open for a reason the
   * reviewer could not understand. The staleness that matters is closed by
   * `assertApprovable` re-reading inside approve's transaction instead.
   */
  it('does not touch the application row', async () => {
    const { service, applicationUpdateMany } = harness();

    await service.record(actor(), APPLICATION_ID, DTO, META);

    expect(applicationUpdateMany).not.toHaveBeenCalled();
  });

  it('audits the recording', async () => {
    const { service, audit } = harness();

    await service.record(actor(), APPLICATION_ID, DTO, META);

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_CREDIT_ASSESSMENT_RECORDED }),
      expect.anything(),
    );
  });

  it('audits the supersession only when something was superseded', async () => {
    const { service, audit } = harness();

    await service.record(actor(), APPLICATION_ID, DTO, META);

    expect(audit.record).not.toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_CREDIT_ASSESSMENT_SUPERSEDED }),
      expect.anything(),
    );
  });

  it.each([
    'DRAFT',
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
  ] as ApplicationStatus[])(
    'refuses to record against a %s application',
    async (status) => {
      const { service, create } = harness(buildApplication(status));

      await expect(
        service.record(actor(), APPLICATION_ID, DTO, META),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(create).not.toHaveBeenCalled();
    },
  );

  it('allows recording while more information is outstanding', async () => {
    // A branch supplying the missing documents may well also be the moment the
    // income check completes; refusing here would force a pointless round trip.
    const { service, create } = harness(buildApplication('MORE_INFO_REQUIRED'));

    await service.record(actor(), APPLICATION_ID, DTO, META);

    expect(create).toHaveBeenCalled();
  });

  it('propagates a scope refusal untouched', async () => {
    const { service, applications } = harness();
    const denied = new Error('not reachable');
    (applications.findInScope as jest.Mock).mockRejectedValueOnce(denied);

    await expect(
      service.record(actor(), APPLICATION_ID, DTO, META),
    ).rejects.toBe(denied);
  });
});

describe('the approval gate (Scenarios 8, 9)', () => {
  it('refuses when no assessment was ever recorded', async () => {
    const { service, tx } = harness(buildApplication(), []);

    await expect(
      service.assertApprovable(tx, ORG_ID, APPLICATION_ID),
    ).rejects.toMatchObject({
      response: { reason: 'ASSESSMENT_MISSING' },
    });
  });

  it('refuses an assessment with no result', async () => {
    const { service, tx } = harness(buildApplication(), [
      buildAssessment({ assessmentResult: null }),
    ]);

    await expect(
      service.assertApprovable(tx, ORG_ID, APPLICATION_ID),
    ).rejects.toMatchObject({
      response: { reason: 'ASSESSMENT_INCOMPLETE' },
    });
  });

  /** Scenario 9: a failed verification must never be treated as a success. */
  it('refuses a FAILED assessment', async () => {
    const { service, tx } = harness(buildApplication(), [
      buildAssessment({ assessmentResult: 'FAIL' }),
    ]);

    await expect(
      service.assertApprovable(tx, ORG_ID, APPLICATION_ID),
    ).rejects.toMatchObject({
      response: { reason: 'ASSESSMENT_NOT_PASSED', assessmentResult: 'FAIL' },
    });
  });

  /**
   * Ambiguity is not a pass. MANUAL_REVIEW means a human must decide, and the
   * reviewer who decides records a fresh PASS — leaving the MANUAL_REVIEW row
   * behind as the auditable trace of that decision.
   */
  it('refuses a MANUAL_REVIEW assessment as firmly as a FAIL', async () => {
    const { service, tx } = harness(buildApplication(), [
      buildAssessment({ assessmentResult: 'MANUAL_REVIEW' }),
    ]);

    await expect(
      service.assertApprovable(tx, ORG_ID, APPLICATION_ID),
    ).rejects.toMatchObject({
      response: {
        reason: 'ASSESSMENT_NOT_PASSED',
        assessmentResult: 'MANUAL_REVIEW',
      },
    });
  });

  it('allows a PASS', async () => {
    const { service, tx } = harness(buildApplication(), [buildAssessment()]);

    await expect(
      service.assertApprovable(tx, ORG_ID, APPLICATION_ID),
    ).resolves.toMatchObject({ assessmentResult: 'PASS' });
  });

  /**
   * The supersession read pointed at the right row. A superseded PASS sitting
   * behind a current FAIL must not rescue the application — which is what a
   * gate reading "any assessment" instead of "the current one" would do.
   */
  it('ignores a superseded PASS behind a current FAIL', async () => {
    const { service, tx } = harness(buildApplication(), [
      buildAssessment({
        assessmentResult: 'PASS',
        supersededAt: new Date('2026-08-19T00:00:00.000Z'),
      }),
      buildAssessment({ assessmentResult: 'FAIL' }),
    ]);

    await expect(
      service.assertApprovable(tx, ORG_ID, APPLICATION_ID),
    ).rejects.toMatchObject({
      response: { assessmentResult: 'FAIL' },
    });
  });

  it('reports the block to the caller before throwing', async () => {
    const { service, tx } = harness(buildApplication(), []);
    const onBlocked = jest.fn(() => Promise.resolve());

    await expect(
      service.assertApprovable(tx, ORG_ID, APPLICATION_ID, onBlocked),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(onBlocked).toHaveBeenCalledWith('ASSESSMENT_MISSING', {});
  });
});

describe('listing assessments', () => {
  it('separates the current assessment from the superseded ones', async () => {
    const superseded = buildAssessment({
      assessmentId: '66666666-6666-6666-6666-666666666666',
      assessmentResult: 'MANUAL_REVIEW',
      supersededAt: new Date('2026-08-19T00:00:00.000Z'),
    });
    const { service } = harness(buildApplication(), [
      superseded,
      buildAssessment(),
    ]);

    const history = await service.list(actor(), APPLICATION_ID, META);

    expect(history.current?.assessmentResult).toBe('PASS');
    expect(history.superseded).toHaveLength(1);
    expect(history.superseded[0]?.assessmentResult).toBe('MANUAL_REVIEW');
  });

  it('audits the read, because a CIBIL score is the borrower position', async () => {
    const { service, audit } = harness(buildApplication(), [buildAssessment()]);

    await service.list(actor(), APPLICATION_ID, META);

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.LOAN_CREDIT_ASSESSMENT_VIEWED }),
    );
  });

  it('returns a null current when nothing was ever recorded', async () => {
    const { service } = harness(buildApplication(), []);

    const history = await service.list(actor(), APPLICATION_ID, META);

    expect(history.current).toBeNull();
    expect(history.superseded).toEqual([]);
  });
});
