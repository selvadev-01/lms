import { ForbiddenException } from '@nestjs/common';

import { AuditAction } from '../../audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { CollectionReportService } from './collection-report.service';

/**
 * Module 15 — the collection report.
 *
 * The scope helper is proved in `report-scope.spec.ts`. What this file proves
 * is that the service actually *uses* it, and uses it in the place that
 * matters: inside the Prisma `where`, not as a filter applied after the rows
 * came back. A service that resolved the scope correctly and then queried
 * without it would pass every test in the other file and still leak.
 *
 * No database. The Prisma client is a stub that records the arguments it was
 * called with, which is exactly what these assertions are about.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const BRANCH_A = '44444444-4444-4444-8444-444444444444';
const BRANCH_B = '55555555-5555-4555-8555-555555555555';

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    orgId: ORG,
    orgCode: 'DEMO',
    sessionId: '33333333-3333-4333-8333-333333333333',
    branchId: null,
    roles: [],
    permissions: [],
    ...overrides,
  };
}

interface Recorded {
  findMany: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
  }[];
  aggregate: { where: Record<string, unknown> }[];
}

/**
 * Relations that actually exist on `Collection`.
 *
 * Hand-copied from `schema.prisma` rather than derived, because deriving them
 * from the Prisma client is what a mistyped include already passes. The trap
 * this guards is specific and was hit for real: `reversedBy` is a UUID column
 * holding the user who performed the reversal, while the relation to the
 * reversing collection is `reversedByCollection`. Naming the scalar in an
 * `include` is accepted by TypeScript, rejected by Prisma at query time, and
 * surfaces through the exception filter as an opaque 503.
 */
const COLLECTION_RELATIONS = new Set([
  'loan',
  'customer',
  'branch',
  'collectorUser',
  'reversalOf',
  'reversedByCollection',
  'allocations',
  'journalEntry',
  'receipt',
  'gpsCheckIn',
  'fieldVisit',
  'custodyHandover',
  'emi',
  'organization',
]);

function harness(rows: unknown[] = []) {
  const recorded: Recorded = { findMany: [], aggregate: [] };

  const prisma = {
    collection: {
      findMany: jest.fn(
        (args: {
          where: Record<string, unknown>;
          include?: Record<string, unknown>;
        }) => {
          recorded.findMany.push(args);
          return Promise.resolve(rows);
        },
      ),
      count: jest.fn(() => Promise.resolve(rows.length)),
      aggregate: jest.fn((args: { where: Record<string, unknown> }) => {
        recorded.aggregate.push(args);
        return Promise.resolve({
          _sum: {
            amountPaise: null,
            penaltyPaidPaise: null,
            interestPaidPaise: null,
            principalPaidPaise: null,
            feesPaidPaise: null,
          },
        });
      }),
    },
  };

  const audit = {
    record: jest.fn((input: Record<string, unknown>) => {
      void input;
      return Promise.resolve();
    }),
  };

  const service = new CollectionReportService(prisma as never, audit as never);

  return { service, recorded, audit };
}

const meta = { requestId: 'req-1', ipAddress: null, userAgent: null };

