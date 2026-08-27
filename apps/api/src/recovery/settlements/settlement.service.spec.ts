/**
 * Load-bearing properties of settlements, notices and write-off.
 *
 * Each is something a plausible refactor breaks silently:
 *
 *  1. **The ledger posting is `Dr 5100 / Cr 1100` for the *principal* only.**
 *     `1100` holds principal alone — interest was never raised as a receivable
 *     — so crediting it for the whole overdue figure would drive the control
 *     account below the loan book. The write-off deliberately does **not**
 *     reverse interest already recognised as income.
 *  2. **Approving posts nothing; completing posts.** Until the borrower has
 *     paid the settled portion nothing has been forgiven, so the entry belongs
 *     to completion.
 *  3. **The waived amount is derived, never accepted.** The three figures
 *     always satisfy `settlements_waiver_sums`, so a form cannot construct a
 *     settlement whose halves do not add up.
 *  4. **The journal is written before the domain row is updated.** Append-only
 *     triggers freeze a row on insert, so `journalEntryId` cannot be
 *     back-filled — the ordering `CollectionService` documents.
 *  5. **A posting failure is audited outside the transaction**, so the failure
 *     record survives the rollback (Scenario 50).
 *  6. **A zero waiver posts no entry.** An entry that moves nothing is not a
 *     fact.
 *  7. **Approve and propose are separate authorities**, enforced by separate
 *     permissions on separate routes (Scenario 44).
 */

import { ConflictException } from '@nestjs/common';

import { AuditAction, type AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LedgerService } from '../../loans/disbursal/ledger.service';
import type { RecoveryCaseService } from '../cases/recovery-case.service';
import { SettlementService } from './settlement.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const BRANCH = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
const LOAN = '44444444-4444-4444-4444-444444444444';
const CASE = '55555555-5555-5555-5555-555555555555';
const SETTLEMENT = '66666666-6666-6666-6666-666666666666';
const KEY = '77777777-7777-4777-8777-777777777777';

const VERSION = new Date('2026-08-24T10:00:00.000Z');

const META: RequestMeta = {
  requestId: 'req-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER,
    orgId: ORG,
    orgCode: 'DEMO',
    sessionId: 'session-1',
    branchId: BRANCH,
    roles: ['BRANCH_ADMIN'],
    permissions: [
      'recovery.settlements.propose',
      'recovery.settlements.approve',
      'recovery.notices.issue',
      'recovery.cases.assign',
    ],
    ...overrides,
  };
}

function settlementRow(overrides: Record<string, unknown> = {}) {
  return {
    settlementId: SETTLEMENT,
    recoveryCaseId: CASE,
    loanId: LOAN,
    settlementAmountPaise: 600000n,
    outstandingBeforePaise: 1000000n,
    waivedAmountPaise: 400000n,
    status: 'APPROVED',
    agreedDate: new Date('2026-08-20T00:00:00Z'),
    completedDate: null,
    approvedBy: USER,
    approvedAt: VERSION,
    approvalReference: null,
    reason: 'Hardship',
    journalEntryId: null,
    createdBy: USER,
    createdAt: VERSION,
    updatedAt: VERSION,
    approvedByUser: { name: 'Approver' },
    ...overrides,
  };
}

/**
 * Two installments: ₹9,000 principal + ₹1,000 interest each, nothing paid.
 * Principal outstanding is therefore ₹18,000 = 1_800_000 paise.
 */
function schedule() {
  return {
    status: 'ACTIVE',
    emis: [
      {
        principalDuePaise: 900000n,
        interestDuePaise: 100000n,
        paidAmountPaise: 0n,
      },
      {
        principalDuePaise: 900000n,
        interestDuePaise: 100000n,
        paidAmountPaise: 0n,
      },
    ],
  };
}

type Harness = {
  service: SettlementService;
  postWriteOff: jest.Mock;
  settlementUpdates: Record<string, unknown>[];
  settlementsCreated: Record<string, unknown>[];
  noticesCreated: Record<string, unknown>[];
  loanUpdates: Record<string, unknown>[];
  audited: string[];
  guardCount: { value: number };
  callOrder: string[];
};

