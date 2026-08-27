import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ApplicationTransitionService } from '../applications/application-transition.service';
import { DisbursementService } from './disbursement.service';
import { LedgerService } from './ledger.service';
import type { LoanApplicationService } from '../applications/loan-application.service';
import type { ApplicationWithRelations } from '../applications/loan-application.mapper';
import type { LoanService } from '../shared/loan.service';
import { notificationEventsStub } from '../../notifications/testing/notification-events.stub';

/**
 * Module 09 — disbursal.
 *
 * The assertions that matter most are the ones a plausible refactor would break
 * without any test failing loudly elsewhere:
 *
 * 1. **The amount comes from the sanction letter, never the caller.** The
 *    `recordTransfer` DTO carries an amount, which makes "just use the one the
 *    client sent" a one-line change that would pass every other test. Rule 6
 *    and Scenario 6 live or die on this.
 * 2. **The replay check precedes the version check.** A client retrying after a
 *    timeout holds the pre-commit version. Reordering these two — which looks
 *    like tidying, since every other method checks the version first — turns a
 *    successful retry into a 409 and Scenario 28 into a failure.
 * 3. **A ledger failure rolls back the loan activation.** The two live in one
 *    `inTransaction`, and Rules 14/17 depend on that. A test proving the loan
 *    is not left ACTIVE is what stops someone "improving" the error handling by
 *    catching the ledger throw.
 * 4. **Every gate re-runs inside the transaction.** `disbursalReadiness` is
 *    advisory; deleting the second run because "readiness already checked it"
 *    would reopen Scenarios 36, 41 and 42.
 *
 * The Prisma stand-in models `updateMany` faithfully — it compares the WHERE
 * against live state and returns a real count — so a guard that dropped its
 * status or version key would start returning 1 here.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-4444-444444444444';
const DISBURSEMENT_ID = '55555555-5555-5555-5555-555555555555';
const LOAN_ID = '66666666-6666-6666-6666-666666666666';
const BRANCH_ID = '77777777-7777-7777-7777-777777777777';
const CUSTOMER_ID = '88888888-8888-8888-8888-888888888888';
const ACCOUNT_ID = '99999999-9999-9999-9999-999999999999';
const IDEMPOTENCY_KEY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const SANCTIONED = 10_000_000n;
const VERSION = '2026-08-21T12:00:00.000Z';
const STALE_VERSION = '2026-08-21T11:00:00.000Z';
const APP_VERSION = '2026-08-21T10:00:00.000Z';

const META: RequestMeta = {
  requestId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: SESSION_ID,
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: [
      'loans.disbursements.view',
      'loans.disbursements.schedule',
      'loans.disbursements.record_transfer',
      'loans.disbursements.confirm',
      'loans.disbursements.cancel',
    ],
    ...overrides,
  };
}

interface DisbursementState {
  orgId: string;
  disbursementId: string;
  loanId: string;
  branchId: string;
  scheduledDate: Date;
  disbursementAccountId: string;
  disbursedAt: Date | null;
  amountPaise: bigint;
  paymentMode: 'CASH' | 'UPI' | 'BANK_TRANSFER';
  bankAccountReference: string | null;
  transactionReference: string | null;
  transferDate: Date | null;
  status: 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  idempotencyKey: string;
  journalEntryId: string | null;
  failureReason: string | null;
  createdBy: string;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function buildDisbursement(
  overrides: Partial<DisbursementState> = {},
): DisbursementState {
  return {
    orgId: ORG_ID,
    disbursementId: DISBURSEMENT_ID,
    loanId: LOAN_ID,
    branchId: BRANCH_ID,
    scheduledDate: new Date('2026-08-21T12:00:00+05:30'),
    disbursementAccountId: ACCOUNT_ID,
    disbursedAt: null,
    amountPaise: SANCTIONED,
    paymentMode: 'BANK_TRANSFER',
    bankAccountReference: null,
    transactionReference: null,
    transferDate: null,
    status: 'SCHEDULED',
    idempotencyKey: `SCHEDULE:${APPLICATION_ID}`,
    journalEntryId: null,
    failureReason: null,
    createdBy: USER_ID,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: new Date('2026-08-21T09:00:00.000Z'),
    updatedAt: new Date(VERSION),
    ...overrides,
  };
}

const RELATIONS = {
  loan: {
    loanNumber: 'LN-000001',
    applicationId: APPLICATION_ID,
    customerId: CUSTOMER_ID,
    interestType: 'REDUCING' as const,
    interestRateBps: 1200n,
    repaymentFrequency: 'MONTHLY' as const,
    durationCount: 12,
    customer: { fullName: 'Asha Rao' },
    application: { applicationNumber: 'APP-000001' },
  },
  disbursementAccount: {
    accountCode: '1200',
    accountName: 'Bank Account',
    status: 'ACTIVE' as const,
  },
};

function buildApplication(
  overrides: Partial<ApplicationWithRelations> = {},
): ApplicationWithRelations {
  return {
    orgId: ORG_ID,
    applicationId: APPLICATION_ID,
    applicationNumber: 'APP-000001',
    branchId: BRANCH_ID,
    customerId: CUSTOMER_ID,
    loanProductId: 'product-1',
    loanSchemeId: 'scheme-1',
    requestedAmountPaise: SANCTIONED,
    purpose: 'Working capital',
    interestType: 'REDUCING',
    interestRateBps: 1200n,
    repaymentFrequency: 'MONTHLY',
    durationCount: 12,
    status: 'DISBURSEMENT_PENDING',
    rejectionReason: null,
    submittedAt: new Date('2026-08-01T00:00:00.000Z'),
    approvedAt: new Date('2026-08-05T00:00:00.000Z'),
    approvedBy: USER_ID,
    sanctionedAt: new Date('2026-08-06T00:00:00.000Z'),
    customerRespondedAt: new Date('2026-08-07T00:00:00.000Z'),
    agreementSignedAt: new Date('2026-08-08T00:00:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date(APP_VERSION),
    customer: { fullName: 'Asha Rao', customerCode: 'CUST001' },
    branch: { name: 'Main Branch' },
    loanProduct: { code: 'PL', loanType: 'PERSONAL' },
    loanScheme: { code: 'PL-12', name: 'Personal 12M' },
    ...overrides,
  };
}

interface SanctionState {
  sanctionedAmountPaise: bigint;
  customerResponse: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  agreementSignedAt: Date | null;
}

interface Harness {
  service: DisbursementService;
  state: {
    disbursement: DisbursementState;
    sanction: SanctionState;
    accountStatus: 'ACTIVE' | 'INACTIVE';
    loan: { status: string; disbursementDate: Date | null };
    replay: DisbursementState | null;
    emis: { installmentNumber: number; totalDuePaise: bigint }[];
    schedules: number;
  };
  ledgerPost: jest.Mock;
  audit: { record: jest.Mock };
}

/**
 * Builds the service with stand-ins for everything it touches.
 *
 * `transitions` is the real `ApplicationTransitionService` wired to a stand-in
 * Prisma, not a mock: its guard is what arbitrates Scenario 44, and stubbing it
 * out would make the concurrency test prove nothing.
 */
