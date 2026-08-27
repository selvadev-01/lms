import { ConflictException } from '@nestjs/common';

import type { AuditService } from '../../audit/audit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TransitionTx } from '../../loans/applications/application-transition.service';
import {
  CashCustodyService,
  type UnclaimedCollection,
} from './cash-custody.service';

/**
 * Module 12 — the cash custody derivation and claim.
 *
 * Two things here are load-bearing beyond ordinary coverage:
 *
 * 1. **The prefix rule refuses rather than approximates.** A handover amount
 *    that matches no oldest-first prefix is rejected. Handing over "about" an
 *    amount would break the identity between a handover's total and the rows it
 *    claims — and that identity is the only reason the balance is derivable.
 * 2. **A short claim count is a conflict, not a partial success.** This is
 *    Scenario 49. If `claim` ever returned quietly after matching fewer rows
 *    than it asked for, two concurrent receives would both post a journal and
 *    the same cash would be counted twice.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const AGENT_ID = '99999999-9999-9999-9999-999999999999';
const HANDOVER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function service(): CashCustodyService {
  return new CashCustodyService(
    {} as unknown as PrismaService,
    {} as unknown as AuditService,
  );
}

/** Collections in the order the service reads them: oldest first. */
function unclaimed(
  ...amounts: readonly bigint[]
): readonly UnclaimedCollection[] {
  return amounts.map((amountPaise, index) => ({
    collectionId: `col-${index + 1}`,
    amountPaise,
    collectionDate: new Date(`2026-08-${String(index + 1).padStart(2, '0')}`),
    receiptNumber: `RCP-BR001-00000${index + 1}`,
  }));
}

describe('CashCustodyService.selectCollectionsFor', () => {
  it('claims a single collection that matches exactly', () => {
    const rows = unclaimed(500_000n, 300_000n);

    expect(service().selectCollectionsFor(500_000n, rows)).toEqual(['col-1']);
  });

  it('claims an oldest-first prefix', () => {
    // Scenario 24: a partial handover takes the cash that has been out longest.
    const rows = unclaimed(500_000n, 300_000n, 200_000n);

    expect(service().selectCollectionsFor(800_000n, rows)).toEqual([
      'col-1',
      'col-2',
    ]);
  });

  it('claims everything when the amount is the full balance', () => {
    const rows = unclaimed(500_000n, 300_000n, 200_000n);

    expect(service().selectCollectionsFor(1_000_000n, rows)).toEqual([
      'col-1',
      'col-2',
      'col-3',
    ]);
  });

  it('refuses an amount that matches no prefix', () => {
    // 600_000 falls between col-1 (500_000) and col-1+col-2 (800_000). There is
    // no honest set of whole collections summing to it.
    const rows = unclaimed(500_000n, 300_000n, 200_000n);

    expect(service().selectCollectionsFor(600_000n, rows)).toBeNull();
  });

  it('refuses an amount larger than the whole balance', () => {
    // Scenario 25 in its purest form: more cash claimed than the agent holds.
    const rows = unclaimed(500_000n, 300_000n);

    expect(service().selectCollectionsFor(900_000n, rows)).toBeNull();
  });

  it('refuses when the agent holds nothing', () => {
    expect(service().selectCollectionsFor(100n, [])).toBeNull();
  });

  it('stops at the first prefix that overshoots rather than skipping ahead', () => {
    // Deliberately not a subset-sum search. col-2 alone would match 300_000,
    // but taking it while leaving the older col-1 behind would let an agent
    // choose which cash to hand over and keep the oldest indefinitely.
    const rows = unclaimed(500_000n, 300_000n);

    expect(service().selectCollectionsFor(300_000n, rows)).toBeNull();
  });

  it('never returns an empty selection for a positive amount', () => {
    // An empty claim would post a journal against no collections and leave the
    // balance unchanged — cash apparently received from nowhere.
    for (const amount of [1n, 100n, 999_999n]) {
      const result = service().selectCollectionsFor(
        amount,
        unclaimed(500_000n),
      );
      expect(result === null || result.length > 0).toBe(true);
    }
  });
});

describe('CashCustodyService.handoverableAmounts', () => {
  it('offers the running prefix sums', () => {
    const rows = unclaimed(500_000n, 300_000n, 200_000n);

    expect(service().handoverableAmounts(rows)).toEqual([
      500_000n,
      800_000n,
      1_000_000n,
    ]);
  });

  it('offers nothing when the agent holds nothing', () => {
    expect(service().handoverableAmounts([])).toEqual([]);
  });

  it('agrees with selectCollectionsFor on every amount it offers', () => {
    // The contract between the form and the service. An amount the form offers
    // must never be refused on submit.
    const rows = unclaimed(500_000n, 300_000n, 200_000n, 700_000n);
    const svc = service();

    for (const amount of svc.handoverableAmounts(rows)) {
      expect(svc.selectCollectionsFor(amount, rows)).not.toBeNull();
    }
  });
});

