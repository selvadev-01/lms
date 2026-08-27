/**
 * Tests for source-to-journal reconciliation (Module 14 Scenarios 58-60).
 *
 * The property that matters most is the one asserted last and is not about any
 * particular finding: **this service cannot write.** Scenarios 59 and 60
 * require that an inconsistency be flagged rather than silently repaired, and
 * the way to guarantee that is for the code to be incapable of acting. The
 * final test proves no write method on the Prisma fake was ever called.
 */

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ReconciliationService } from './reconciliation.service';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const BRANCH_ID = '44444444-4444-4444-4444-444444444444';

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

const WINDOW = { fromDate: '2026-08-01', toDate: '2026-08-31' };

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
    permissions: ['accounting.ledger.reconcile'],
    ...overrides,
  };
}

interface Fixtures {
  orphanDisbursements?: {
    disbursementId: string;
    transactionReference: string | null;
    createdAt: Date;
  }[];
  orphanCollections?: {
    collectionId: string;
    receiptNumber: string | null;
    collectionDate: Date;
  }[];
  duplicateGroups?: {
    sourceType: string;
    sourceId: string;
    _count: { _all: number };
  }[];
  duplicateEntries?: {
    journalEntryId: string;
    entryNumber: string;
    entryDate: Date;
  }[];
  lineSums?: {
    journalEntryId: string;
    _sum: { debitPaise: bigint; creditPaise: bigint };
  }[];
  unbalancedEntries?: {
    journalEntryId: string;
    entryNumber: string;
    entryDate: Date;
    sourceType: string | null;
    sourceId: string | null;
  }[];
}

/**
 * A fake whose every write method throws.
 *
 * A reconciliation that repaired something would fail loudly here rather than
 * pass quietly, which is the point: the guarantee is structural, and a test
 * that merely observed "no findings were repaired this time" would not catch a
 * repair path added later.
 */
function buildPrisma(fixtures: Fixtures) {
  const forbidden = (name: string) =>
    jest.fn(() => {
      throw new Error(
        `ReconciliationService must never write. It called ${name}.`,
      );
    });

  const writeGuards = {
    create: forbidden('create'),
    createMany: forbidden('createMany'),
    update: forbidden('update'),
    updateMany: forbidden('updateMany'),
    upsert: forbidden('upsert'),
    delete: forbidden('delete'),
    deleteMany: forbidden('deleteMany'),
  };

  const journalEntry = {
    ...writeGuards,
    // The argument is both declared and read, so the recorded call tuple is
    // typed: the branch-scope tests inspect `mock.calls[0][0].where`, and a
    // `jest.fn(() => ...)` records an empty tuple that cannot be indexed.
    count: jest.fn((args: { where: Record<string, unknown> }) =>
      Promise.resolve(args.where ? 42 : 0),
    ),
    groupBy: jest.fn(() => Promise.resolve(fixtures.duplicateGroups ?? [])),
    findMany: jest.fn(() => Promise.resolve(fixtures.duplicateEntries ?? [])),
  };

  const journalLine = {
    ...writeGuards,
    groupBy: jest.fn(() => Promise.resolve(fixtures.lineSums ?? [])),
    findMany: jest.fn(() => Promise.resolve([])),
  };

  const disbursement = {
    ...writeGuards,
    findMany: jest.fn(() =>
      Promise.resolve(fixtures.orphanDisbursements ?? []),
    ),
    count: jest.fn(() => Promise.resolve(10)),
  };

  const collection = {
    ...writeGuards,
    findMany: jest.fn(() => Promise.resolve(fixtures.orphanCollections ?? [])),
    count: jest.fn(() => Promise.resolve(20)),
  };

  // Overridden after construction so the unbalanced lookup can return entries
  // while the duplicate lookup returns its own set.
  if (fixtures.unbalancedEntries) {
    journalEntry.findMany = jest.fn(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.journalEntryId) {
          return Promise.resolve(fixtures.unbalancedEntries!);
        }
        return Promise.resolve(fixtures.duplicateEntries ?? []);
      },
    ) as unknown as typeof journalEntry.findMany;
  }

  const prisma = {
    journalEntry,
    journalLine,
    disbursement,
    collection,
    $transaction: jest.fn(() => {
      throw new Error('ReconciliationService must never open a transaction.');
    }),
  };

  return { prisma, writeGuards, journalEntry, journalLine };
}