function buildHarness(
  overrides: {
    disbursement?: Partial<DisbursementState>;
    sanction?: Partial<SanctionState>;
    accountStatus?: 'ACTIVE' | 'INACTIVE';
    application?: Partial<ApplicationWithRelations>;
    replay?: DisbursementState | null;
    ledgerThrows?: Error;
  } = {},
): Harness {
  const state = {
    disbursement: buildDisbursement(overrides.disbursement),
    sanction: {
      sanctionedAmountPaise: SANCTIONED,
      customerResponse: 'ACCEPTED' as const,
      agreementSignedAt: new Date('2026-08-08T00:00:00.000Z'),
      ...overrides.sanction,
    },
    accountStatus: overrides.accountStatus ?? ('ACTIVE' as const),
    loan: {
      status: 'DISBURSEMENT_PENDING',
      disbursementDate: null as Date | null,
    },
    replay: overrides.replay ?? null,
    emis: [] as { installmentNumber: number; totalDuePaise: bigint }[],
    schedules: 0,
  };

  const application = buildApplication(overrides.application);

  const withRelations = (row: DisbursementState) => ({ ...row, ...RELATIONS });

  const disbursementDelegate = {
    findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      // The replay lookup filters on idempotencyKey + COMPLETED.
      if (where.idempotencyKey !== undefined) {
        return Promise.resolve(
          state.replay && state.replay.idempotencyKey === where.idempotencyKey
            ? withRelations(state.replay)
            : null,
        );
      }
      if (
        where.disbursementId !== undefined &&
        where.disbursementId !== state.disbursement.disbursementId
      ) {
        return Promise.resolve(null);
      }
      if (
        where.branchId !== undefined &&
        where.branchId !== state.disbursement.branchId
      ) {
        return Promise.resolve(null);
      }
      return Promise.resolve(withRelations(state.disbursement));
    }),
    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const row = state.disbursement;

        // Modelled faithfully: every key in the WHERE is compared against live
        // state, so a guard missing `status` or `updatedAt` returns 1 here.
        if (where.orgId !== undefined && where.orgId !== row.orgId) {
          return Promise.resolve({ count: 0 });
        }
        if (
          where.disbursementId !== undefined &&
          where.disbursementId !== row.disbursementId
        ) {
          return Promise.resolve({ count: 0 });
        }
        if (where.status !== undefined) {
          const expected = where.status as string | { in: string[] };
          const matches =
            typeof expected === 'string'
              ? expected === row.status
              : expected.in.includes(row.status);
          if (!matches) return Promise.resolve({ count: 0 });
        }
        if (
          where.updatedAt !== undefined &&
          (where.updatedAt as Date).getTime() !== row.updatedAt.getTime()
        ) {
          return Promise.resolve({ count: 0 });
        }

        Object.assign(row, data);
        row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
        return Promise.resolve({ count: 1 });
      },
    ),
    update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      Object.assign(state.disbursement, data);
      return Promise.resolve(state.disbursement);
    }),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      Object.assign(state.disbursement, data);
      return Promise.resolve(state.disbursement);
    }),
  };

  const prisma = {
    disbursement: disbursementDelegate,
    sanctionLetter: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          ...state.sanction,
          issuedAt: new Date('2026-08-06T00:00:00.000Z'),
          interestType: 'REDUCING',
          interestRateBps: 1200n,
          repaymentFrequency: 'MONTHLY',
          durationCount: 12,
        }),
      ),
    },
    account: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          accountId: ACCOUNT_ID,
          accountName: 'Bank Account',
          status: state.accountStatus,
        }),
      ),
    },
    loan: {
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.loan, data);
        return Promise.resolve(state.loan);
      }),
      create: jest.fn(() => Promise.resolve({ loanId: LOAN_ID })),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    loanApplication: {
      updateMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        if (where.status !== undefined && where.status !== application.status) {
          return Promise.resolve({ count: 0 });
        }
        if (
          where.updatedAt !== undefined &&
          (where.updatedAt as Date).getTime() !==
            application.updatedAt.getTime()
        ) {
          return Promise.resolve({ count: 0 });
        }
        return Promise.resolve({ count: 1 });
      }),
    },
    loanApplicationReview: { create: jest.fn(() => Promise.resolve({})) },
    repaymentSchedule: {
      create: jest.fn(() => {
        state.schedules += 1;
        return Promise.resolve({ repaymentScheduleId: 'schedule-1' });
      }),
    },
    emi: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        state.emis.push({
          installmentNumber: data.installmentNumber as number,
          totalDuePaise: data.totalDuePaise as bigint,
        });
        return Promise.resolve({});
      }),
    },
    auditLog: { create: jest.fn(() => Promise.resolve({})) },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    ),
  } as unknown as PrismaService & Record<string, unknown>;

  const audit = { record: jest.fn(() => Promise.resolve()) };

  const applications = {
    findInScope: jest.fn(() => Promise.resolve(application)),
    getById: jest.fn(() => Promise.resolve({})),
  } as unknown as LoanApplicationService;

  const ledgerPost = jest.fn(() => {
    if (overrides.ledgerThrows) throw overrides.ledgerThrows;
    return Promise.resolve('journal-entry-1');
  });

  const ledger = {
    postDisbursement: ledgerPost,
    getEntry: jest.fn(() => Promise.resolve(null)),
  } as unknown as LedgerService;

  const loans = {
    nextLoanNumber: jest.fn(() => Promise.resolve('LN-000001')),
  } as unknown as LoanService;

  const transitions = new ApplicationTransitionService(
    prisma,
    audit as unknown as AuditService,
  );

  const events = notificationEventsStub();

  const service = new DisbursementService(
    prisma,
    audit as unknown as AuditService,
    applications,
    transitions,
    ledger,
    loans,
    events.service,
  );

  return { service, state, ledgerPost, audit };
}