describe('CashCustodyService.claim', () => {
  function txWith(updatedCount: number): {
    tx: TransitionTx;
    calls: { where: unknown; data: unknown }[];
  } {
    const calls: { where: unknown; data: unknown }[] = [];
    const tx = {
      collection: {
        updateMany: jest.fn((args: { where: unknown; data: unknown }) => {
          calls.push(args);
          return Promise.resolve({ count: updatedCount });
        }),
      },
    } as unknown as TransitionTx;

    return { tx, calls };
  }

  it('claims every collection it was asked to', async () => {
    const { tx, calls } = txWith(2);

    await service().claim(tx, ORG_ID, ['col-1', 'col-2'], HANDOVER_ID);

    expect(calls).toHaveLength(1);
    expect(calls[0].data).toEqual({ custodyHandoverId: HANDOVER_ID });
  });

  it('guards on custodyHandoverId being null', async () => {
    // The concurrency mechanism itself. Without this clause in the `where`, a
    // second receive would happily re-point already-claimed rows at its own
    // handover and the same cash would be banked twice.
    const { tx, calls } = txWith(2);

    await service().claim(tx, ORG_ID, ['col-1', 'col-2'], HANDOVER_ID);

    expect(calls[0].where).toEqual({
      orgId: ORG_ID,
      collectionId: { in: ['col-1', 'col-2'] },
      custodyHandoverId: null,
    });
  });

  it('refuses when fewer rows matched than were claimed', async () => {
    // Scenario 49: somebody else got there first.
    const { tx } = txWith(1);

    await expect(
      service().claim(tx, ORG_ID, ['col-1', 'col-2'], HANDOVER_ID),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('names the conflict so the client can tell it from other 409s', async () => {
    const { tx } = txWith(0);

    await expect(
      service().claim(tx, ORG_ID, ['col-1'], HANDOVER_ID),
    ).rejects.toMatchObject({
      response: { code: 'CASH_ALREADY_HANDED_OVER' },
    });
  });

  it('refuses an empty claim outright', async () => {
    // A handover naming no collections would post a journal against nothing.
    const { tx, calls } = txWith(0);

    await expect(
      service().claim(tx, ORG_ID, [], HANDOVER_ID),
    ).rejects.toBeInstanceOf(ConflictException);

    // And it refuses before touching the database, so no partial state exists.
    expect(calls).toHaveLength(0);
  });
});

describe('CashCustodyService.release', () => {
  it('returns the claim on every collection of a handover', async () => {
    const calls: { where: unknown; data: unknown }[] = [];
    const tx = {
      collection: {
        updateMany: jest.fn((args: { where: unknown; data: unknown }) => {
          calls.push(args);
          return Promise.resolve({ count: 3 });
        }),
      },
    } as unknown as TransitionTx;

    const released = await service().release(tx, ORG_ID, HANDOVER_ID);

    expect(released).toBe(3);
    expect(calls[0].where).toEqual({
      orgId: ORG_ID,
      custodyHandoverId: HANDOVER_ID,
    });
    // Only the claim is lifted. The amounts, receipts and journal links are
    // untouched, which is what makes a reversal a custody correction rather
    // than an edit of a posted collection.
    expect(calls[0].data).toEqual({ custodyHandoverId: null });
  });
});

describe('CashCustodyService.expectedCashPaise', () => {
  function clientReturning(sum: bigint | null) {
    const calls: { where: Record<string, unknown> }[] = [];
    const client = {
      collection: {
        aggregate: jest.fn((args: { where: Record<string, unknown> }) => {
          calls.push(args);
          return Promise.resolve({ _sum: { amountPaise: sum } });
        }),
      },
    } as unknown as PrismaService;

    return { client, calls };
  }

  it('sums the agent unclaimed cash collections', async () => {
    const { client } = clientReturning(1_000_000n);

    await expect(
      service().expectedCashPaise(client, ORG_ID, AGENT_ID),
    ).resolves.toBe(1_000_000n);
  });

  it('reads a zero balance as zero, not as an error', async () => {
    // Prisma returns a null _sum when nothing matched. An agent who has
    // collected nothing holds nothing.
    const { client } = clientReturning(null);

    await expect(
      service().expectedCashPaise(client, ORG_ID, AGENT_ID),
    ).resolves.toBe(0n);
  });

  it('counts only posted, unreversed, unclaimed field cash', async () => {
    // Each clause excludes a real category of money that is not in the agent's
    // pocket. Dropping any one silently inflates every balance in the system.
    const { client, calls } = clientReturning(0n);

    await service().expectedCashPaise(client, ORG_ID, AGENT_ID);

    expect(calls[0].where).toEqual({
      orgId: ORG_ID,
      collectorUserId: AGENT_ID,
      isFieldCollection: true,
      paymentMode: 'CASH',
      status: 'POSTED',
      reversalOfCollectionId: null,
      custodyHandoverId: null,
    });
  });
});
