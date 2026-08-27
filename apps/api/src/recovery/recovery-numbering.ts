import type { PrismaService } from '../prisma/prisma.service';

/**
 * The per-branch sequence for recovery cases.
 *
 * The same trade `cash-numbering.ts` and `ReceiptService` document, for the
 * same reasons: the maximum is read inside the creating transaction, incremented
 * and left for the `@@unique([orgId, caseNumber])` index to arbitrate. Two
 * concurrent opens propose the same number, one commits and the other rolls
 * back and retries. **Atomicity over guaranteed gaplessness** — a number is
 * never issued for a case that did not commit.
 *
 * The maximum is computed **numerically**, never by sorting strings: a lexical
 * max ranks `RC-BR001-000009` above `RC-BR001-000010` and would propose a
 * number that already exists.
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
export function nextNumber(
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

/**
 * `RC-<BRANCH CODE>-000001`. Minted inside the creating transaction.
 *
 * Typed against `PrismaService` rather than `TransitionTx`. That type is a
 * deliberately narrow allowlist of the tables a *loan application transition*
 * may touch, and its own comment says widening it must be a decision rather
 * than a convenience — adding `recoveryCase` to it would turn it into the
 * general-purpose escape hatch it exists not to be. A recovery case is not part
 * of an application transition, so it takes the delegate it actually needs.
 */
export async function nextRecoveryCaseNumber(
  tx: Pick<PrismaService, 'recoveryCase'>,
  orgId: string,
  branchCode: string,
): Promise<string> {
  const prefix = 'RC-';
  const rows = await tx.recoveryCase.findMany({
    where: { orgId, caseNumber: { startsWith: `${prefix}${branchCode}-` } },
    select: { caseNumber: true },
  });

  return nextNumber(
    rows.flatMap((row) => (row.caseNumber ? [row.caseNumber] : [])),
    prefix,
    branchCode,
  );
}
