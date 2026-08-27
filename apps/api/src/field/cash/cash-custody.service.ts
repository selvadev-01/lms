import { ConflictException, Injectable } from '@nestjs/common';
import type { AgentCashBalance } from '@lms/types';

import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../auth/auth.service';
import { AuditAction, AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { TransitionTx } from '../../loans/applications/application-transition.service';

/** One collection's worth of cash still sitting with the agent. */
export interface UnclaimedCollection {
  collectionId: string;
  amountPaise: bigint;
  /** DATE-only. Used for the oldest-first ordering and the aging display. */
  collectionDate: Date;
  receiptNumber: string | null;
}

/**
 * The one place that answers "how much cash is this agent holding?".
 *
 * # Why the balance is derived and never stored
 *
 * Rule 24 says the expected balance is derived from posted collections minus
 * posted handovers. Storing a running total would need a second writer, and
 * then a reconciliation between the store and the derivation — which is exactly
 * the bug Scenario 49 describes, one level up.
 *
 * # The claim, and why it is the whole design
 *
 * Cash does not leave the pool by having an amount subtracted from it. It
 * leaves by individual collection rows being **claimed** — their
 * `custodyHandoverId` set — under a guarded `updateMany` that only matches rows
 * where it is still null.
 *
 * That single choice does three things no amount-based design does:
 *
 *  1. **Scenario 49 becomes structural.** Two branch users receiving the same
 *     agent's cash concurrently contend on the same collection rows. The first
 *     transaction locks them; the second blocks, then finds them claimed, and
 *     its update matches fewer rows than it asked for. There is no window in
 *     which both succeed, and no `SELECT ... FOR UPDATE` is needed — the claim
 *     *is* the lock.
 *  2. **Rule 23's traceability is a foreign key**, not a report. "Which
 *     collections' cash is in this handover" is a `WHERE`, and it cannot drift
 *     from the amount, because the amount is the sum of exactly those rows.
 *  3. **The derivation stays honest under reversal.** Releasing a claim is one
 *     `UPDATE`, and the balance moves back on its own.
 *
 * The cost is that a handover amount must equal the sum of some oldest-first
 * prefix of the unclaimed collections. An arbitrary amount would require
 * splitting a collection across two handovers, which needs a per-collection
 * `handed_over_paise` column and a second money identity to keep in step — a
 * substantially larger surface for no scenario the source requires. Scenario 24
 * (partial handover) is satisfied either way: the agent hands over some of their
 * collections and the rest stay in their custody.
 */
@Injectable()
export class CashCustodyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The `where` that defines "cash this agent is still holding".
   *
   * One definition, used by the balance, the unclaimed list and the in-
   * transaction re-derivation alike. Three copies of this predicate is how an
   * agent's balance silently comes to mean three different things.
   *
   * Each clause earns its place:
   *  - `isFieldCollection` — an over-the-counter payment went straight into the
   *    branch drawer and was never in anybody's pocket.
   *  - `paymentMode: 'CASH'` — a UPI payment taken in front of a customer
   *    settles through the bank (Module 12 A12). No custody, no handover.
   *  - `status: 'POSTED'` — Rule 24 says *authoritative* collections. A
   *    `CREATED` or `FAILED` row is not money anybody holds.
   *  - `reversalOfCollectionId: null` — excludes the mirror rows a reversal
   *    writes. Counting them would subtract the cash twice.
   *  - `custodyHandoverId: null` — the claim. Handed-over cash has left.
   */
  private custodyWhere(orgId: string, fieldAgentId: string) {
    return {
      orgId,
      collectorUserId: fieldAgentId,
      isFieldCollection: true,
      paymentMode: 'CASH' as const,
      status: 'POSTED' as const,
      reversalOfCollectionId: null,
      custodyHandoverId: null,
    };
  }

  /**
   * How much cash the agent is holding right now, in paise.
   *
   * Takes a client rather than using `this.prisma` so the handover transaction
   * can re-derive inside itself, against rows it has locked. A balance read
   * outside the transaction and trusted inside it is a balance that can be
   * stale at the only moment it matters.
   */
  async expectedCashPaise(
    client: Pick<PrismaService, 'collection'> | TransitionTx,
    orgId: string,
    fieldAgentId: string,
  ): Promise<bigint> {
    const result = await client.collection.aggregate({
      where: this.custodyWhere(orgId, fieldAgentId),
      _sum: { amountPaise: true },
    });

    // `_sum` is null when no rows matched, which is a zero balance, not an
    // error: an agent who has collected nothing holds nothing.
    return result._sum.amountPaise ?? 0n;
  }

  /**
   * The agent's unclaimed collections, oldest first.
   *
   * The ordering is the appropriation order of custody: the cash that has been
   * out of the branch longest is handed over first. `collectionDate` then
   * `createdAt` — the date alone is not a total order, and an unstable order
   * would make the prefix sums differ between the readiness read and the
   * handover, so an amount the form offered could be refused on submit.
   */
  async unclaimedCollections(
    client: Pick<PrismaService, 'collection'> | TransitionTx,
    orgId: string,
    fieldAgentId: string,
  ): Promise<UnclaimedCollection[]> {
    const rows = await client.collection.findMany({
      where: this.custodyWhere(orgId, fieldAgentId),
      select: {
        collectionId: true,
        amountPaise: true,
        collectionDate: true,
        receiptNumber: true,
      },
      orderBy: [{ collectionDate: 'asc' }, { createdAt: 'asc' }],
    });

    return rows;
  }

  /**
   * Which collections make up a handover of exactly this amount.
   *
   * Pure, and separately tested: the arithmetic that decides which rupees move
   * should not need a database to exercise.
   *
   * Returns `null` when no oldest-first prefix sums to the amount. That is a
   * refusal, not a best effort — handing over "about" an amount would break the
   * identity between the handover total and the rows it claims, and that
   * identity is what makes the balance derivable at all.
   */
  selectCollectionsFor(
    amountPaise: bigint,
    unclaimed: readonly UnclaimedCollection[],
  ): string[] | null {
    let running = 0n;
    const chosen: string[] = [];

    for (const row of unclaimed) {
      running += row.amountPaise;
      chosen.push(row.collectionId);

      if (running === amountPaise) return chosen;
      // Past the target without hitting it exactly: no longer prefix can match,
      // because every remaining amount is positive.
      if (running > amountPaise) return null;
    }

    return null;
  }

  /**
   * The running prefix sums — every amount a handover may legitimately name.
   *
   * Handed to the form so it can offer the valid amounts rather than let an
   * agent type one that will be refused on submit.
   */
  handoverableAmounts(unclaimed: readonly UnclaimedCollection[]): bigint[] {
    const amounts: bigint[] = [];
    let running = 0n;

    for (const row of unclaimed) {
      running += row.amountPaise;
      amounts.push(running);
    }

    return amounts;
  }

  /**
   * Claims these collections for a handover, or refuses.
   *
   * **The concurrency guard of the entire module.** `custodyHandoverId: null`
   * in the `where` is what makes a second concurrent claim match zero rows: the
   * first transaction holds the row locks, the second waits, and then finds the
   * column no longer null. A short count means somebody else got there first.
   *
   * Must be called inside the handover transaction. Called outside one, the
   * claim would commit while a later step could still fail, stranding the cash.
   */
  async claim(
    tx: TransitionTx,
    orgId: string,
    collectionIds: readonly string[],
    handoverId: string,
  ): Promise<void> {
    if (collectionIds.length === 0) {
      throw new ConflictException(
        'This handover names no collections. Nothing was received.',
      );
    }

    const claimed = await tx.collection.updateMany({
      where: {
        orgId,
        collectionId: { in: [...collectionIds] },
        custodyHandoverId: null,
      },
      data: { custodyHandoverId: handoverId },
    });

    if (claimed.count !== collectionIds.length) {
      throw new ConflictException({
        message:
          'Some of this cash has already been handed over. Reload the handover and try again.',
        code: 'CASH_ALREADY_HANDED_OVER',
      });
    }
  }

  /**
   * Releases a handover's claim, returning the cash to the agent's balance.
   *
   * Used by the reversal path. The collections themselves are untouched
   * otherwise — their amounts, receipts and journal links are exactly what they
   * were, which is what makes this a custody correction rather than an edit of
   * a posted collection.
   */
  async release(
    tx: TransitionTx,
    orgId: string,
    handoverId: string,
  ): Promise<number> {
    const released = await tx.collection.updateMany({
      where: { orgId, custodyHandoverId: handoverId },
      data: { custodyHandoverId: null },
    });

    return released.count;
  }

  /**
   * Every agent in the caller's scope who is holding cash.
   *
   * The branch spread, not a client filter: a Branch Admin sees their own
   * branch because of that line and nothing else (Scenario 45). A Super Admin,
   * whose `branchId` is null, sees the organization.
   *
   * Agents with a zero balance are omitted. This is a work list — "who owes the
   * branch money" — and a page of zeroes buries the agents who do.
   */
  async agentBalances(
    actor: AuthContext,
    meta: RequestMeta,
  ): Promise<AgentCashBalance[]> {
    const grouped = await this.prisma.collection.groupBy({
      by: ['collectorUserId'],
      where: {
        orgId: actor.orgId,
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
        isFieldCollection: true,
        paymentMode: 'CASH',
        status: 'POSTED',
        reversalOfCollectionId: null,
        custodyHandoverId: null,
      },
      _sum: { amountPaise: true },
      _count: { _all: true },
      _min: { collectionDate: true },
    });

    if (grouped.length === 0) return [];

    const agents = await this.prisma.user.findMany({
      where: {
        orgId: actor.orgId,
        userId: { in: grouped.map((row) => row.collectorUserId) },
      },
      select: {
        userId: true,
        name: true,
        employeeCode: true,
        branchId: true,
        branch: { select: { name: true } },
      },
    });

    const agentById = new Map(agents.map((agent) => [agent.userId, agent]));

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CASH_BALANCE_VIEWED,
      entityType: 'CASH_CUSTODY',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { agentCount: grouped.length },
    });

    return grouped
      .map((row) => {
        const agent = agentById.get(row.collectorUserId);
        return {
          fieldAgentId: row.collectorUserId,
          agentName: agent?.name ?? 'Unknown',
          ...(agent?.employeeCode ? { employeeCode: agent.employeeCode } : {}),
          branchId: agent?.branchId ?? '',
          ...(agent?.branch?.name ? { branchName: agent.branch.name } : {}),
          expectedCashPaise: (row._sum.amountPaise ?? 0n).toString(),
          unclaimedCollectionCount: row._count._all,
          ...(row._min.collectionDate
            ? {
                oldestUnclaimedDate: row._min.collectionDate
                  .toISOString()
                  .slice(0, 10),
              }
            : {}),
        };
      })
      .sort((a, b) => a.agentName.localeCompare(b.agentName));
  }
}
