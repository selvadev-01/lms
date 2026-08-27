import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction, type AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LedgerService } from '../disbursal/ledger.service';
import type { LoanService } from '../shared/loan.service';
import { CollectionService } from './collection.service';
import { ReceiptService } from './receipt.service';
import {
  notificationEventsStub,
  type NotificationEventsStub,
} from '../../notifications/testing/notification-events.stub';

/**
 * Module 11 — EMI collection.
 *
 * Six properties here are load-bearing in the sense that a plausible tidy-up
 * would break them silently, and each costs real money if it breaks:
 *
 * 1. **The replay check runs before the eligibility gates.** A client retrying
 *    a payment that already succeeded must get its result back, even if the
 *    loan has since closed. Moving the gates first would refuse a payment that
 *    already happened and tell the caller it failed.
 * 2. **A reused key with a different body is a 409, never a silent second
 *    posting** — and never a replay of the wrong result.
 * 3. **The ledger entry is posted before the collection row.** A POSTED
 *    collection is frozen by `collections_append_only`, so `journalEntryId`
 *    cannot be written back afterwards. Reordering these two statements looks
 *    harmless and makes every posting fail.
 * 4. **The contractual columns are never written.** A part payment moves
 *    `paidAmountPaise`/`outstandingAmountPaise` only; `totalDuePaise` and
 *    friends are what the borrower agreed to.
 * 5. **A failure is audited outside the transaction**, or the one record most
 *    worth keeping vanishes with the rollback it describes.
 * 6. **Overpayment is a 400 that names the maximum**, so the form can tell the
 *    user what to tender rather than just refusing.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const BRANCH_ID = '33333333-3333-3333-3333-333333333333';
const CUSTOMER_ID = '44444444-4444-4444-4444-444444444444';
const LOAN_ID = '55555555-5555-5555-5555-555555555555';
const SCHEDULE_ID = '66666666-6666-6666-6666-666666666666';
const EMI_ID = '77777777-7777-7777-7777-777777777777';
const COLLECTION_ID = '88888888-8888-8888-8888-888888888888';
const IDEMPOTENCY_KEY = '99999999-9999-9999-9999-999999999999';

const META: RequestMeta = {
  requestId: 'req-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: 'sess-1',
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: [],
    ...overrides,
  };
}

function loanRow(overrides: Record<string, unknown> = {}) {
  return {
    loanId: LOAN_ID,
    loanNumber: 'LN-000001',
    branchId: BRANCH_ID,
    customerId: CUSTOMER_ID,
    status: 'ACTIVE',
    branch: { code: 'BR001', status: 'ACTIVE', name: 'Main' },
    customer: { fullName: 'A Borrower', customerCode: 'CUST001' },
    ...overrides,
  };
}

/** One installment owing 100 penalty-free: 200 interest + 800 principal. */
function emiRow(overrides: Record<string, unknown> = {}) {
  return {
    emiId: EMI_ID,
    repaymentScheduleId: SCHEDULE_ID,
    loanId: LOAN_ID,
    installmentNumber: 1,
    dueDate: new Date('2026-08-10T12:00:00+05:30'),
    openingPrincipalPaise: 10_000n,
    principalDuePaise: 800n,
    interestDuePaise: 200n,
    totalDuePaise: 1_000n,
    paidAmountPaise: 0n,
    outstandingAmountPaise: 1_000n,
    status: 'PENDING',
    paidAt: null,
    ...overrides,
  };
}

function collectionRow(overrides: Record<string, unknown> = {}) {
  return {
    collectionId: COLLECTION_ID,
    loanId: LOAN_ID,
    branchId: BRANCH_ID,
    customerId: CUSTOMER_ID,
    collectorUserId: USER_ID,
    collectionDate: new Date('2026-08-22T12:00:00+05:30'),
    collectedAt: new Date('2026-08-22T10:00:00Z'),
    paymentType: 'FULL_PAYMENT',
    paymentMode: 'CASH',
    amountPaise: 1_000n,
    transactionReference: null,
    idempotencyKey: IDEMPOTENCY_KEY,
    requestFingerprint: null,
    status: 'POSTED',
    verificationStatus: 'CONFIRMED',
    receiptNumber: 'RCP-BR001-000001',
    penaltyPaidPaise: 0n,
    interestPaidPaise: 200n,
    principalPaidPaise: 800n,
    feesPaidPaise: 0n,
    unallocatedAmountPaise: 0n,
    journalEntryId: 'je-1',
    postedAt: new Date('2026-08-22T10:00:00Z'),
    postedBy: USER_ID,
    reversalOfCollectionId: null,
    reversalReason: null,
    reversedAt: null,
    reversedBy: null,
    offlineCollected: false,
    offlineTransactionUuid: null,
    deviceId: null,
    syncedAt: null,
    failureReason: null,
    createdAt: new Date('2026-08-22T10:00:00Z'),
    updatedAt: new Date('2026-08-22T10:00:00Z'),
    loan: { loanNumber: 'LN-000001' },
    customer: { fullName: 'A Borrower' },
    collectorUser: { name: 'A Collector' },
    allocations: [],
    reversedByCollection: null,
    ...overrides,
  };
}

