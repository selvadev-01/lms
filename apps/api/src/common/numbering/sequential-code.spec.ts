import { allocateSequentialCode, nextSequentialCode } from './sequential-code';

/**
 * The allocator shared by customer (`CUST*`) and employee (`EMP*`) codes.
 *
 * These tests exist mainly to pin invariant 1 from the module doc — the maximum
 * is numeric, never lexical. That rule was learned from a production bug in the
 * customer path, and sharing the implementation means it is now one regression
 * away from breaking both modules at once.
 */
describe('nextSequentialCode', () => {
  it('starts the sequence when nothing exists', () => {
    expect(nextSequentialCode([], 'EMP', 3)).toBe('EMP001');
  });

  it('continues from the highest existing code', () => {
    expect(nextSequentialCode(['EMP001', 'EMP007'], 'EMP', 3)).toBe('EMP008');
  });

  /**
   * The regression that produced an opaque 503 on every customer create.
   *
   * Lexically `CUST009` ranks above `CUST010`, so a string max would propose
   * `CUST010` — a code that already exists — and the insert would die on the
   * unique index.
   */
  it('takes the numeric maximum, not the lexical one', () => {
    expect(nextSequentialCode(['CUST009', 'CUST010'], 'CUST', 3)).toBe(
      'CUST011',
    );
  });

  /**
   * The other half of that bug. `CUSTZZ04` sorts above every numeric code,
   * `parseInt('ZZ04')` is `NaN`, and the fallback re-proposed `CUST001`. Codes
   * like this are real — the e2e suite mints `CUSTZZ*` fixtures.
   */
  it('ignores codes whose suffix is not purely numeric', () => {
    expect(nextSequentialCode(['CUST007', 'CUSTZZ04'], 'CUST', 3)).toBe(
      'CUST008',
    );
  });

  it('keeps counting past the padding width rather than truncating', () => {
    expect(nextSequentialCode(['EMP999'], 'EMP', 3)).toBe('EMP1000');
  });

  it('does not treat a longer prefix as part of this sequence', () => {
    // `EMPX010` starts with `EMP` so the database read returns it, but it is
    // not a member of the `EMP<digits>` sequence and must not set the maximum.
    expect(nextSequentialCode(['EMP002', 'EMPX010'], 'EMP', 3)).toBe('EMP003');
  });
});

describe('allocateSequentialCode', () => {
  it('scopes the read to the organization and the prefix', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { employeeCode: 'EMP004' },
        { employeeCode: 'EMP002' },
      ]);

    const code = await allocateSequentialCode(
      { findMany },
      {
        orgId: 'org-1',
        column: 'employeeCode',
        prefix: 'EMP',
        padding: 3,
      },
    );

    expect(code).toBe('EMP005');
    expect(findMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1', employeeCode: { startsWith: 'EMP' } },
      select: { employeeCode: true },
    });
  });

  it('reads the column it was told to, not a fixed one', async () => {
    const findMany = jest.fn().mockResolvedValue([{ customerCode: 'CUST012' }]);

    const code = await allocateSequentialCode(
      { findMany },
      {
        orgId: 'org-1',
        column: 'customerCode',
        prefix: 'CUST',
        padding: 3,
      },
    );

    expect(code).toBe('CUST013');
  });

  it('skips rows whose code is absent rather than counting them', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ employeeCode: null }, { employeeCode: 'EMP001' }]);

    await expect(
      allocateSequentialCode(
        { findMany },
        { orgId: 'org-1', column: 'employeeCode', prefix: 'EMP', padding: 3 },
      ),
    ).resolves.toBe('EMP002');
  });
});
