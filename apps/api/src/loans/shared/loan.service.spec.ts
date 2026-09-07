import { AuditService } from '../../audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { LoanService } from './loan.service';

/**
 * `LoanService.list` — the loan list behind the customer portfolio.
 *
 * The assertions here are all about *scope*. A list endpoint is the classic way
 * a branch boundary springs a leak: the detail route is written carefully and
 * the list beside it quietly returns everything, because nothing in a
 * happy-path test distinguishes "the caller's loans" from "all the loans".
 *
 * So these do not check that rows come back. They check what the WHERE clause
 * carries, which is the only thing standing between a Branch Admin and another
 * branch's book.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const BRANCH_ID = '33333333-3333-3333-3333-333333333333';
const CUSTOMER_ID = '44444444-4444-4444-4444-444444444444';

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: '55555555-5555-5555-5555-555555555555',
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['loans.view'],
    ...overrides,
  };
}

function harness() {
  const findMany = jest.fn(() => Promise.resolve([]));

  const prisma = {
    loan: { findMany },
  } as unknown as PrismaService;

  const audit = { record: jest.fn(() => Promise.resolve()) };

  return {
    service: new LoanService(prisma, audit as unknown as AuditService),
    findMany,
    audit,
  };
}

type FindManyArgs = { where: Record<string, unknown> };

/**
 * The WHERE clause the service built.
 *
 * `jest.Mock`'s `calls` is `any`, so the argument list is narrowed once here
 * rather than cast at each of the seven assertions below.
 */
function whereOf(findMany: jest.Mock): Record<string, unknown> {
  const calls = findMany.mock.calls as unknown as FindManyArgs[][];
  const call = calls[0]?.[0];
  if (!call) throw new Error('findMany was not called');
  return call.where;
}

describe('LoanService.list', () => {
  it('always filters by the caller organization', async () => {
    // The tenant boundary. Non-negotiable, and never taken from the request.
    const { service, findMany } = harness();

    await service.list(actor(), {});

    expect(whereOf(findMany).orgId).toBe(ORG_ID);
  });

  it('confines a branch-scoped caller to their own branch', async () => {
    // The assertion that matters most: without this clause a Branch Admin would
    // see every branch's loans for a customer, which the loan detail route
    // refuses them one at a time.
    const { service, findMany } = harness();

    await service.list(actor({ branchId: BRANCH_ID }), {});

    expect(whereOf(findMany).branchId).toBe(BRANCH_ID);
  });

  it('does not constrain the branch for an organization-wide caller', async () => {
    // A Super Admin carries a null branchId and reaches the whole organization —
    // the same spread `findInScope` uses, so the two cannot disagree.
    const { service, findMany } = harness();

    await service.list(actor(), {});

    expect(whereOf(findMany).branchId).toBeUndefined();
  });

  it('narrows to one customer when asked', async () => {
    const { service, findMany } = harness();

    await service.list(actor(), { customerId: CUSTOMER_ID });

    expect(whereOf(findMany).customerId).toBe(CUSTOMER_ID);
  });

  it('applies the customer filter on top of scope, never instead of it', async () => {
    // A filter must not be able to widen what a caller sees. Both clauses have
    // to survive together.
    const { service, findMany } = harness();

    await service.list(actor({ branchId: BRANCH_ID }), {
      customerId: CUSTOMER_ID,
    });

    const where = whereOf(findMany);
    expect(where).toEqual(
      expect.objectContaining({
        orgId: ORG_ID,
        branchId: BRANCH_ID,
        customerId: CUSTOMER_ID,
      }),
    );
  });

  it('cannot be pointed at another organization', async () => {
    // `orgId` comes from the session, so an actor from another tenant queries
    // their own rows — there is no request field that could override it.
    const { service, findMany } = harness();

    await service.list(actor({ orgId: OTHER_ORG_ID }), {});

    expect(whereOf(findMany).orgId).toBe(OTHER_ORG_ID);
  });

  it('narrows to one loan when asked', async () => {
    // The loan detail page's read. It exists because the list is capped at 100
    // newest, so filtering by customer alone silently misses an older loan —
    // which showed up as the page 404ing on a loan that plainly existed.
    const { service, findMany } = harness();

    await service.list(actor(), { loanId: 'a-loan-id' });

    expect(whereOf(findMany).loanId).toBe('a-loan-id');
  });

  it('caps how many rows a single read returns', async () => {
    // The portfolio renders every row it is given. Uncapped, a long-standing
    // borrower's page grows until it stops loading — a seeded fixture already
    // has a customer with over 1,600 loans.
    const { service, findMany } = harness();

    await service.list(actor(), {});

    const args = (
      findMany.mock.calls as unknown as { take?: number }[][]
    )[0]?.[0];
    expect(args?.take).toBe(100);
  });

  it('writes no audit row for a list read', async () => {
    // Following MasterDataService: auditing every list render buries the
    // mutations that matter. Reaching an individual loan still audits a denial.
    const { service, audit } = harness();

    await service.list(actor(), {});

    expect(audit.record).not.toHaveBeenCalled();
  });
});