describe('DisbursementService.recordTransfer', () => {
  /**
   * Rule 6 / Scenario 6 — the assertion this whole module turns on. The DTO
   * carries an amount, so "just use what the client sent" is a one-line change
   * that nothing else would catch.
   */
  it('refuses an amount that does not match the sanctioned figure', async () => {
    const { service, state } = buildHarness();

    await expect(
      service.recordTransfer(
        actor(),
        DISBURSEMENT_ID,
        {
          paymentMode: 'BANK_TRANSFER',
          amountPaise: '9999999',
          transactionReference: 'TXN-1',
          transferDate: '2026-08-21',
          expectedVersion: VERSION,
        },
        META,
      ),
    ).rejects.toThrow(/must match the approved amount/);

    expect(state.disbursement.status).toBe('SCHEDULED');
    expect(state.disbursement.transactionReference).toBeNull();
  });

  it('records a matching bank transfer and moves to PROCESSING', async () => {
    const { service, state } = buildHarness();

    await service.recordTransfer(
      actor(),
      DISBURSEMENT_ID,
      {
        paymentMode: 'BANK_TRANSFER',
        amountPaise: SANCTIONED.toString(),
        transactionReference: 'TXN-123',
        transferDate: '2026-08-21',
        expectedVersion: VERSION,
      },
      META,
    );

    expect(state.disbursement.status).toBe('PROCESSING');
    expect(state.disbursement.transactionReference).toBe('TXN-123');
  });

  /**
   * Rule 11 / Scenario 16 — and the bug this test was written to close.
   *
   * The shared zod schema carries this rule, but the API validates with
   * class-validator DTOs, not zod, and the DTO field is deliberately optional
   * because cash has no reference. That left the rule enforced on the web side
   * only: an end-to-end run against the real API accepted a referenceless bank
   * transfer with a 201. The check now lives in the service, where neither
   * validation layer can be bypassed.
   *
   * It is emphatically NOT a `@ValidateIf` on the DTO field — that decorator
   * skips `@IsNotEmpty` and would silently accept the missing value again.
   */
  it('refuses a bank transfer with no transaction reference', async () => {
    const { service, state } = buildHarness();

    await expect(
      service.recordTransfer(
        actor(),
        DISBURSEMENT_ID,
        {
          paymentMode: 'BANK_TRANSFER',
          amountPaise: SANCTIONED.toString(),
          transferDate: '2026-08-21',
          expectedVersion: VERSION,
        },
        META,
      ),
    ).rejects.toThrow(/transaction reference is required/i);

    expect(state.disbursement.status).toBe('SCHEDULED');
  });

  it('refuses a bank transfer whose reference is only whitespace', async () => {
    const { service } = buildHarness();

    await expect(
      service.recordTransfer(
        actor(),
        DISBURSEMENT_ID,
        {
          paymentMode: 'BANK_TRANSFER',
          amountPaise: SANCTIONED.toString(),
          transactionReference: '   ',
          transferDate: '2026-08-21',
          expectedVersion: VERSION,
        },
        META,
      ),
    ).rejects.toThrow(/transaction reference is required/i);
  });

  it('refuses a UPI transfer with no reference, since UPI settles via a bank', async () => {
    const { service } = buildHarness();

    await expect(
      service.recordTransfer(
        actor(),
        DISBURSEMENT_ID,
        {
          paymentMode: 'UPI',
          amountPaise: SANCTIONED.toString(),
          transferDate: '2026-08-21',
          expectedVersion: VERSION,
        },
        META,
      ),
    ).rejects.toThrow(/transaction reference is required/i);
  });

  /** Scenario 15: cash carries no reference and must still be accepted. */
  it('records a cash transfer with no reference', async () => {
    const { service, state } = buildHarness();

    await service.recordTransfer(
      actor(),
      DISBURSEMENT_ID,
      {
        paymentMode: 'CASH',
        amountPaise: SANCTIONED.toString(),
        transferDate: '2026-08-21',
        expectedVersion: VERSION,
      },
      META,
    );

    expect(state.disbursement.status).toBe('PROCESSING');
    expect(state.disbursement.paymentMode).toBe('CASH');
  });

  /** Scenario 12: the status guard is what blocks an edit after transfer. */
  it('refuses a second transfer once one has been recorded', async () => {
    const { service } = buildHarness({
      disbursement: { status: 'PROCESSING' },
    });

    await expect(
      service.recordTransfer(
        actor(),
        DISBURSEMENT_ID,
        {
          paymentMode: 'BANK_TRANSFER',
          amountPaise: SANCTIONED.toString(),
          transactionReference: 'TXN-2',
          transferDate: '2026-08-21',
          expectedVersion: VERSION,
        },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  /**
   * Scenario 17 — and the second bug an e2e run caught.
   *
   * A duplicate reference reaches the service as a P2002 whose `meta.target`
   * is not populated on this stack (Prisma 7 + `@prisma/adapter-pg`). The
   * original predicate read only `meta.target`, so the error escaped
   * untranslated and the global filter rendered it as a 503 saying
   * "Authentication service is temporarily unavailable" — alarming, and about
   * the wrong subsystem entirely.
   *
   * The error shape below is copied from a real one off the wire, `meta`
   * omitted exactly as it arrived.
   */
  it('translates a duplicate reference into a conflict, not a 503', async () => {
    const { service } = buildHarness();

    const p2002 = Object.assign(
      new Error(
        'Unique constraint failed on the fields: (`org_id`, `transaction_reference`)',
      ),
      // No `meta` — that omission is the whole point of this test.
      { code: 'P2002' },
    );

    const prisma = (
      service as unknown as {
        prisma: { disbursement: { updateMany: jest.Mock } };
      }
    ).prisma;

    prisma.disbursement.updateMany = jest.fn(() => Promise.reject(p2002));

    await expect(
      service.recordTransfer(
        actor(),
        DISBURSEMENT_ID,
        {
          paymentMode: 'BANK_TRANSFER',
          amountPaise: SANCTIONED.toString(),
          transactionReference: 'TXN-DUPLICATE',
          transferDate: '2026-08-21',
          expectedVersion: VERSION,
        },
        META,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses a stale version', async () => {
    const { service, state } = buildHarness();

    await expect(
      service.recordTransfer(
        actor(),
        DISBURSEMENT_ID,
        {
          paymentMode: 'CASH',
          amountPaise: SANCTIONED.toString(),
          transferDate: '2026-08-21',
          expectedVersion: STALE_VERSION,
        },
        META,
      ),
    ).rejects.toThrow(ConflictException);

    expect(state.disbursement.status).toBe('SCHEDULED');
  });
});

describe('DisbursementService.confirm', () => {
  const confirmDto = {
    idempotencyKey: IDEMPOTENCY_KEY,
    expectedVersion: VERSION,
  };

  const ready = { disbursement: { status: 'PROCESSING' as const } };

  // Scenarios 19, 23, 24.
  it('posts the ledger, activates the loan and generates the schedule', async () => {
    const { service, state, ledgerPost } = buildHarness(ready);

    await service.confirm(actor(), DISBURSEMENT_ID, confirmDto, META);

    expect(ledgerPost).toHaveBeenCalledTimes(1);
    expect(state.disbursement.status).toBe('COMPLETED');
    expect(state.disbursement.journalEntryId).toBe('journal-entry-1');
    expect(state.loan.status).toBe('ACTIVE');
    expect(state.schedules).toBe(1);
    expect(state.emis).toHaveLength(12);
  });

  /** Scenario 24: the persisted rows must be the real schedule, not a stub. */
  it('generates one EMI row per installment, numbered from one', async () => {
    const { service, state } = buildHarness(ready);

    await service.confirm(actor(), DISBURSEMENT_ID, confirmDto, META);

    expect(state.emis.map((e) => e.installmentNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    // The residue lands on the final installment, so the total is exact rather
    // than twelve equal roundings that drift from the payable figure.
    const total = state.emis.reduce((sum, e) => sum + e.totalDuePaise, 0n);
    expect(total).toBeGreaterThan(SANCTIONED);
  });

  /**
   * Rules 14, 17 / Scenario 20 — the reason the ledger and the activation share
   * one `inTransaction`. Catching the ledger throw to "handle it gracefully"
   * would leave a loan ACTIVE with no financial record.
   */
  it('does not activate the loan when the ledger posting fails', async () => {
    const { service, state } = buildHarness({
      ...ready,
      ledgerThrows: new ConflictException('ledger down'),
    });

    await expect(
      service.confirm(actor(), DISBURSEMENT_ID, confirmDto, META),
    ).rejects.toThrow(ConflictException);

    expect(state.loan.status).toBe('DISBURSEMENT_PENDING');
    expect(state.loan.disbursementDate).toBeNull();
    expect(state.schedules).toBe(0);
    expect(state.emis).toHaveLength(0);
  });

  it('audits a ledger failure outside the rolled-back transaction', async () => {
    const { service, audit } = buildHarness({
      ...ready,
      ledgerThrows: new ConflictException('ledger down'),
    });

    await expect(
      service.confirm(actor(), DISBURSEMENT_ID, confirmDto, META),
    ).rejects.toThrow();

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.DISBURSEMENT_LEDGER_FAILED,
      }),
    );
  });

  /**
   * Scenarios 28, 46 — and the ordering trap. The replayed request carries the
   * version from *before* the successful commit, so checking the version first
   * would turn a successful retry into a 409.
   */
  it('replays a completed disbursement for a repeated idempotency key', async () => {
    const replay = buildDisbursement({
      status: 'COMPLETED',
      idempotencyKey: IDEMPOTENCY_KEY,
      journalEntryId: 'journal-entry-1',
      updatedAt: new Date('2026-08-21T13:00:00.000Z'),
    });

    const { service, ledgerPost, audit } = buildHarness({
      ...ready,
      replay,
    });

    const result = await service.confirm(
      actor(),
      DISBURSEMENT_ID,
      // Deliberately the pre-commit version a timed-out client still holds.
      { idempotencyKey: IDEMPOTENCY_KEY, expectedVersion: STALE_VERSION },
      META,
    );

    expect(result.status).toBe('COMPLETED');
    expect(ledgerPost).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.DISBURSEMENT_DUPLICATE_IGNORED,
      }),
    );
  });

  /**
   * Scenario 44. The `status: 'PROCESSING'` + version guard is what makes the
   * database arbitrate; the second caller sees a row already COMPLETED.
   */
  it('lets only one of two concurrent confirmations commit', async () => {
    const { service, state, ledgerPost } = buildHarness(ready);

    await service.confirm(actor(), DISBURSEMENT_ID, confirmDto, META);

    await expect(
      service.confirm(
        actor(),
        DISBURSEMENT_ID,
        {
          idempotencyKey: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          expectedVersion: VERSION,
        },
        META,
      ),
    ).rejects.toThrow(ConflictException);

    expect(ledgerPost).toHaveBeenCalledTimes(1);
    expect(state.disbursement.status).toBe('COMPLETED');
  });

  // Scenario 8 / 41: revalidated against the database, not the client.
  it('refuses when the agreement is not signed', async () => {
    const { service, state, ledgerPost } = buildHarness({
      ...ready,
      sanction: { agreementSignedAt: null },
    });

    await expect(
      service.confirm(actor(), DISBURSEMENT_ID, confirmDto, META),
    ).rejects.toThrow(ConflictException);

    expect(ledgerPost).not.toHaveBeenCalled();
    expect(state.loan.status).toBe('DISBURSEMENT_PENDING');
  });

  // Scenario 10.
  it('refuses when the customer declined the sanction', async () => {
    const { service, ledgerPost } = buildHarness({
      ...ready,
      sanction: { customerResponse: 'DECLINED' },
    });

    await expect(
      service.confirm(actor(), DISBURSEMENT_ID, confirmDto, META),
    ).rejects.toThrow(ConflictException);

    expect(ledgerPost).not.toHaveBeenCalled();
  });

  /**
   * Scenario 36 — the account was active when the disbursement was scheduled
   * and is not at confirm. Only the second gate run catches this.
   */
  it('refuses an account deactivated after scheduling', async () => {
    const { service, ledgerPost } = buildHarness({
      ...ready,
      accountStatus: 'INACTIVE',
    });

    await expect(
      service.confirm(actor(), DISBURSEMENT_ID, confirmDto, META),
    ).rejects.toThrow(ConflictException);

    expect(ledgerPost).not.toHaveBeenCalled();
  });

  // Scenario 42: the authoritative amount changed under the client.
  it('refuses when the sanctioned amount no longer matches', async () => {
    const { service, ledgerPost } = buildHarness({
      ...ready,
      sanction: { sanctionedAmountPaise: 20_000_000n },
    });

    await expect(
      service.confirm(actor(), DISBURSEMENT_ID, confirmDto, META),
    ).rejects.toThrow(ConflictException);

    expect(ledgerPost).not.toHaveBeenCalled();
  });

  /** Scenario 23: confirming without a recorded transfer is not a disbursal. */
  it('refuses when no transfer has been recorded', async () => {
    const { service, ledgerPost } = buildHarness({
      disbursement: { status: 'SCHEDULED' },
    });

    await expect(
      service.confirm(actor(), DISBURSEMENT_ID, confirmDto, META),
    ).rejects.toThrow(ConflictException);

    expect(ledgerPost).not.toHaveBeenCalled();
  });
});

describe('DisbursementService.markFailed', () => {
  /**
   * Rule 16 / Scenario 26. The loan must not be disbursed, and the reference is
   * released so a retry is not refused as a duplicate of a transfer that never
   * happened.
   */
  it('returns to SCHEDULED and releases the transaction reference', async () => {
    const { service, state } = buildHarness({
      disbursement: {
        status: 'PROCESSING',
        transactionReference: 'TXN-FAILED',
        transferDate: new Date('2026-08-21T12:00:00+05:30'),
      },
    });

    await service.markFailed(
      actor(),
      DISBURSEMENT_ID,
      { failureReason: 'Bank rejected the transfer', expectedVersion: VERSION },
      META,
    );

    expect(state.disbursement.status).toBe('SCHEDULED');
    expect(state.disbursement.transactionReference).toBeNull();
    expect(state.disbursement.failureReason).toBe('Bank rejected the transfer');
    expect(state.loan.status).toBe('DISBURSEMENT_PENDING');
  });

  it('refuses to fail a completed disbursement', async () => {
    const { service } = buildHarness({
      disbursement: { status: 'COMPLETED' },
    });

    await expect(
      service.markFailed(
        actor(),
        DISBURSEMENT_ID,
        { failureReason: 'too late', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(/already completed/);
  });
});

describe('DisbursementService.cancel', () => {
  /** Rules 30, 31 / Scenario 38 — a completed disbursement is never removed. */
  it('refuses to cancel a completed disbursement', async () => {
    const { service } = buildHarness({
      disbursement: { status: 'COMPLETED' },
    });

    await expect(
      service.cancel(
        actor(),
        DISBURSEMENT_ID,
        { cancellationReason: 'mistake', expectedVersion: VERSION },
        META,
      ),
    ).rejects.toThrow(/requires a reversal/);
  });

  it('cancels a scheduled disbursement without deleting it', async () => {
    const { service, state } = buildHarness();

    await service.cancel(
      actor(),
      DISBURSEMENT_ID,
      { cancellationReason: 'wrong account', expectedVersion: VERSION },
      META,
    );

    expect(state.disbursement.status).toBe('CANCELLED');
    expect(state.disbursement.failureReason).toBe('wrong account');
    // The row survives; only its status changed.
    expect(state.disbursement.disbursementId).toBe(DISBURSEMENT_ID);
  });
});

describe('DisbursementService.findInScope', () => {
  /**
   * Scenarios 3, 4 — a 403 would confirm the id exists, which is the disclosure
   * these scenarios are about.
   */
  it('returns 404 rather than 403 for an out-of-branch disbursement', async () => {
    const { service, audit } = buildHarness();

    await expect(
      service.findInScope(
        actor({ branchId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
        DISBURSEMENT_ID,
        META,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.DISBURSEMENT_SCOPE_DENIED,
      }),
    );
  });

  it('reaches a disbursement in the caller branch', async () => {
    const { service } = buildHarness();

    const row = await service.findInScope(
      actor({ branchId: BRANCH_ID }),
      DISBURSEMENT_ID,
      META,
    );

    expect(row.disbursementId).toBe(DISBURSEMENT_ID);
  });
});

describe('DisbursementService.disbursalReadiness', () => {
  it('reports confirmable when every gate passes', async () => {
    const { service } = buildHarness({
      disbursement: { status: 'PROCESSING' },
    });

    const readiness = await service.disbursalReadiness(
      actor(),
      DISBURSEMENT_ID,
      META,
    );

    expect(readiness.confirmable).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
  });

  it('names the agreement as a blocker when it is unsigned', async () => {
    const { service } = buildHarness({
      disbursement: { status: 'PROCESSING' },
      sanction: { agreementSignedAt: null },
    });

    const readiness = await service.disbursalReadiness(
      actor(),
      DISBURSEMENT_ID,
      META,
    );

    expect(readiness.confirmable).toBe(false);
    expect(readiness.blockers.map((b) => b.key)).toContain(
      'NOT_AGREEMENT_SIGNED',
    );
  });

  it('reports an already-disbursed loan as blocked', async () => {
    const { service } = buildHarness({
      disbursement: { status: 'COMPLETED' },
    });

    const readiness = await service.disbursalReadiness(
      actor(),
      DISBURSEMENT_ID,
      META,
    );

    expect(readiness.blockers.map((b) => b.key)).toContain('ALREADY_DISBURSED');
  });
});
