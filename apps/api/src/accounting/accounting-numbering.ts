import type { TransitionTx } from '../loans/applications/application-transition.service';

/**
 * The organization's journal entry sequence.
 *
 * # Why this is a free function rather than a service
 *
 * Two callers need it and they live in different Nest modules: `LedgerService`
 * (Module 09/11, inside `LoansModule`) allocates a number when a source
 * transaction posts, and `JournalPostingService` (Module 14) allocates one when
 * a person posts a manual journal. Making it injectable would force
 * `AccountingModule` to import `LoansModule` for a pure function over `tx`, or
 * force a second copy — and a second copy of a sequence allocator is how two
 * numbering schemes quietly appear in one ledger.
 *
 * # One sequence, not one per journal type
 *
 * Manual journals share the `JE-` series with source-posted ones. A separate
 * `MJ-` series would make "is this reference already taken" depend on which
 * series you were in, and `@@unique([orgId, entryNumber])` already arbitrates
 * across the whole organization.
 *
 * # Gapless is not promised
 *
 * The number is allocated inside the caller's transaction, so a posting that
 * rolls back consumes nothing — but two concurrent postings both read the same
 * maximum, and the loser's unique-index violation rolls its whole transaction
 * back rather than retrying. That trades gaplessness for atomicity, which is
 * the same trade `ReceiptService` documents and makes for the same reason: a
 * gap in a sequence is an accounting curiosity, whereas a journal that posted
 * under a number another journal also holds is a corruption.
 */
export async function nextEntryNumber(
  tx: Pick<TransitionTx, 'journalEntry'>,
  orgId: string,
): Promise<string> {
  const rows = await tx.journalEntry.findMany({
    where: { orgId, entryNumber: { startsWith: 'JE-' } },
    select: { entryNumber: true },
  });

  // The numeric maximum, never a lexical sort: sorting as text ranks `JE-ZZ04`
  // above `JE-000007` and then proposes a number that already exists. The
  // regex is what excludes any hand-inserted reference that merely starts
  // `JE-` from being parsed as a sequence position.
  let highest = 0;
  for (const row of rows) {
    const match = /^JE-(\d+)$/.exec(row.entryNumber);
    if (!match?.[1]) continue;
    const value = Number.parseInt(match[1], 10);
    if (value > highest) highest = value;
  }

  return `JE-${String(highest + 1).padStart(6, '0')}`;
}