describe('CollectionReportService', () => {
  describe('Scenario 53: Branch A cannot read Branch B', () => {
    it('puts the actor branch in the query, not a post-filter', async () => {
      const { service, recorded } = harness();

      await service.run(actor({ branchId: BRANCH_A }), {}, meta);

      expect(recorded.findMany[0]?.where).toMatchObject({
        orgId: ORG,
        branchId: BRANCH_A,
      });
    });

    it('refuses a branch caller who asks for another branch', async () => {
      const { service } = harness();

      await expect(
        service.run(
          actor({ branchId: BRANCH_A }),
          { branchId: BRANCH_B },
          meta,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('the include names only real relations', () => {
    it('does not mistake a scalar column for a relation', () => {
      // A stubbed Prisma client accepts any include, so nothing else in this
      // file would notice `reversedBy` in place of `reversedByCollection`. The
      // real client rejects it at query time and the exception filter turns
      // that into a 503 that names nothing — so this assertion is the only
      // cheap place the mistake is visible.
      const { service, recorded } = harness();

      return service.run(actor(), {}, meta).then(() => {
        const include = recorded.findMany[0]?.include ?? {};

        for (const key of Object.keys(include)) {
          expect(COLLECTION_RELATIONS.has(key)).toBe(true);
        }
        expect(Object.keys(include)).toContain('reversedByCollection');
      });
    });
  });

  describe('Scenario 54: cross-organization access is denied', () => {
    it('always scopes by the organization from the token', async () => {
      const { service, recorded } = harness();

      await service.run(actor(), {}, meta);

      expect(recorded.findMany[0]?.where).toMatchObject({ orgId: ORG });
      // And the aggregate — a total computed without the org filter would leak
      // another tenant's money into this tenant's footer even when the rows
      // themselves were scoped.
      expect(recorded.aggregate[0]?.where).toMatchObject({ orgId: ORG });
    });
  });

  describe('Scenario 16: the total comes from the same authorized dataset', () => {
    it('aggregates over the report filters, not the page', async () => {
      const { service, recorded } = harness();

      await service.run(
        actor({ branchId: BRANCH_A }),
        { fromDate: '2026-01-01', toDate: '2026-01-31', page: 2, pageSize: 10 },
        meta,
      );

      const listWhere = recorded.findMany[0]?.where ?? {};
      const totalWhere = recorded.aggregate[0]?.where ?? {};

      // Same organization, same branch, same range. Rule 35: the summary
      // represents the dataset the filters describe. A page-local total would
      // understate every report longer than one page.
      expect(totalWhere).toMatchObject({
        orgId: listWhere.orgId,
        branchId: listWhere.branchId,
        collectionDate: listWhere.collectionDate,
      });
    });

    it('counts only posted collections toward the money total', async () => {
      const { service, recorded } = harness();

      await service.run(actor(), {}, meta);

      // Scenario 15: a reversed collection and its reversing entry both stay
      // visible as rows, so the reader can see what happened, but neither
      // counts as money collected.
      expect(recorded.aggregate[0]?.where).toMatchObject({ status: 'POSTED' });
      expect(recorded.findMany[0]?.where).not.toHaveProperty('status');
    });
  });

  describe('Scenario 64: report generation is audit logged', () => {
    it('records the actor, category and scope', async () => {
      const { service, audit } = harness();

      await service.run(actor({ branchId: BRANCH_A }), {}, meta);

      // Asserted against the recorded argument rather than with nested
      // `expect.objectContaining`, which is typed `any` and would let a
      // misspelled key pass silently.
      const recorded = audit.record.mock.calls[0]?.[0];

      expect(recorded).toMatchObject({
        orgId: ORG,
        action: AuditAction.REPORT_GENERATED,
        entityType: 'REPORT',
        metadata: {
          category: 'COLLECTIONS',
          branchId: BRANCH_A,
        },
      });
    });
  });

  describe('Scenario 14: allocation components are the authoritative ones', () => {
    it('reads the stored allocation rather than re-splitting the amount', async () => {
      const { service } = harness([
        {
          collectionId: 'c1',
          receiptNumber: 'RCP-000001',
          loanId: 'l1',
          branchId: BRANCH_A,
          collectionDate: new Date('2026-01-15T00:00:00Z'),
          paymentMode: 'CASH',
          // The components deliberately do not sum to the amount here: a
          // partially unallocated collection is a real state, and the report
          // must show what Module 11 recorded rather than a tidy re-split.
          amountPaise: BigInt(500000),
          penaltyPaidPaise: BigInt(10000),
          interestPaidPaise: BigInt(90000),
          principalPaidPaise: BigInt(300000),
          feesPaidPaise: BigInt(0),
          status: 'POSTED',
          isFieldCollection: false,
          loan: { loanNumber: 'LN-000001' },
          customer: { fullName: 'Asha Patel' },
          branch: { name: 'Central' },
          collectorUser: null,
          reversalOf: null,
          reversedBy: null,
        },
      ]);

      const report = await service.run(actor(), {}, meta);
      const row = report.rows[0];

      expect(row?.penaltyAllocationPaise).toBe('10000');
      expect(row?.interestAllocationPaise).toBe('90000');
      expect(row?.principalAllocationPaise).toBe('300000');
      expect(row?.feeAllocationPaise).toBe('0');
      expect(row?.collectedAmountPaise).toBe('500000');
    });
  });

  describe('Scenario 35: PII is masked without the permission', () => {
    const row = {
      collectionId: 'c1',
      receiptNumber: 'RCP-000001',
      loanId: 'l1',
      branchId: BRANCH_A,
      collectionDate: new Date('2026-01-15T00:00:00Z'),
      paymentMode: 'CASH',
      amountPaise: BigInt(1000),
      penaltyPaidPaise: BigInt(0),
      interestPaidPaise: BigInt(0),
      principalPaidPaise: BigInt(1000),
      feesPaidPaise: BigInt(0),
      status: 'POSTED',
      isFieldCollection: false,
      loan: { loanNumber: 'LN-000001' },
      customer: { fullName: 'Asha Patel' },
      branch: { name: 'Central' },
      collectorUser: null,
      reversalOf: null,
      reversedBy: null,
    };

    it('masks the customer name and says so in meta', async () => {
      const { service } = harness([row]);

      const report = await service.run(actor(), {}, meta);

      expect(report.rows[0]?.customerName).toBe('A••••');
      expect(report.meta.piiMasked).toBe(true);
    });

    it('shows the name to a caller holding reports.export.pii', async () => {
      const { service } = harness([row]);

      const report = await service.run(
        actor({ permissions: ['reports.export.pii'] }),
        {},
        meta,
      );

      expect(report.rows[0]?.customerName).toBe('Asha Patel');
      expect(report.meta.piiMasked).toBe(false);
    });
  });

  describe('money is never a number', () => {
    it('carries a paise total beyond Number.MAX_SAFE_INTEGER intact', async () => {
      // Scenario 25's property, applied here: an amount above ~90,000 crore in
      // paise loses precision as a double. The report returns strings end to
      // end, so the figure survives.
      const huge = '9007199254740993';
      const { service } = harness([
        {
          collectionId: 'c1',
          receiptNumber: null,
          loanId: 'l1',
          branchId: BRANCH_A,
          collectionDate: new Date('2026-01-15T00:00:00Z'),
          paymentMode: 'BANK_TRANSFER',
          amountPaise: BigInt(huge),
          penaltyPaidPaise: BigInt(0),
          interestPaidPaise: BigInt(0),
          principalPaidPaise: BigInt(huge),
          feesPaidPaise: BigInt(0),
          status: 'POSTED',
          isFieldCollection: false,
          loan: { loanNumber: 'LN-000001' },
          customer: { fullName: 'Asha Patel' },
          branch: { name: 'Central' },
          collectorUser: null,
          reversalOf: null,
          reversedBy: null,
        },
      ]);

      const report = await service.run(actor(), {}, meta);

      expect(report.rows[0]?.collectedAmountPaise).toBe(huge);
      // And the value genuinely does not survive a trip through `number` — the
      // reason the whole money path is strings. If this ever stops being true,
      // the figure chosen is no longer big enough to prove anything.
      expect(String(Number(huge))).not.toBe(huge);
    });
  });
});
