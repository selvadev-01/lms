import { ReceiptService } from './receipt.service';

/**
 * The load-bearing property here is the numeric maximum.
 *
 * A lexical sort ranks `RCP-BR001-ZZ04` above `RCP-BR001-000007` and then
 * proposes `RCP-BR001-000005`, which already exists — the unique index fails
 * the whole posting at the worst possible moment. The same trap
 * `nextEntryNumber` and `nextLoanNumber` both document.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';

function txWith(receiptNumbers: string[]) {
  return {
    receipt: {
      findMany: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { receiptNumber: { startsWith: string } } }) =>
            Promise.resolve(
              receiptNumbers
                .filter((number) =>
                  number.startsWith(where.receiptNumber.startsWith),
                )
                .map((receiptNumber) => ({ receiptNumber })),
            ),
        ),
    },
  } as never;
}

describe('ReceiptService.nextReceiptNumber', () => {
  const service = new ReceiptService();

  it('issues the first number for a branch that has none', () => {
    return expect(
      service.nextReceiptNumber(txWith([]), ORG_ID, 'BR001'),
    ).resolves.toBe('RCP-BR001-000001');
  });

  it('takes the numeric maximum, not the lexical one', async () => {
    const next = await service.nextReceiptNumber(
      txWith(['RCP-BR001-000009', 'RCP-BR001-000010', 'RCP-BR001-000002']),
      ORG_ID,
      'BR001',
    );

    // A lexical sort would pick `000009` as the highest and propose `000010`,
    // which already exists.
    expect(next).toBe('RCP-BR001-000011');
  });

  it('ignores a number that does not match the exact shape', async () => {
    const next = await service.nextReceiptNumber(
      txWith(['RCP-BR001-000007', 'RCP-BR001-ZZ04', 'RCP-BR001-']),
      ORG_ID,
      'BR001',
    );

    expect(next).toBe('RCP-BR001-000008');
  });

  it('keeps each branch on its own sequence', async () => {
    const receipts = [
      'RCP-BR001-000001',
      'RCP-BR001-000002',
      'RCP-BR002-000001',
    ];

    // BR002 has one receipt, so its next is 2 — it must not inherit BR001's
    // higher count, which is the whole point of a per-branch sequence.
    await expect(
      service.nextReceiptNumber(txWith(receipts), ORG_ID, 'BR002'),
    ).resolves.toBe('RCP-BR002-000002');

    await expect(
      service.nextReceiptNumber(txWith(receipts), ORG_ID, 'BR001'),
    ).resolves.toBe('RCP-BR001-000003');
  });

  it('does not let one branch code prefix-match another', async () => {
    // `BR1` must not see `BR10`'s receipts. The regex anchors on the full
    // prefix and the trailing digits, so it cannot.
    const next = await service.nextReceiptNumber(
      txWith(['RCP-BR10-000005']),
      ORG_ID,
      'BR1',
    );

    expect(next).toBe('RCP-BR1-000001');
  });

  it('pads to six digits and keeps counting past them', async () => {
    await expect(
      service.nextReceiptNumber(txWith(['RCP-BR001-000099']), ORG_ID, 'BR001'),
    ).resolves.toBe('RCP-BR001-000100');

    await expect(
      service.nextReceiptNumber(txWith(['RCP-BR001-999999']), ORG_ID, 'BR001'),
    ).resolves.toBe('RCP-BR001-1000000');
  });

  it('scopes the query to the branch prefix rather than filtering everything', async () => {
    const tx = txWith(['RCP-BR001-000001']);

    await service.nextReceiptNumber(tx, ORG_ID, 'BR001');

    // Reading every receipt in the organization and filtering in memory would
    // grow linearly with the whole book rather than one branch's.
    expect(
      (tx as unknown as { receipt: { findMany: jest.Mock } }).receipt.findMany,
    ).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, receiptNumber: { startsWith: 'RCP-BR001-' } },
      select: { receiptNumber: true },
    });
  });
});
