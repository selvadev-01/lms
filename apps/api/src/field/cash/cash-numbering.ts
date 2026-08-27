import type { TransitionTx } from '../../loans/applications/application-transition.service';

/**
 * Per-branch sequences for cash handovers and reconciliations.
 *
 * # Why a scan and not a sequence table
 *
 * Exactly the trade `ReceiptService` documents, and for the same reason. A
 * Postgres sequence is gapless only if nothing rolls back, and everything here
 * runs inside a transaction that can. A counter row would serialise every
 * handover in a branch behind one lock.
 *
 * So: read the current maximum inside the posting transaction, add one, and let
 * the `@@unique([orgId, handoverNumber])` index arbitrate. Two concurrent
 * creates propose the same number; one commits, the other's whole transaction
 * rolls back and it retries. **Atomicity is chosen over guaranteed
 * gaplessness** — a number is never issued for a handover that did not commit,
 * and a gap is a question an operator can answer while a duplicate number is
 * not.
 *
 * # The lexical trap
 *
 * The maximum is computed **numerically**, never by sorting strings. A lexical
 * max ranks `CH-BR001-000009` above `CH-BR001-000010` and would propose a
 * number that already exists — the same trap `nextSanctionNumber` and
 * `nextReceiptNumber` both document.
 */

/** Escapes a branch code for safe use inside a RegExp. */
function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The next number in a sequence, computed numerically.
 *
 * Synchronous and pure: the database read belongs to the caller, so the
 * arithmetic that decides the number can be reasoned about — and tested —
 * without one.
 */
function nextNumber(
  existing: readonly string[],
  prefix: string,
  branchCode: string,
): string {
  const pattern = new RegExp(
    `^${escapeForPattern(prefix)}${escapeForPattern(branchCode)}-(\\d+)$`,
  );

  let highest = 0;
  for (const candidate of existing) {
    const match = pattern.exec(candidate);
    if (!match?.[1]) continue;
    const sequence = Number.parseInt(match[1], 10);
    if (sequence > highest) highest = sequence;
  }

  return `${prefix}${branchCode}-${String(highest + 1).padStart(6, '0')}`;
}

/** `CH-<BRANCH CODE>-000001`. Minted inside the creating transaction. */
export async function nextHandoverNumber(
  tx: Pick<TransitionTx, 'cashHandover'>,
  orgId: string,
  branchCode: string,
): Promise<string> {
  const prefix = 'CH-';
  const rows = await tx.cashHandover.findMany({
    where: { orgId, handoverNumber: { startsWith: `${prefix}${branchCode}-` } },
    select: { handoverNumber: true },
  });

  return nextNumber(
    rows.map((row) => row.handoverNumber),
    prefix,
    branchCode,
  );
}

/** `CR-<BRANCH CODE>-000001`. Minted inside the creating transaction. */
export async function nextReconciliationNumber(
  tx: Pick<TransitionTx, 'cashReconciliation'>,
  orgId: string,
  branchCode: string,
): Promise<string> {
  const prefix = 'CR-';
  const rows = await tx.cashReconciliation.findMany({
    where: {
      orgId,
      reconciliationNumber: { startsWith: `${prefix}${branchCode}-` },
    },
    select: { reconciliationNumber: true },
  });

  return nextNumber(
    rows.map((row) => row.reconciliationNumber),
    prefix,
    branchCode,
  );
}
