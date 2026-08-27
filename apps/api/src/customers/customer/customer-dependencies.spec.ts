import {
  CUSTOMER_DEPENDENCIES,
  summarizeCustomerBlockers,
} from './customer-dependencies';

/**
 * The customer delete guard (Module 04, Rule 23, Scenario 37).
 *
 * The table itself is the thing under test. What it must get right is the
 * distinction the story draws: financial history involving other parties makes a
 * customer permanent (Rule 22), while the customer's own record — addresses,
 * documents, KYC, guarantors — is theirs and should disappear with them.
 *
 * That distinction is expressed in the schema as `Restrict` versus `Cascade`, so
 * a cascading relation appearing in this list would block deletes the database
 * itself permits, and a `Restrict` relation missing from it would produce a
 * foreign-key error surfacing as an unrelated 503.
 */

describe('CUSTOMER_DEPENDENCIES', () => {
  it('names every entity that must block a delete', () => {
    expect(CUSTOMER_DEPENDENCIES.map((d) => d.entity).sort()).toEqual([
      'collection',
      'fieldAssignmentCustomer',
      'fieldVisit',
      'loan',
      'loanApplication',
      'notification',
    ]);
  });

  /**
   * These cascade in the schema: they are the customer's own record rather than
   * history shared with anyone else. Listing one here would make a customer with
   * a single uploaded document permanently undeletable, which is not what
   * Rule 23 asks for.
   */
  it.each([
    'customerAddress',
    'customerDocument',
    'customerKyc',
    'customerMobileVerification',
    'guarantor',
  ])('does not treat %s as a blocker', (entity) => {
    expect(CUSTOMER_DEPENDENCIES.map((d) => d.entity)).not.toContain(entity);
  });

  /**
   * `Notification` references the customer through `recipientCustomerId`.
   *
   * A wrong column name here does not fail to compile — Prisma throws at
   * runtime, and `AllExceptionsFilter` renders it as a 503 that says nothing
   * about the delete guard.
   */
  it('names the correct foreign key for each entity', () => {
    const fields = Object.fromEntries(
      CUSTOMER_DEPENDENCIES.map((d) => [d.entity, d.field]),
    );

    expect(fields.notification).toBe('recipientCustomerId');
    expect(fields.loan).toBe('customerId');
    expect(fields.collection).toBe('customerId');
  });

  it('gives every entry a human-readable label', () => {
    expect(CUSTOMER_DEPENDENCIES.every((d) => d.label.trim().length > 0)).toBe(
      true,
    );
  });
});

describe('summarizeCustomerBlockers', () => {
  it('returns nothing when the customer has no history', () => {
    expect(summarizeCustomerBlockers({})).toEqual([]);
  });

  // An empty result is what the caller reads as "the delete may proceed", so a
  // zero must not appear as a blocker.
  it('drops zero counts rather than reporting them', () => {
    expect(summarizeCustomerBlockers({ loan: 0, collection: 0 })).toEqual([]);
  });

  it('reports only the categories actually in the way', () => {
    expect(summarizeCustomerBlockers({ loan: 2, collection: 0 })).toEqual([
      { entity: 'loan', label: 'Loans', count: 2 },
    ]);
  });

  it('reports several blockers at once', () => {
    const blockers = summarizeCustomerBlockers({ loan: 1, collection: 3 });

    expect(blockers).toHaveLength(2);
    expect(blockers.map((b) => b.count)).toEqual([1, 3]);
  });

  it('ignores a count for an entity that is not a dependency', () => {
    expect(summarizeCustomerBlockers({ customerDocument: 5 })).toEqual([]);
  });

  // The order is the table's, so the most consequential blocker (a loan) is
  // reported first rather than in whatever order the counts arrived.
  it('preserves the declared order', () => {
    const blockers = summarizeCustomerBlockers({
      notification: 1,
      loan: 1,
    });

    expect(blockers[0].entity).toBe('loan');
  });
});