function harness(
  options: {
    settlement?: Record<string, unknown> | null;
    caseStatus?: string;
    replay?: Record<string, unknown> | null;
    postWriteOffThrows?: boolean;
  } = {},
): Harness {
  const settlementUpdates: Record<string, unknown>[] = [];
  const settlementsCreated: Record<string, unknown>[] = [];
  const noticesCreated: Record<string, unknown>[] = [];
  const loanUpdates: Record<string, unknown>[] = [];
  const audited: string[] = [];
  const callOrder: string[] = [];
  const guardCount = { value: 1 };

  const postWriteOff = jest.fn().mockImplementation(() => {
    callOrder.push('ledger');
    if (options.postWriteOffThrows) {
      return Promise.reject(new Error('ledger unavailable'));
    }
    return Promise.resolve('journal-entry-1');
  });

  const settlementFindFirst = jest
    .fn()
    .mockResolvedValue(
      options.settlement === undefined ? settlementRow() : options.settlement,
    );

  const tx = {
    settlement: {
      findFirst: settlementFindFirst,
      findFirstOrThrow: jest.fn().mockResolvedValue(settlementRow()),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          settlementsCreated.push(data);
          return Promise.resolve({ ...settlementRow(), ...data });
        }),
      updateMany: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          callOrder.push('settlement-update');
          settlementUpdates.push(data);
          return Promise.resolve({ count: guardCount.value });
        }),
    },
    legalNotice: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          noticesCreated.push(data);
          return Promise.resolve({
            ...data,
            legalNoticeId: 'notice-1',
            createdAt: new Date(),
            issuedByUser: { name: 'Issuer' },
          });
        }),
    },
    recoveryCase: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    recoveryAction: { create: jest.fn().mockResolvedValue({}) },
    loan: {
      findFirstOrThrow: jest.fn().mockResolvedValue({
        loanNumber: 'LN-000001',
        branchId: BRANCH,
        customerId: 'cust-1',
      }),
      updateMany: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          loanUpdates.push(data);
          return Promise.resolve({ count: 1 });
        }),
    },
    repaymentSchedule: { findFirst: jest.fn().mockResolvedValue(schedule()) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  } as unknown as PrismaService;

  const audit = {
    record: jest.fn((input: { action: string }) => {
      audited.push(input.action);
      return Promise.resolve();
    }),
  } as unknown as AuditService;

  const ledger = { postWriteOff } as unknown as LedgerService;

  const cases = {
    findInScope: jest.fn().mockResolvedValue({
      recoveryCaseId: CASE,
      loanId: LOAN,
      status: options.caseStatus ?? 'SETTLEMENT_PENDING',
      updatedAt: VERSION,
    }),
  } as unknown as RecoveryCaseService;

  return {
    service: new SettlementService(prisma, audit, ledger, cases),
    postWriteOff,
    settlementUpdates,
    settlementsCreated,
    noticesCreated,
    loanUpdates,
    audited,
    guardCount,
    callOrder,
  };
}

