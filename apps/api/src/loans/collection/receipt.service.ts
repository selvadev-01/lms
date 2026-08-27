import { Injectable } from '@nestjs/common';

import type { TransitionTx } from '../applications/application-transition.service';

/**
 * Receipt numbering for collections.
 *
 * # The format, and why per branch
 *
 * ```
 * RCP-<BRANCH CODE>-000001
 * ```
 *
 * The source asks for numbering that is "gapless within the configured
 * branch/agent sequence" and leaves the choice open (Open Questions 2, 3). Per
 * branch is the answer the rest of the system was already built for:
 * `branchCodeSchema` restricts a branch code to `[A-Za-z0-9_-]` with the stated
 * reason that "codes appear in receipt numbers", and `updateBranchSchema` omits
 * `code` entirely so that a rename cannot retroactively change what an issued
 * receipt refers to. Both of those exist for this.
 *
 * Per agent was the alternative — it is what a physical receipt book implies —
 * but an agent moving between branches would then carry their sequence with
 * them, and a receipt would no longer say where the money was taken.
 *
 * # Gaplessness, honestly
 *
 * Rule 18 asks for gapless numbering. Scenario 21 asks that a failed posting
 * leave nothing behind. **Both cannot hold**, and this implementation chooses
 * uniqueness and atomicity over gaplessness.
 *
 * A number is allocated inside the posting transaction, so no number is ever
 * issued for a posting that did not commit. If that transaction rolls back, its
 * number is consumed and abandoned — a gap. The alternative, allocating from a
 * committed counter before posting, produces gaps on every failure *and* hands
 * out numbers for money that never moved. Gaps that appear only on genuine
 * failures, and are explained by an audit record, are the more auditable
 * outcome. The source's own Open Questions 4-6 acknowledge this is unresolved.
 *
 * # The scan is racy, and the index is the real guarantee
 *
 * Under READ COMMITTED two concurrent postings in the same branch can compute
 * the same next number. The `(org_id, receipt_number)` unique index on both
 * `collections` and `receipts` arbitrates: the loser's whole transaction rolls
 * back, and its client retries with the same idempotency key, which then
 * replays. Exactly the reasoning `nextEntryNumber` and `nextLoanNumber`
 * document for `JE-` and `LN-`.
 */
@Injectable()
export class ReceiptService {
  /**
   * Allocates the next receipt number for a branch.
   *
   * Numeric maximum over that branch's `RCP-<code>-%` rows, never a lexical
   * sort — a lexical sort would rank `RCP-BR001-ZZ04` above
   * `RCP-BR001-000007` and then propose a number that already exists.
   *
   * Must be called inside the posting transaction. Reading through `tx` is what
   * makes it see rows this transaction has already written.
   */
  async nextReceiptNumber(
    tx: Pick<TransitionTx, 'receipt'>,
    orgId: string,
    branchCode: string,
  ): Promise<string> {
    const prefix = `RCP-${branchCode}-`;

    const rows = await tx.receipt.findMany({
      where: { orgId, receiptNumber: { startsWith: prefix } },
      select: { receiptNumber: true },
    });

    // Escaped because a branch code may legitimately contain `-`, which is
    // inert here but would be a character class edge if the code ever widened.
    const pattern = new RegExp(
      `^RCP-${branchCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`,
    );

    let highest = 0;
    for (const row of rows) {
      const match = pattern.exec(row.receiptNumber);
      if (!match?.[1]) continue;
      const value = Number.parseInt(match[1], 10);
      if (value > highest) highest = value;
    }

    return `${prefix}${String(highest + 1).padStart(6, '0')}`;
  }
}
