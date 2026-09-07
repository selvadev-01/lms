import type { AuthContext } from '../../common/auth-context';
import { PortfolioReportService } from './portfolio-report.service';

/**
 * Module 15 — the portfolio report's `customerId` filter.
 *
 * Added for the customer portfolio screen, which needs one borrower's loans with
 * their outstanding split and days past due — figures this service already
 * derives and nothing else should derive a second time.
 *
 * What these prove is narrow and deliberate: that the filter **narrows** and
 * never **replaces**. A `customerId` that landed in the `where` *instead of* the
 * org and branch clauses would pass any test that only checked "the right
 * customer's rows came back", while quietly reaching another branch's book. So
 * the assertions are about what the WHERE carries, not about the rows.
 *
 * The scope helper itself is proved in `report-scope.spec.ts`; this file proves
 * the service still uses it once a second filter sits beside it.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const BRANCH_A = '44444444-4444-4444-8444-444444444444';
const CUSTOMER = '66666666-6666-4666-8666-666666666666';

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

const META = {
  requestId: '88888888-8888-4888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

function harness() {
  const recorded: { where: Record<string, unknown> }[] = [];

  const prisma = {
    loan: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        recorded.push(args);
        return Promise.resolve([]);
      }),
      count: jest.fn(() => Promise.resolve(0)),
    },
  };

  const overdue = { deriveSummary: jest.fn() };
  const audit = { record: jest.fn(() => Promise.resolve()) };

  const service = new PortfolioReportService(
    prisma as never,
    overdue as never,
    audit as never,
  );

  return { service, recorded };
}

/** The WHERE the first `findMany` was given. */
function whereOf(recorded: { where: Record<string, unknown> }[]) {
  const first = recorded[0];
  if (!first) throw new Error('loan.findMany was not called');
  return first.where;
}

describe('PortfolioReportService — the customerId filter', () => {
  it('narrows to one customer when asked', async () => {
    const { service, recorded } = harness();

    await service.run(actor(), { customerId: CUSTOMER }, META);

    expect(whereOf(recorded).customerId).toBe(CUSTOMER);
  });

  it('does not constrain the customer when not asked', async () => {
    // The report's own screen passes no customer and must keep returning the
    // whole branch's book.
    const { service, recorded } = harness();

    await service.run(actor(), {}, META);

    expect(whereOf(recorded).customerId).toBeUndefined();
  });

  /**
   * The assertion this file exists for.
   *
   * A filter that replaced the scope rather than adding to it would let a Branch
   * Admin read another branch's loans by naming a customer there.
   */
  it('keeps the org and branch clauses alongside the filter', async () => {
    const { service, recorded } = harness();

    await service.run(
      actor({ branchId: BRANCH_A }),
      { customerId: CUSTOMER },
      META,
    );

    expect(whereOf(recorded)).toEqual(
      expect.objectContaining({
        orgId: ORG,
        branchId: BRANCH_A,
        customerId: CUSTOMER,
      }),
    );
  });

  it('still confines a branch caller when no customer is named', async () => {
    const { service, recorded } = harness();

    await service.run(actor({ branchId: BRANCH_A }), {}, META);

    const where = whereOf(recorded);
    expect(where.orgId).toBe(ORG);
    expect(where.branchId).toBe(BRANCH_A);
  });

  it('counts against the same WHERE it lists against', async () => {
    // Rule 35: the totals span the filtered set. A count that dropped the
    // customer filter would report the whole branch's figures beside one
    // borrower's rows.
    const { service, recorded } = harness();

    await service.run(actor(), { customerId: CUSTOMER }, META);

    for (const call of recorded) {
      expect(call.where).toEqual(
        expect.objectContaining({ customerId: CUSTOMER }),
      );
    }
  });
});