describe('SettlementService.propose', () => {
  /** Property 3: the waiver is derived so the three figures always reconcile. */
  it('derives the waived amount from the outstanding principal', async () => {
    const h = harness({ settlement: null });

    await h.service.propose(
      actor(),
      CASE,
      {
        settlementAmountPaise: '1000000',
        agreedDate: '2026-08-20',
        reason: 'Hardship',
        idempotencyKey: KEY,
      },
      META,
    );

    const created = h.settlementsCreated[0];
    // Principal outstanding is 1_800_000; settling 1_000_000 waives 800_000.
    expect(created.outstandingBeforePaise).toBe(1800000n);
    expect(created.settlementAmountPaise).toBe(1000000n);
    expect(created.waivedAmountPaise).toBe(800000n);
    expect(created.outstandingBeforePaise).toBe(
      (created.settlementAmountPaise as bigint) +
        (created.waivedAmountPaise as bigint),
    );
  });

  it('refuses a settlement larger than what is owed', async () => {
    const h = harness({ settlement: null });

    await expect(
      h.service.propose(
        actor(),
        CASE,
        {
          settlementAmountPaise: '99999999',
          agreedDate: '2026-08-20',
          reason: 'Hardship',
          idempotencyKey: KEY,
        },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.settlementsCreated).toHaveLength(0);
  });

  /** Property 2: proposing posts nothing. */
  it('posts no ledger entry when proposing', async () => {
    const h = harness({ settlement: null });

    await h.service.propose(
      actor(),
      CASE,
      {
        settlementAmountPaise: '1000000',
        agreedDate: '2026-08-20',
        reason: 'Hardship',
        idempotencyKey: KEY,
      },
      META,
    );

    expect(h.postWriteOff).not.toHaveBeenCalled();
    expect(h.audited).toContain(AuditAction.SETTLEMENT_PROPOSED);
  });

  it('refuses to propose against a closed case', async () => {
    const h = harness({ settlement: null, caseStatus: 'CLOSED' });

    await expect(
      h.service.propose(
        actor(),
        CASE,
        {
          settlementAmountPaise: '1000000',
          agreedDate: '2026-08-20',
          reason: 'Hardship',
          idempotencyKey: KEY,
        },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SettlementService.decide', () => {
  /** Property 2, other half. */
  it('posts no ledger entry when approving', async () => {
    const h = harness({
      settlement: settlementRow({ status: 'PENDING_APPROVAL' }),
    });

    await h.service.decide(
      actor(),
      SETTLEMENT,
      { decision: 'APPROVE', expectedVersion: VERSION.toISOString() },
      META,
    );

    expect(h.postWriteOff).not.toHaveBeenCalled();
    expect(h.audited).toContain(AuditAction.SETTLEMENT_APPROVED);
  });

  /**
   * `settlements_approval_paired` is evaluated per statement, so the approver
   * and the timestamp must be written together.
   */
  it('writes the approver and the timestamp in one statement', async () => {
    const h = harness({
      settlement: settlementRow({ status: 'PENDING_APPROVAL' }),
    });

    await h.service.decide(
      actor(),
      SETTLEMENT,
      { decision: 'APPROVE', expectedVersion: VERSION.toISOString() },
      META,
    );

    const update = h.settlementUpdates[0];
    expect(update.approvedBy).toBe(USER);
    expect(update.approvedAt).toBeInstanceOf(Date);
  });

  it('records a rejection without an approver', async () => {
    const h = harness({
      settlement: settlementRow({ status: 'PENDING_APPROVAL' }),
    });

    await h.service.decide(
      actor(),
      SETTLEMENT,
      {
        decision: 'REJECT',
        reason: 'Terms unacceptable',
        expectedVersion: VERSION.toISOString(),
      },
      META,
    );

    const update = h.settlementUpdates[0];
    expect(update.status).toBe('REJECTED');
    expect(update.approvedBy).toBeUndefined();
    expect(h.audited).toContain(AuditAction.SETTLEMENT_REJECTED);
  });

  it('refuses to decide a settlement that is not awaiting approval', async () => {
    const h = harness({ settlement: settlementRow({ status: 'COMPLETED' }) });

    await expect(
      h.service.decide(
        actor(),
        SETTLEMENT,
        { decision: 'APPROVE', expectedVersion: VERSION.toISOString() },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a stale version', async () => {
    const h = harness({
      settlement: settlementRow({ status: 'PENDING_APPROVAL' }),
    });

    await expect(
      h.service.decide(
        actor(),
        SETTLEMENT,
        { decision: 'APPROVE', expectedVersion: '2020-01-01T00:00:00.000Z' },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.audited).toContain(
      AuditAction.SETTLEMENT_CONCURRENT_ATTEMPT_REJECTED,
    );
  });
});

describe('SettlementService.complete', () => {
  /** Property 1: principal only, and the right two accounts. */
  it('posts the waived principal to the ledger', async () => {
    const h = harness();

    await h.service.complete(
      actor(),
      SETTLEMENT,
      { decision: 'APPROVE', expectedVersion: VERSION.toISOString() },
      META,
    );

    expect(h.postWriteOff).toHaveBeenCalledTimes(1);
    const input = writeOffInput(h.postWriteOff);
    expect(input.principalPaise).toBe(400000n);
    expect(input.sourceType).toBe('SETTLEMENT');
    expect(input.sourceId).toBe(SETTLEMENT);
  });

  /** Property 4: the ledger entry exists before the row that points at it. */
  it('posts the journal before updating the settlement', async () => {
    const h = harness();

    await h.service.complete(
      actor(),
      SETTLEMENT,
      { decision: 'APPROVE', expectedVersion: VERSION.toISOString() },
      META,
    );

    expect(h.callOrder.indexOf('ledger')).toBeLessThan(
      h.callOrder.indexOf('settlement-update'),
    );
    expect(h.settlementUpdates[0]?.journalEntryId).toBe('journal-entry-1');
  });

  /** Property 6. */
  it('posts nothing when the settlement forgives nothing', async () => {
    const h = harness({
      settlement: settlementRow({
        waivedAmountPaise: 0n,
        settlementAmountPaise: 1000000n,
        outstandingBeforePaise: 1000000n,
      }),
    });

    await h.service.complete(
      actor(),
      SETTLEMENT,
      { decision: 'APPROVE', expectedVersion: VERSION.toISOString() },
      META,
    );

    expect(h.postWriteOff).not.toHaveBeenCalled();
    expect(h.settlementUpdates[0]?.status).toBe('COMPLETED');
  });

  /** Property 5, Scenario 50. */
  it('audits a posting failure and does not mark the settlement complete', async () => {
    const h = harness({ postWriteOffThrows: true });

    await expect(
      h.service.complete(
        actor(),
        SETTLEMENT,
        { decision: 'APPROVE', expectedVersion: VERSION.toISOString() },
        META,
      ),
    ).rejects.toThrow('ledger unavailable');

    expect(h.settlementUpdates).toHaveLength(0);
    expect(h.audited).toContain(AuditAction.SETTLEMENT_POSTING_FAILED);
  });

  it('refuses to complete a settlement that is not approved', async () => {
    const h = harness({
      settlement: settlementRow({ status: 'PENDING_APPROVAL' }),
    });

    await expect(
      h.service.complete(
        actor(),
        SETTLEMENT,
        { decision: 'APPROVE', expectedVersion: VERSION.toISOString() },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.postWriteOff).not.toHaveBeenCalled();
  });
});

describe('SettlementService.writeOff', () => {
  const dto = {
    reason: 'Borrower untraceable for 18 months',
    idempotencyKey: KEY,
    expectedVersion: VERSION.toISOString(),
  };

  it('posts the whole outstanding principal and moves the loan', async () => {
    const h = harness();

    await h.service.writeOff(actor(), CASE, dto, META);

    const input = writeOffInput(h.postWriteOff);
    expect(input.principalPaise).toBe(1800000n);
    expect(input.sourceType).toBe('LOAN_WRITE_OFF');
    expect(h.loanUpdates[0]?.status).toBe('WRITTEN_OFF');
    expect(h.audited).toContain(AuditAction.LOAN_WRITTEN_OFF);
    expect(h.audited).toContain(AuditAction.LOAN_WRITE_OFF_LEDGER_POSTED);
  });

  /**
   * Rule 28: the history stays readable after a write-off, so the case is
   * closed with a resolution rather than removed.
   */
  it('closes the case as WRITTEN_OFF rather than deleting it', async () => {
    const h = harness();

    await h.service.writeOff(actor(), CASE, dto, META);

    // The case update is the recoveryCase.updateMany call inside the tx.
    const prisma = (h.service as unknown as { prisma: Record<string, never> })
      .prisma as unknown as {
      recoveryCase: { updateMany: jest.Mock };
    };
    const data = firstCallArg<{ data: Record<string, unknown> }>(
      prisma.recoveryCase.updateMany,
    ).data;
    expect(data.status).toBe('CLOSED');
    expect(data.resolutionType).toBe('WRITTEN_OFF');
    expect(data.npaStatus).toBe('LOSS');
  });

  it('audits a failure outside the rolled-back transaction', async () => {
    const h = harness({ postWriteOffThrows: true });

    await expect(h.service.writeOff(actor(), CASE, dto, META)).rejects.toThrow(
      'ledger unavailable',
    );

    expect(h.loanUpdates).toHaveLength(0);
    expect(h.audited).toContain(AuditAction.LOAN_WRITE_OFF_FAILED);
  });

  it('refuses to write off an already-closed case', async () => {
    const h = harness({ caseStatus: 'CLOSED' });

    await expect(
      h.service.writeOff(actor(), CASE, dto, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.postWriteOff).not.toHaveBeenCalled();
  });
});

describe('SettlementService.issueNotice', () => {
  /** The expiry is derived so `legal_notices_expiry_after_notice` cannot fail. */
  it('derives the expiry from the notice date and period', async () => {
    const h = harness();

    await h.service.issueNotice(
      actor(),
      CASE,
      { noticeDate: '2026-08-01', noticePeriodDays: 30 },
      META,
    );

    const created = h.noticesCreated[0];
    const notice = created.noticeDate as Date;
    const expiry = created.expiryDate as Date;
    expect(expiry.getTime()).toBeGreaterThan(notice.getTime());
    expect(Math.round((expiry.getTime() - notice.getTime()) / 86_400_000)).toBe(
      30,
    );
  });

  it('posts no ledger entry — a notice is not a money movement', async () => {
    const h = harness();

    await h.service.issueNotice(
      actor(),
      CASE,
      { noticeDate: '2026-08-01', noticePeriodDays: 30 },
      META,
    );

    expect(h.postWriteOff).not.toHaveBeenCalled();
    expect(h.audited).toContain(AuditAction.LEGAL_NOTICE_ISSUED);
  });

  it('refuses to issue against a closed case', async () => {
    const h = harness({ caseStatus: 'CLOSED' });

    await expect(
      h.service.issueNotice(
        actor(),
        CASE,
        { noticeDate: '2026-08-01', noticePeriodDays: 30 },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

/**
 * The first argument of a mock's first call, typed.
 *
 * `jest.Mock` is `any`-typed, so reading `.mock.calls[0][0]` inline produces an
 * unsafe-member-access complaint at every call site. The same helper
 * `collection.service.spec.ts` uses, for the same reason.
 */
function firstCallArg<T>(mock: jest.Mock): T {
  // Jest types `.mock.calls` as `any[][]` by design, so this is the one place
  // that has to say what the argument actually is.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return mock.mock.calls[0][0] as T;
}

/** `postWriteOff`'s second argument — the ledger input — typed. */
function writeOffInput(mock: jest.Mock): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return mock.mock.calls[0][1] as Record<string, unknown>;
}