function buildService(fixtures: Fixtures = {}) {
  const { prisma, journalEntry, journalLine } = buildPrisma(fixtures);
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ReconciliationService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, audit, prisma, journalEntry, journalLine };
}

describe('ReconciliationService.run', () => {
  it('reports nothing when every source event has its journal', async () => {
    // The expected result. An empty report is a healthy ledger.
    const { service } = buildService();

    const report = await service.run(actor(), WINDOW, META);

    expect(report.summary.findingCount).toBe(0);
    expect(report.missingJournals).toEqual([]);
    expect(report.duplicateJournals).toEqual([]);
    expect(report.unbalancedJournals).toEqual([]);
  });

  it('counts what it checked, so an empty report is distinguishable from an empty window', async () => {
    // "Nothing wrong" and "nothing looked at" are different claims, and only
    // one of them is reassuring.
    const { service } = buildService();

    const report = await service.run(actor(), WINDOW, META);

    expect(report.summary.sourceEventsChecked).toBe(30);
    expect(report.summary.journalsChecked).toBe(42);
  });

  it('flags a completed disbursement with no ledger entry', async () => {
    // Scenario 59.
    const { service } = buildService({
      orphanDisbursements: [
        {
          disbursementId: 'dddddddd-0000-4000-8000-000000000001',
          transactionReference: 'NEFT-8891',
          createdAt: new Date('2026-08-12T10:00:00Z'),
        },
      ],
    });

    const report = await service.run(actor(), WINDOW, META);

    expect(report.missingJournals).toHaveLength(1);
    expect(report.missingJournals[0]?.kind).toBe('MISSING_JOURNAL');
    expect(report.missingJournals[0]?.sourceModule).toBe('DISBURSEMENT');
    expect(report.missingJournals[0]?.sourceReference).toBe('NEFT-8891');
    expect(report.summary.findingCount).toBe(1);
  });

  it('flags a posted collection with no ledger entry', async () => {
    const { service } = buildService({
      orphanCollections: [
        {
          collectionId: 'cccccccc-0000-4000-8000-000000000001',
          receiptNumber: 'RCP-BR001-000042',
          collectionDate: new Date('2026-08-14T00:00:00Z'),
        },
      ],
    });

    const report = await service.run(actor(), WINDOW, META);

    expect(report.missingJournals[0]?.sourceModule).toBe('COLLECTION');
    expect(report.missingJournals[0]?.sourceReference).toBe('RCP-BR001-000042');
  });

  it('narrows to one source module when asked', async () => {
    const { service } = buildService({
      orphanCollections: [
        {
          collectionId: 'cccccccc-0000-4000-8000-000000000001',
          receiptNumber: 'RCP-1',
          collectionDate: new Date('2026-08-14T00:00:00Z'),
        },
      ],
      orphanDisbursements: [
        {
          disbursementId: 'dddddddd-0000-4000-8000-000000000001',
          transactionReference: 'NEFT-1',
          createdAt: new Date('2026-08-12T10:00:00Z'),
        },
      ],
    });

    const report = await service.run(
      actor(),
      { ...WINDOW, sourceType: 'COLLECTION' },
      META,
    );

    expect(report.missingJournals).toHaveLength(1);
    expect(report.missingJournals[0]?.sourceModule).toBe('COLLECTION');
  });

  it('flags two authoritative journals for one source event', async () => {
    // Scenario 60. Detected rather than prevented: a constraint would make the
    // migration fail on any historic duplicate, and the source asks for the
    // inconsistency to be investigated rather than refused.
    const { service } = buildService({
      duplicateGroups: [
        {
          sourceType: 'COLLECTION',
          sourceId: 'cccccccc-0000-4000-8000-000000000009',
          _count: { _all: 2 },
        },
      ],
      duplicateEntries: [
        {
          journalEntryId: 'eeeeeeee-0000-4000-8000-000000000001',
          entryNumber: 'JE-000050',
          entryDate: new Date('2026-08-10T00:00:00Z'),
        },
        {
          journalEntryId: 'eeeeeeee-0000-4000-8000-000000000002',
          entryNumber: 'JE-000051',
          entryDate: new Date('2026-08-10T00:00:00Z'),
        },
      ],
    });

    const report = await service.run(actor(), WINDOW, META);

    expect(report.duplicateJournals).toHaveLength(1);
    expect(report.duplicateJournals[0]?.journalEntryIds).toHaveLength(2);
    expect(report.duplicateJournals[0]?.sourceReference).toBe(
      'JE-000050, JE-000051',
    );
  });

  it('flags a posted entry whose debits do not equal its credits', async () => {
    // Should be unreachable: the deferred trigger refuses it at COMMIT. A
    // finding here means the trigger was dropped, which nothing else reveals.
    const { service } = buildService({
      lineSums: [
        {
          journalEntryId: 'eeeeeeee-0000-4000-8000-000000000003',
          _sum: { debitPaise: 50000n, creditPaise: 40000n },
        },
      ],
      unbalancedEntries: [
        {
          journalEntryId: 'eeeeeeee-0000-4000-8000-000000000003',
          entryNumber: 'JE-000060',
          entryDate: new Date('2026-08-11T00:00:00Z'),
          sourceType: null,
          sourceId: null,
        },
      ],
    });

    const report = await service.run(actor(), WINDOW, META);

    expect(report.unbalancedJournals).toHaveLength(1);
    expect(report.unbalancedJournals[0]?.detail).toContain('50000');
    expect(report.unbalancedJournals[0]?.detail).toContain(
      'check that it is still installed',
    );
  });

  it('ignores a balanced entry when scanning for imbalance', async () => {
    const { service } = buildService({
      lineSums: [
        {
          journalEntryId: 'eeeeeeee-0000-4000-8000-000000000004',
          _sum: { debitPaise: 50000n, creditPaise: 50000n },
        },
      ],
    });

    const report = await service.run(actor(), WINDOW, META);

    expect(report.unbalancedJournals).toEqual([]);
  });

  it('audits the run with its finding counts', async () => {
    const { service, audit } = buildService();

    await service.run(actor(), WINDOW, META);

    expect(audit.record).toHaveBeenCalledWith(
      containing({ action: AuditAction.RECONCILIATION_RUN }),
    );
  });

  it('confines a branch actor to their own branch', async () => {
    const { service, journalEntry } = buildService();

    await service.run(actor({ branchId: BRANCH_ID }), WINDOW, META);

    const [call] = journalEntry.count.mock.calls[0] ?? [];

    expect(call?.where).toMatchObject({ branchId: BRANCH_ID });
  });

  it('applies no branch filter for an organization-wide actor', async () => {
    const { service, journalEntry } = buildService();

    await service.run(actor({ branchId: null }), WINDOW, META);

    const [call] = journalEntry.count.mock.calls[0] ?? [];

    expect(call?.where).not.toHaveProperty('branchId');
  });

  it('never writes, whatever it finds', async () => {
    // The structural guarantee behind Scenarios 59 and 60. Every write method
    // on the fake throws, so a repair path added later fails this test rather
    // than shipping.
    const { service } = buildService({
      orphanDisbursements: [
        {
          disbursementId: 'dddddddd-0000-4000-8000-000000000001',
          transactionReference: 'NEFT-1',
          createdAt: new Date('2026-08-12T10:00:00Z'),
        },
      ],
      duplicateGroups: [
        {
          sourceType: 'COLLECTION',
          sourceId: 'cccccccc-0000-4000-8000-000000000009',
          _count: { _all: 2 },
        },
      ],
      duplicateEntries: [
        {
          journalEntryId: 'eeeeeeee-0000-4000-8000-000000000001',
          entryNumber: 'JE-000050',
          entryDate: new Date('2026-08-10T00:00:00Z'),
        },
      ],
      lineSums: [
        {
          journalEntryId: 'eeeeeeee-0000-4000-8000-000000000003',
          _sum: { debitPaise: 1n, creditPaise: 2n },
        },
      ],
      unbalancedEntries: [
        {
          journalEntryId: 'eeeeeeee-0000-4000-8000-000000000003',
          entryNumber: 'JE-000060',
          entryDate: new Date('2026-08-11T00:00:00Z'),
          sourceType: null,
          sourceId: null,
        },
      ],
    });

    const report = await service.run(actor(), WINDOW, META);

    // It found problems in all three categories and repaired none of them.
    expect(report.summary.findingCount).toBe(3);
  });
});