/** Sums the outstanding column across a set of installment rows. */
function totalOutstandingOf(rows: Record<string, unknown>[]): bigint {
  let total = 0n;
  for (const row of rows) total += row.outstandingAmountPaise as bigint;
  return total;
}

interface Harness {
  service: CollectionService;
  /** Module 16 — what the service raised after each committed transaction. */
  events: NotificationEventsStub;
  audit: { record: jest.Mock };
  ledger: {
    postCollection: jest.Mock;
    postCollectionReversal: jest.Mock;
    getEntry: jest.Mock;
  };
  loans: { findInScope: jest.Mock };
  created: Record<string, unknown>[];
  emiUpdates: Record<string, unknown>[];
  receipts: Record<string, unknown>[];
  allocationsWritten: Record<string, unknown>[][];
  collectionFindFirst: jest.Mock;
  txCollectionCreate: jest.Mock;
}

/**
 * A stand-in Prisma that records what it is written.
 *
 * `$transaction` runs the callback immediately and rethrows, so a rollback is
 * modelled as "the throw escaped and nothing after it ran" — which is what the
 * tests below actually assert.
 */
function build(
  options: {
    loan?: Record<string, unknown> | null;
    emis?: Record<string, unknown>[];
    penalties?: Record<string, unknown>[];
    schedule?: Record<string, unknown> | null;
    replay?: Record<string, unknown> | null;
    postedRow?: Record<string, unknown>;
    ledgerThrows?: Error;
    createThrows?: Error;
  } = {},
): Harness {
  const created: Record<string, unknown>[] = [];
  const emiUpdates: Record<string, unknown>[] = [];
  const receipts: Record<string, unknown>[] = [];
  const allocationsWritten: Record<string, unknown>[][] = [];

  const emis = options.emis ?? [emiRow()];
  const penalties = options.penalties ?? [];
  const schedule =
    options.schedule === undefined
      ? { repaymentScheduleId: SCHEDULE_ID }
      : options.schedule;

  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const ledger = {
    postCollection: jest.fn().mockImplementation(() => {
      if (options.ledgerThrows) return Promise.reject(options.ledgerThrows);
      return Promise.resolve('je-new');
    }),
    postCollectionReversal: jest.fn().mockResolvedValue('je-reversal'),
    getEntry: jest.fn().mockResolvedValue(null),
  };

  const loans = {
    findInScope: jest.fn().mockImplementation(() => {
      if (options.loan === null)
        return Promise.reject(new NotFoundException('Loan not found'));
      return Promise.resolve(options.loan ?? loanRow());
    }),
  };

  const collectionFindFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      // The post-commit re-read.
      if (where.collectionId) {
        return Promise.resolve(options.postedRow ?? collectionRow());
      }
      // The replay lookup.
      return Promise.resolve(options.replay ?? null);
    });

  const txCollectionCreate = jest
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      if (options.createThrows) return Promise.reject(options.createThrows);
      created.push(data);
      return Promise.resolve({
        ...data,
        collectionId: data.collectionId ?? COLLECTION_ID,
      });
    });

  const tx = {
    loan: {
      findFirst: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            options.loan === null ? null : (options.loan ?? loanRow()),
          ),
        ),
    },
    repaymentSchedule: { findFirst: jest.fn().mockResolvedValue(schedule) },
    emi: {
      findMany: jest.fn().mockResolvedValue(emis),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { emiId: string } }) =>
          Promise.resolve(emis.find((e) => e.emiId === where.emiId) ?? null),
        ),
      update: jest.fn().mockImplementation((args: Record<string, unknown>) => {
        emiUpdates.push(args);
        return Promise.resolve({});
      }),
      aggregate: jest.fn().mockResolvedValue({
        _sum: {
          outstandingAmountPaise: totalOutstandingOf(emis),
        },
      }),
    },
    penalty: {
      findMany: jest.fn().mockResolvedValue(penalties),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { outstandingAmountPaise: 0n } }),
    },
    branch: { findFirst: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    account: { findFirst: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    receipt: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          receipts.push(data);
          return Promise.resolve(data);
        }),
    },
    collection: {
      create: txCollectionCreate,
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    collectionAllocation: {
      createMany: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown>[] }) => {
          allocationsWritten.push(data);
          return Promise.resolve({ count: data.length });
        }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    journalEntry: { update: jest.fn().mockResolvedValue({}) },
    auditLog: {},
  };

  const prisma = {
    ...tx,
    collection: {
      ...tx.collection,
      findFirst: collectionFindFirst,
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest
      .fn()
      .mockImplementation(async (fn: (t: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
  } as unknown as PrismaService;

  const events = notificationEventsStub();

  const service = new CollectionService(
    prisma,
    audit as unknown as AuditService,
    loans as unknown as LoanService,
    ledger as unknown as LedgerService,
    new ReceiptService(),
    events.service,
  );

  return {
    service,
    events,
    audit,
    ledger,
    loans,
    created,
    emiUpdates,
    receipts,
    allocationsWritten,
    collectionFindFirst,
    txCollectionCreate,
  };
}

const postBody = {
  loanId: LOAN_ID,
  collectionDate: '2026-08-22',
  paymentMode: 'CASH' as const,
  amountPaise: '1000',
  idempotencyKey: IDEMPOTENCY_KEY,
};

/**
 * The first argument of a mock's first call, typed.
 *
 * `jest.Mock` is `any`-typed, so reading `.mock.calls[0][0]` inline produces an
 * unsafe-member-access complaint at every call site. Narrowing once here keeps
 * the assertions plain.
 */
function firstCallArg<T>(mock: jest.Mock): T {
  // Jest types `.mock.calls` as `any[][]` by design, so this is the one place
  // that has to say what the argument actually is. Disabled here rather than
  // widened at every call site.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return mock.mock.calls[0][0] as T;
}

/**
 * `expect.objectContaining` typed as unknown rather than `any`.
 *
 * Jest declares it `any`, which makes every assertion that uses it an
 * unsafe-assignment complaint. One narrowing here keeps the assertions plain.
 */
const containing = (shape: Record<string, unknown>): unknown =>
  expect.objectContaining(shape);

/** One recorded audit call, as the service passes it. */
interface AuditCall {
  action: string;
  metadata?: Record<string, unknown>;
}

/**
 * The audit calls made, typed.
 *
 * `jest.Mock` is `any`-typed by default, so reading `.mock.calls` straight
 * produces an unsafe-access complaint on every line that touches it. Narrowing
 * once here keeps the assertions readable and the file free of scattered casts.
 */
function auditCalls(audit: { record: jest.Mock }): AuditCall[] {
  return (audit.record.mock.calls as unknown as [AuditCall][]).map(
    ([input]) => input,
  );
}

function auditedActions(audit: { record: jest.Mock }): string[] {
  return auditCalls(audit).map((call) => call.action);
}

/** The first recorded call for an action, failing the test if there was none. */
function auditFor(audit: { record: jest.Mock }, action: string): AuditCall {
  const found = auditCalls(audit).find((call) => call.action === action);
  // Thrown rather than asserted with a message: Jest's `expect` takes one
  // argument, unlike Vitest's, so the explanation has to live here.
  if (!found) throw new Error(`expected an audit record for ${action}`);
  return found;
}

describe('CollectionService.post — scope', () => {
  it('refuses a loan the caller cannot reach, before anything else happens', async () => {
    const h = build({ loan: null });

    await expect(
      h.service.post(actor(), postBody, META),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Scenarios 37, 38, 39. Nothing was created and no ledger entry attempted.
    expect(h.created).toHaveLength(0);
    expect(h.ledger.postCollection).not.toHaveBeenCalled();
  });

  it('reaches the loan through LoanService, which owns the 404 and the audit', async () => {
    const h = build();

    await h.service.post(actor(), postBody, META);

    expect(h.loans.findInScope).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID }),
      LOAN_ID,
      META,
    );
  });
});

describe('CollectionService.post — idempotency', () => {
  it('returns the original posting for a retry, creating nothing', async () => {
    // Scenario 13.
    const h = build({ replay: collectionRow({ requestFingerprint: null }) });

    const result = await h.service.post(actor(), postBody, META);

    expect(result.collectionId).toBe(COLLECTION_ID);
    expect(h.created).toHaveLength(0);
    expect(h.receipts).toHaveLength(0);
    expect(h.ledger.postCollection).not.toHaveBeenCalled();
    expect(auditedActions(h.audit)).toContain(
      AuditAction.COLLECTION_DUPLICATE_IGNORED,
    );
  });

  it('refuses a reused key carrying a different payment', async () => {
    // Scenario 14. The stored fingerprint is for a different amount.
    const h = build({
      replay: collectionRow({ requestFingerprint: 'a-different-digest' }),
    });

    await expect(h.service.post(actor(), postBody, META)).rejects.toMatchObject(
      {
        response: containing({ code: 'IDEMPOTENCY_KEY_CONFLICT' }),
      },
    );

    expect(h.created).toHaveLength(0);
    expect(auditedActions(h.audit)).toContain(
      AuditAction.COLLECTION_IDEMPOTENCY_CONFLICT,
    );
  });

  it('checks for a replay before running the eligibility gates', async () => {
    // The ordering that matters most. A client retrying a payment that already
    // succeeded gets its result back even though the loan is now closed —
    // running the gates first would report a failure for money already taken.
    const h = build({
      loan: loanRow({ status: 'CLOSED' }),
      replay: collectionRow(),
    });

    const result = await h.service.post(actor(), postBody, META);

    expect(result.collectionId).toBe(COLLECTION_ID);
  });

  it('records the digest under a key the audit sanitizer will not strip', async () => {
    // `sanitizeMetadata` drops any key matching /hash/i. A field named
    // `requestHash` would vanish and the conflict trail would be empty.
    const h = build({ replay: collectionRow({ requestFingerprint: 'other' }) });

    await h.service.post(actor(), postBody, META).catch(() => undefined);

    const conflict = auditFor(
      h.audit,
      AuditAction.COLLECTION_IDEMPOTENCY_CONFLICT,
    );

    expect(Object.keys(conflict.metadata ?? {}).join(' ')).not.toMatch(/hash/i);
    expect(conflict.metadata).toHaveProperty('submittedRequestFingerprint');
  });
});

describe('CollectionService.post — eligibility', () => {
  it.each([
    ['CLOSED', 'LOAN_CLOSED'],
    ['CLOSURE_PENDING', 'LOAN_CLOSED'],
    ['WRITTEN_OFF', 'LOAN_WRITTEN_OFF'],
    ['LEGAL_ESCALATION', 'LOAN_NOT_ACTIVE'],
    ['RESTRUCTURED', 'LOAN_NOT_ACTIVE'],
  ])('refuses a %s loan with the %s blocker', async (status, key) => {
    // Scenario 29. No receipt and no ledger entry are created.
    const h = build({ loan: loanRow({ status }) });

    await expect(h.service.post(actor(), postBody, META)).rejects.toMatchObject(
      {
        response: containing({
          blockers: expect.arrayContaining([containing({ key })]),
        }),
      },
    );

    expect(h.receipts).toHaveLength(0);
    expect(h.ledger.postCollection).not.toHaveBeenCalled();
  });

  it.each(['ACTIVE', 'OVERDUE'])(
    'allows collection on a %s loan',
    async (status) => {
      // OVERDUE is deliberately collectable — it is precisely the loan being
      // collected on.
      const h = build({ loan: loanRow({ status }) });

      await expect(
        h.service.post(actor(), postBody, META),
      ).resolves.toBeDefined();
    },
  );

  it('refuses a loan with no remaining balance', async () => {
    // Scenario 30.
    const h = build({
      emis: [
        emiRow({
          outstandingAmountPaise: 0n,
          paidAmountPaise: 1_000n,
          status: 'PAID',
        }),
      ],
    });

    await expect(
      h.service.post(actor(), postBody, META),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.ledger.postCollection).not.toHaveBeenCalled();
  });

  it('refuses a bank transfer with no payment reference', async () => {
    // Scenario 45, enforced in the service because a field-level conditional
    // would skip the presence check entirely.
    const h = build();

    await expect(
      h.service.post(
        actor(),
        { ...postBody, paymentMode: 'BANK_TRANSFER' },
        META,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.receipts).toHaveLength(0);
    expect(auditedActions(h.audit)).toContain(AuditAction.COLLECTION_BLOCKED);
  });

  it('re-reads the loan inside the transaction rather than trusting the scope check', async () => {
    // Scenarios 29, 44: a loan closed between the scope read and the posting
    // must be caught by the read inside the transaction.
    const h = build();

    await h.service.post(actor(), postBody, META);

    const prisma = (
      h.service as unknown as { prisma: { loan: { findFirst: jest.Mock } } }
    ).prisma;
    expect(prisma.loan.findFirst).toHaveBeenCalled();
  });
});

describe('CollectionService.post — the posting', () => {
  it('posts the ledger entry before creating the collection row', async () => {
    // A POSTED collection is frozen by `collections_append_only`, so
    // `journalEntryId` cannot be written back afterwards. Reordering these two
    // statements looks harmless and makes every posting fail.
    const h = build();

    await h.service.post(actor(), postBody, META);

    const ledgerOrder = h.ledger.postCollection.mock.invocationCallOrder[0];
    const createOrder = h.txCollectionCreate.mock.invocationCallOrder[0];
    expect(ledgerOrder).toBeLessThan(createOrder);

    // And the id is present at insert, not patched in later.
    expect(h.created[0]).toMatchObject({ journalEntryId: 'je-new' });
  });

  it('writes the server-computed allocation, not anything the client sent', async () => {
    const h = build();

    await h.service.post(actor(), postBody, META);

    // 1000 against 200 interest + 800 principal.
    expect(h.created[0]).toMatchObject({
      interestPaidPaise: 200n,
      principalPaidPaise: 800n,
      penaltyPaidPaise: 0n,
      feesPaidPaise: 0n,
      unallocatedAmountPaise: 0n,
    });
  });

  it('mints the receipt number inside the transaction and stores it on both rows', async () => {
    // Scenario 15. Minting only here is what stops a number being issued for a
    // posting that never commits.
    const h = build();

    await h.service.post(actor(), postBody, META);

    expect(h.created[0]).toMatchObject({ receiptNumber: 'RCP-BR001-000001' });
    expect(h.receipts[0]).toMatchObject({
      receiptNumber: 'RCP-BR001-000001',
      receiptType: 'COLLECTION',
    });
  });

  it('moves the paid and outstanding pair without touching the contractual amounts', async () => {
    // Scenarios 22, 23; Rules 16, 17.
    const h = build();

    await h.service.post(actor(), postBody, META);

    const update = h.emiUpdates[0] as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({
      paidAmountPaise: 1_000n,
      outstandingAmountPaise: 0n,
      status: 'PAID',
    });

    for (const field of [
      'totalDuePaise',
      'principalDuePaise',
      'interestDuePaise',
      'openingPrincipalPaise',
    ]) {
      expect(update.data).not.toHaveProperty(field);
    }
  });

  it('marks a part-paid installment PARTIALLY_PAID and clears its paid timestamp', async () => {
    const h = build();

    await h.service.post(actor(), { ...postBody, amountPaise: '300' }, META);

    expect(
      (h.emiUpdates[0] as { data: Record<string, unknown> }).data,
    ).toMatchObject({
      paidAmountPaise: 300n,
      outstandingAmountPaise: 700n,
      status: 'PARTIALLY_PAID',
      paidAt: null,
    });
  });

  it('derives the payment type rather than accepting one', async () => {
    const full = build();
    await full.service.post(actor(), postBody, META);
    expect(full.created[0]).toMatchObject({ paymentType: 'FULL_PAYMENT' });

    const partial = build();
    await partial.service.post(
      actor(),
      { ...postBody, amountPaise: '300' },
      META,
    );
    expect(partial.created[0]).toMatchObject({
      paymentType: 'PARTIAL_PAYMENT',
    });
  });

  it('marks an online posting confirmed and an offline one pending verification', async () => {
    // Rule 39: an offline capture is not authoritative until someone verifies
    // it, and that transition is Module 12's.
    const online = build();
    await online.service.post(actor(), postBody, META);
    expect(online.created[0]).toMatchObject({
      verificationStatus: 'CONFIRMED',
    });

    const offline = build();
    await offline.service.sync(
      actor(),
      {
        ...postBody,
        offlineTransactionUuid: '12121212-1212-1212-1212-121212121212',
        deviceId: 'tablet-1',
        collectedAt: '2026-08-22T09:00:00.000Z',
      },
      META,
    );
    expect(offline.created[0]).toMatchObject({
      verificationStatus: 'PENDING_VERIFICATION',
      offlineCollected: true,
      deviceId: 'tablet-1',
    });
  });

  it('records the device capture time without letting it decide the business date', async () => {
    // Rules 34, 35.
    const h = build();

    await h.service.sync(
      actor(),
      {
        ...postBody,
        collectionDate: '2026-08-22',
        offlineTransactionUuid: '12121212-1212-1212-1212-121212121212',
        deviceId: 'tablet-1',
        collectedAt: '2026-08-20T09:00:00.000Z',
      },
      META,
    );

    const row = h.created[0] as { collectedAt: Date; collectionDate: Date };
    expect(row.collectedAt.toISOString()).toBe('2026-08-20T09:00:00.000Z');
    // The contractual date is the one the request declared, parsed at Kolkata
    // midday — not derived from the device clock.
    expect(row.collectionDate.toISOString().slice(0, 10)).toBe('2026-08-22');
  });

  it('audits creation, posting and the ledger write', async () => {
    // Scenarios 49, 50.
    const h = build();

    await h.service.post(actor(), postBody, META);

    const actions = auditedActions(h.audit);
    expect(actions).toContain(AuditAction.COLLECTION_CREATED);
    expect(actions).toContain(AuditAction.COLLECTION_POSTED);
    expect(actions).toContain(AuditAction.COLLECTION_LEDGER_POSTED);

    const posted = auditFor(h.audit, AuditAction.COLLECTION_POSTED);
    expect(posted.metadata).toMatchObject({
      receiptNumber: 'RCP-BR001-000001',
    });
  });
});

describe('CollectionService.post — failure', () => {
  it('commits nothing when the ledger refuses the entry', async () => {
    // Scenarios 21, 47. The ledger throws before the collection row is even
    // attempted, so there is nothing to roll back — which is the point of the
    // ordering.
    const h = build({
      ledgerThrows: new ConflictException('does not balance'),
    });

    await expect(
      h.service.post(actor(), postBody, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.created).toHaveLength(0);
    expect(h.allocationsWritten).toHaveLength(0);
    expect(h.emiUpdates).toHaveLength(0);
  });

  it('audits a posting failure outside the rolled-back transaction', async () => {
    // Scenarios 46, 52. Recorded on `this.prisma`, not `tx`, so it survives.
    const h = build({ ledgerThrows: new Error('ledger exploded') });

    await expect(h.service.post(actor(), postBody, META)).rejects.toThrow();

    expect(auditedActions(h.audit)).toContain(
      AuditAction.COLLECTION_POSTING_FAILED,
    );
    const failure = (h.audit.record.mock.calls as unknown as unknown[][]).find(
      (call) =>
        (call[0] as { action: string }).action ===
        AuditAction.COLLECTION_POSTING_FAILED,
    )!;
    // One argument only — no transaction client, or it would roll back with
    // the failure it describes.
    expect(failure).toHaveLength(1);
  });

  it('refuses an overpayment and names the maximum collectable', async () => {
    const h = build();

    await expect(
      h.service.post(actor(), { ...postBody, amountPaise: '1001' }, META),
    ).rejects.toMatchObject({
      response: containing({
        code: 'OVERPAYMENT',
        maxCollectablePaise: '1000',
      }),
    });

    expect(h.receipts).toHaveLength(0);
  });

  it('replays rather than failing when a concurrent request won the key', async () => {
    // A P2002 on the idempotency key means another request for this same
    // payment committed first. Its result is the right answer.
    const raced = Object.assign(
      new Error('Unique constraint failed on idempotency_key'),
      {
        code: 'P2002',
      },
    );
    const h = build({ createThrows: raced, replay: null });
    h.collectionFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue(collectionRow());

    const result = await h.service.post(actor(), postBody, META);

    expect(result.collectionId).toBe(COLLECTION_ID);
    expect(auditedActions(h.audit)).toContain(
      AuditAction.COLLECTION_DUPLICATE_IGNORED,
    );
  });

  it('reports a receipt-number collision as a retryable conflict', async () => {
    // Scenarios 16, 48. The loser rolled back whole; nothing was issued.
    const collision = Object.assign(
      new Error('Unique constraint failed on receipt_number'),
      {
        code: 'P2002',
      },
    );
    const h = build({ createThrows: collision });

    await expect(
      h.service.post(actor(), postBody, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(auditedActions(h.audit)).toContain(
      AuditAction.COLLECTION_RECEIPT_CONFLICT,
    );
  });
});

describe('CollectionService.sync', () => {
  const syncBody = {
    ...postBody,
    offlineTransactionUuid: '12121212-1212-1212-1212-121212121212',
    deviceId: 'tablet-1',
    collectedAt: '2026-08-22T09:00:00.000Z',
  };

  it('replays on the offline transaction id as well as the idempotency key', async () => {
    // Scenario 42: a device that lost the response retries with both.
    const h = build({ replay: collectionRow({ offlineCollected: true }) });

    const result = await h.service.sync(actor(), syncBody, META);

    expect(result.collectionId).toBe(COLLECTION_ID);
    expect(h.created).toHaveLength(0);
  });

  it('reports a conflicting offline transaction rather than overwriting', async () => {
    // Scenario 43.
    const conflict = Object.assign(
      new Error('Unique constraint failed on offline_transaction_uuid'),
      { code: 'P2002' },
    );
    const h = build({ createThrows: conflict });

    await expect(h.service.sync(actor(), syncBody, META)).rejects.toMatchObject(
      {
        response: containing({ code: 'OFFLINE_SYNC_CONFLICT' }),
      },
    );

    expect(auditedActions(h.audit)).toContain(
      AuditAction.COLLECTION_SYNC_CONFLICT,
    );
  });

  it('runs every eligibility gate a stale device capture could have outrun', async () => {
    // Scenario 44: the loan closed while the device was offline.
    const h = build({ loan: loanRow({ status: 'CLOSED' }) });

    await expect(
      h.service.sync(actor(), syncBody, META),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.ledger.postCollection).not.toHaveBeenCalled();
  });

  it('records that a sync was received before deciding its outcome', async () => {
    // Scenario 41: the arrival is itself auditable, whatever happens next.
    const h = build();

    await h.service.sync(actor(), syncBody, META);

    expect(auditedActions(h.audit)).toContain(
      AuditAction.COLLECTION_SYNC_RECEIVED,
    );
  });
});

describe('CollectionService.reverse', () => {
  it('refuses a stale version and audits the attempt', async () => {
    // Scenario 26.
    const h = build();
    h.collectionFindFirst.mockResolvedValue(collectionRow());

    await expect(
      h.service.reverse(
        actor(),
        COLLECTION_ID,
        {
          reversalReason: 'wrong loan',
          expectedVersion: '2020-01-01T00:00:00.000Z',
        },
        META,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(auditedActions(h.audit)).toContain(
      AuditAction.COLLECTION_CONCURRENT_ATTEMPT_REJECTED,
    );
    expect(h.ledger.postCollectionReversal).not.toHaveBeenCalled();
  });

  it.each([
    ['REVERSED', 'already been reversed'],
    ['CREATED', 'Only a posted collection'],
    ['FAILED', 'Only a posted collection'],
  ])('refuses to reverse a %s collection', async (status, message) => {
    // Scenario 33 for REVERSED; the rest are states with no money behind them.
    const row = collectionRow({ status });
    const h = build();
    h.collectionFindFirst.mockResolvedValue(row);

    await expect(
      h.service.reverse(
        actor(),
        COLLECTION_ID,
        {
          reversalReason: 'again',
          expectedVersion: row.updatedAt.toISOString(),
        },
        META,
      ),
    ).rejects.toThrow(
      containing({ message: expect.stringContaining(message) }) as Error,
    );

    expect(h.ledger.postCollectionReversal).not.toHaveBeenCalled();
  });

  it('posts the reversal entry before the row that carries it', async () => {
    // Same freezing rule as the posting path: a REVERSED row cannot be updated.
    const row = collectionRow();
    const h = build();
    h.collectionFindFirst.mockResolvedValue(row);

    await h.service.reverse(
      actor(),
      COLLECTION_ID,
      {
        reversalReason: 'wrong loan',
        expectedVersion: row.updatedAt.toISOString(),
      },
      META,
    );

    const ledgerOrder =
      h.ledger.postCollectionReversal.mock.invocationCallOrder[0];
    const createOrder = h.txCollectionCreate.mock.invocationCallOrder[0];
    expect(ledgerOrder).toBeLessThan(createOrder);
    expect(h.created[0]).toMatchObject({ journalEntryId: 'je-reversal' });
  });

  it('creates a mirror row that points at the original and carries no receipt', async () => {
    // Scenarios 31, and Rule 20 — a receipt is never reused.
    const row = collectionRow();
    const h = build();
    h.collectionFindFirst.mockResolvedValue(row);

    await h.service.reverse(
      actor(),
      COLLECTION_ID,
      {
        reversalReason: 'wrong loan',
        expectedVersion: row.updatedAt.toISOString(),
      },
      META,
    );

    expect(h.created[0]).toMatchObject({
      reversalOfCollectionId: COLLECTION_ID,
      status: 'REVERSED',
      penaltyPaidPaise: 0n,
      interestPaidPaise: 200n,
      principalPaidPaise: 800n,
    });
    expect(h.created[0]).not.toHaveProperty('receiptNumber');
  });

  it('marks the original journal entry reversed and changes nothing else about it', async () => {
    // Scenario 32. `journal_entries_append_only` permits exactly this and the
    // original's lines were never mutable at all.
    const row = collectionRow();
    const h = build();
    h.collectionFindFirst.mockResolvedValue(row);

    await h.service.reverse(
      actor(),
      COLLECTION_ID,
      {
        reversalReason: 'wrong loan',
        expectedVersion: row.updatedAt.toISOString(),
      },
      META,
    );

    const prisma = (
      h.service as unknown as {
        prisma: { journalEntry: { update: jest.Mock } };
      }
    ).prisma;
    const call = firstCallArg<{ data: Record<string, unknown> }>(
      prisma.journalEntry.update,
    );

    expect(call.data).toEqual({ status: 'REVERSED' });
  });

  it('audits the reversal and its ledger entry', async () => {
    // Scenario 51.
    const row = collectionRow();
    const h = build();
    h.collectionFindFirst.mockResolvedValue(row);

    await h.service.reverse(
      actor(),
      COLLECTION_ID,
      {
        reversalReason: 'wrong loan',
        expectedVersion: row.updatedAt.toISOString(),
      },
      META,
    );

    const actions = auditedActions(h.audit);
    expect(actions).toContain(AuditAction.COLLECTION_REVERSED);
    expect(actions).toContain(AuditAction.COLLECTION_LEDGER_REVERSED);

    const reversed = auditFor(h.audit, AuditAction.COLLECTION_REVERSED);
    expect(reversed.metadata).toMatchObject({ reversalReason: 'wrong loan' });
  });
});

describe('CollectionService — reads', () => {
  it('confines the list to the caller branch without accepting a filter', async () => {
    // Scenario 1.
    const h = build();

    await h.service.list(actor({ branchId: BRANCH_ID }), {}, META);

    const prisma = (
      h.service as unknown as {
        prisma: { collection: { findMany: jest.Mock } };
      }
    ).prisma;
    const { where } = firstCallArg<{ where: Record<string, unknown> }>(
      prisma.collection.findMany,
    );

    expect(where).toMatchObject({ orgId: ORG_ID, branchId: BRANCH_ID });
  });

  it('lets an organization-wide caller see every branch', async () => {
    const h = build();

    await h.service.list(actor({ branchId: null }), {}, META);

    const prisma = (
      h.service as unknown as {
        prisma: { collection: { findMany: jest.Mock } };
      }
    ).prisma;
    const { where } = firstCallArg<{ where: Record<string, unknown> }>(
      prisma.collection.findMany,
    );

    expect(where).not.toHaveProperty('branchId');
  });

  it('returns a 404 and audits the denial for an unreachable collection', async () => {
    // Scenarios 1, 4, 38 — never a 403, which would confirm the id exists.
    const h = build();
    h.collectionFindFirst.mockResolvedValue(null);

    await expect(
      h.service.getDetail(actor({ branchId: BRANCH_ID }), COLLECTION_ID, META),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(auditedActions(h.audit)).toContain(
      AuditAction.COLLECTION_SCOPE_DENIED,
    );
  });

  it('reports readiness with the exact outstanding figure to tender', async () => {
    // Overpayment is a 400, so the form needs the exact paise — a rounded
    // rupee value would be refused.
    const h = build();

    const readiness = await h.service.collectionReadiness(
      actor(),
      LOAN_ID,
      META,
    );

    expect(readiness.collectable).toBe(true);
    expect(readiness.totalOutstandingPaise).toBe('1000');
    expect(readiness.interestOutstandingPaise).toBe('200');
    expect(readiness.principalOutstandingPaise).toBe('800');
  });

  it('previews an allocation without writing anything', async () => {
    // Scenarios 6, 7, 8.
    const h = build();

    const preview = await h.service.previewAllocation(
      actor(),
      { loanId: LOAN_ID, amountPaise: '300' },
      META,
    );

    expect(preview).toMatchObject({
      interestPaise: '200',
      principalPaise: '100',
      unallocatedPaise: '0',
      wouldCloseLoan: false,
    });
    expect(h.created).toHaveLength(0);
    expect(h.ledger.postCollection).not.toHaveBeenCalled();
  });

  it('flags a preview that would clear the loan', async () => {
    const h = build();

    const preview = await h.service.previewAllocation(
      actor(),
      { loanId: LOAN_ID, amountPaise: '1000' },
      META,
    );

    expect(preview.wouldCloseLoan).toBe(true);
  });
});

/**
 * Module 16 — the notification event raised by a posted collection.
 *
 * This is the highest-stakes emit point in the system: by the time the event is
 * raised, money has moved and the ledger is posted. Rules 6, 7, 31 and 60-62
 * and Scenarios 25, 31 and 35 all converge on one requirement — nothing the
 * notification path does may touch any of that.
 *
 * The tests below pin the three ways that could break: an emit that fails a
 * posting, an emit that writes a ledger line, and a payload that recomputes an
 * allocation instead of reading the authoritative one.
 */
describe('CollectionService.post — notification event (Module 16)', () => {
  it('raises RECEIPT_POSTED after the collection commits', async () => {
    const h = build();

    await h.service.post(actor(), postBody, META);

    const raised = h.events.ofType('RECEIPT_POSTED');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ sourceModule: 'collection' });
  });

  it('keys the event on the payment idempotency key', () => {
    // A retried posting and a replayed event then share one identity, so the
    // two cannot produce two notifications for one payment (Rules 12, 22).
    const h = build();

    return h.service.post(actor(), postBody, META).then(() => {
      const [raised] = h.events.ofType('RECEIPT_POSTED');
      expect(raised.deduplicationKey).toContain(postBody.idempotencyKey);
    });
  });

  describe('Rule 25: money never crosses a float', () => {
    it('carries every amount as a decimal string of paise', async () => {
      const h = build();

      await h.service.post(actor(), postBody, META);

      const [raised] = h.events.ofType('RECEIPT_POSTED');
      for (const key of [
        'amountPaise',
        'penaltyPaise',
        'interestPaise',
        'principalPaise',
        'feesPaise',
      ]) {
        expect(typeof raised.payload[key]).toBe('string');
      }
    });

    it('carries a pre-formatted amount so no template has to compute one', () => {
      // Rule 27: a template must not recalculate a financial value. Formatting
      // here rather than there is what makes that possible.
      const h = build();

      return h.service.post(actor(), postBody, META).then(() => {
        const [raised] = h.events.ofType('RECEIPT_POSTED');
        expect(typeof raised.payload.amountFormatted).toBe('string');
      });
    });
  });

  describe('Rules 26, 68 and Scenario 36: dates stay DATE-only', () => {
    it('carries the collection date with no time component', async () => {
      const h = build();

      await h.service.post(actor(), postBody, META);

      const [raised] = h.events.ofType('RECEIPT_POSTED');
      expect(raised.payload.collectionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('Rules 6, 7, 31 and Scenarios 25, 31, 35', () => {
    it('posts the collection even when the notification pipeline throws', async () => {
      // Scenario 31 verbatim: a provider outage must not roll back a committed
      // collection. The stub is deliberately more hostile than production,
      // which swallows its own failures.
      const h = build();
      (
        h.service as unknown as { events: { emit: () => Promise<void> } }
      ).events = {
        emit: () => Promise.reject(new Error('notification pipeline is down')),
      };

      await expect(
        h.service.post(actor(), postBody, META),
      ).resolves.toBeDefined();

      // The money still moved and the ledger still posted.
      expect(h.created).toHaveLength(1);
      expect(h.ledger.postCollection).toHaveBeenCalled();
    });

    it('creates no ledger entry of its own', async () => {
      // Rule 31 and Scenario 35. The notification path holds no `tx`, so it is
      // structurally incapable of posting — this asserts the ledger was called
      // exactly once, by the collection itself and not again by the emit.
      const h = build();

      await h.service.post(actor(), postBody, META);

      expect(h.ledger.postCollection).toHaveBeenCalledTimes(1);
    });
  });
});
