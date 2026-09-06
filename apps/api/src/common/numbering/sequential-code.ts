/**
 * The org-scoped `PREFIX + zero-padded sequence` allocator.
 *
 * Two entity codes share this shape — `CUST001` for customers and `EMP001` for
 * employees — and both were minting it with a private copy of the same reduce.
 * The duplication mattered: the customer copy carries a hard-won correctness fix
 * (see below) that the employee code, written later, would have had to
 * rediscover the same way. One implementation, one place for that fix to live.
 *
 * Distinct from `recovery-numbering.ts` / `cash-numbering.ts`, which allocate a
 * *per-branch* number (`RC-<BRANCH>-000001`). Those sequences are scoped by
 * branch code and formatted with a separator; these are scoped by organization
 * and have no infix at all. Folding both into one helper would need a parameter
 * for every difference and would make neither call site readable, so this covers
 * the org-scoped shape only.
 *
 * ## Two invariants, both load-bearing
 *
 * **1. The maximum is computed numerically, never by string order.** An earlier
 * customer version took the first row of `orderBy: { customerCode: 'desc' }` and
 * parsed it, which broke on any code whose suffix is not purely numeric:
 * `CUSTZZ04` sorts above `CUST007` because `Z` > `0`, `parseInt('ZZ04')` is
 * `NaN`, and the `NaN` fallback then re-proposed `CUST001` — a code that already
 * existed. The result was a unique-constraint violation surfacing as an opaque
 * 503 on every create. Codes with non-numeric suffixes are real: the e2e suite
 * mints `CUSTZZ*` fixtures. So every candidate is read and only the ones
 * matching `PREFIX<digits>` exactly are considered; anything else is skipped
 * rather than coerced, because it is not part of this sequence.
 *
 * **2. Allocation is not enforcement.** The read happens inside the caller's
 * transaction so two concurrent creates cannot both observe the same maximum,
 * but the unique index on `(orgId, <column>)` is the real guarantee. Two racing
 * creates may still propose the same code; one commits and the other must
 * translate P2002 into a 409 and let the caller retry. **Atomicity over
 * guaranteed gaplessness** — a code is never issued for a row that did not
 * commit.
 */

/** Escapes a prefix for safe use inside a RegExp. */
function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The next code in an org-scoped sequence, computed numerically.
 *
 * Synchronous and pure: the database read belongs to the caller, so the
 * arithmetic that decides the code can be reasoned about — and tested — without
 * one. This mirrors `nextNumber` in `recovery-numbering.ts` deliberately; the
 * two are the same idea at different scopes.
 */
export function nextSequentialCode(
  existing: readonly string[],
  prefix: string,
  padding: number,
): string {
  const pattern = new RegExp(`^${escapeForPattern(prefix)}(\\d+)$`);

  let highest = 0;
  for (const candidate of existing) {
    const match = pattern.exec(candidate);
    if (!match?.[1]) continue;
    const sequence = Number.parseInt(match[1], 10);
    if (Number.isFinite(sequence) && sequence > highest) highest = sequence;
  }

  return `${prefix}${String(highest + 1).padStart(padding, '0')}`;
}

/**
 * Reads every candidate code for an organization and allocates the next one.
 *
 * The delegate is passed as a narrow structural type rather than a Prisma model
 * name, so a caller hands in `tx.customer` or `tx.user` and nothing wider is
 * reachable from here. `column` names the code field on that table.
 *
 * The candidate set is bounded by rows per organization and this runs once per
 * creation, which is what makes reading them all rather than sorting in the
 * database an acceptable trade for invariant 1 above.
 */
export async function allocateSequentialCode(
  delegate: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    }) => Promise<Array<Record<string, unknown>>>;
  },
  options: {
    orgId: string;
    column: string;
    prefix: string;
    padding: number;
  },
): Promise<string> {
  const { orgId, column, prefix, padding } = options;

  const rows = await delegate.findMany({
    where: { orgId, [column]: { startsWith: prefix } },
    select: { [column]: true },
  });

  const existing = rows.flatMap((row) => {
    const value = row[column];
    return typeof value === 'string' ? [value] : [];
  });

  return nextSequentialCode(existing, prefix, padding);
}
