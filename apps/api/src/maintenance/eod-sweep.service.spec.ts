import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import type { BusinessCalendarService } from '../settings/business-calendar.service';
import { EodSweepService } from './eod-sweep.service';
import type { EodService } from './eod.service';

/**
 * Module 17 — the nightly EOD sweep.
 *
 * Four properties carry the weight:
 *
 * 1. **A holiday is skipped, not failed.** "We chose not to process today" and
 *    "processing broke" are different operational states, and an alert should
 *    only fire for the second.
 * 2. **One organization's failure does not skip the rest.** The sweep runs
 *    unattended, so a thrown error would silently drop every organization after
 *    it — with nothing to notice, because nobody is watching at 21:30.
 * 3. **The scheduled run carries no human actor.** Rule 63 requires scheduled
 *    and manual work to be distinguishable; borrowing an administrator's id
 *    would put a real person on work they did not do.
 * 4. **A run already claimed today is reported, not repeated** (Scenarios 22, 66).
 */

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

function harness() {
  const prisma = {
    organization: {
      findMany: jest.fn().mockResolvedValue([
        { orgId: ORG_A, code: 'DEMO' },
        { orgId: ORG_B, code: 'OTHERORG' },
      ]),
    },
  };

  const eod = {
    run: jest.fn().mockResolvedValue({ outcome: 'STARTED', job: {} }),
  };

  const calendar = {
    isWorkingDay: jest.fn().mockResolvedValue(true),
  };

  const service = new EodSweepService(
    prisma as unknown as PrismaService,
    eod as unknown as EodService,
    calendar as unknown as BusinessCalendarService,
  );

  return { service, prisma, eod, calendar };
}

/** A Thursday, so the default Mon-Fri calendar treats it as a working day. */
const NOW = new Date('2026-08-27T16:00:00.000Z');

describe('EodSweepService', () => {
  it('runs every active organization', async () => {
    const { service, eod } = harness();

    const result = await service.run(NOW);

    expect(eod.run).toHaveBeenCalledTimes(2);
    expect(result.organizations).toBe(2);
    expect(result.started).toBe(2);
  });

  it('derives the business date from the Asia/Kolkata clock', async () => {
    const { service, eod } = harness();

    // 16:00 UTC is already the 27th in Kolkata (UTC+5:30) — and would still be
    // the 27th an hour later, which is why the sweep runs before midnight.
    const result = await service.run(NOW);

    expect(result.businessDate).toBe('2026-08-27');
    expect(eod.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ businessDate: '2026-08-27' }),
      expect.anything(),
    );
  });

  it('skips a non-working day rather than failing it', async () => {
    const { service, eod, calendar } = harness();
    calendar.isWorkingDay.mockResolvedValue(false);

    const result = await service.run(NOW);

    expect(eod.run).not.toHaveBeenCalled();
    expect(result.skippedNonWorkingDay).toBe(2);
    // The distinction that matters: nothing failed.
    expect(result.failed).toBe(0);
  });

  it('continues past an organization that throws', async () => {
    const { service, eod } = harness();
    eod.run
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ outcome: 'STARTED', job: {} });

    const result = await service.run(NOW);

    // The second organization still ran.
    expect(eod.run).toHaveBeenCalledTimes(2);
    expect(result.failed).toBe(1);
    expect(result.started).toBe(1);
  });

  it('reports a run already claimed today rather than repeating it', async () => {
    const { service, eod } = harness();
    eod.run.mockResolvedValue({ outcome: 'ALREADY_HANDLED', job: {} });

    const result = await service.run(NOW);

    expect(result.alreadyHandled).toBe(2);
    expect(result.started).toBe(0);
  });

  describe('the system actor (Rule 63)', () => {
    it('carries no user id', async () => {
      const { service, eod } = harness();

      await service.run(NOW);

      const actor = eod.run.mock.calls[0][0] as AuthContext;
      expect(actor.userId).toBeNull();
    });

    it('marks the run SCHEDULED', async () => {
      const { service, eod } = harness();

      await service.run(NOW);

      expect(eod.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ triggerType: 'SCHEDULED' }),
        expect.anything(),
      );
    });

    it('holds only the EOD permission, never a borrowed administrator set', async () => {
      const { service, eod } = harness();

      await service.run(NOW);

      const actor = eod.run.mock.calls[0][0] as AuthContext;
      expect(actor.permissions).toEqual(['maintenance.eod.run']);
      expect(actor.roles).toEqual([]);
    });

    it('scopes each call to its own organization', async () => {
      const { service, eod } = harness();

      await service.run(NOW);

      const orgIds = eod.run.mock.calls.map(
        (call) => (call[0] as AuthContext).orgId,
      );
      expect(orgIds).toEqual([ORG_A, ORG_B]);
    });

    it('runs organization-wide rather than per branch', async () => {
      const { service, eod } = harness();

      await service.run(NOW);

      const actor = eod.run.mock.calls[0][0] as AuthContext;
      expect(actor.branchId).toBeNull();
      expect(eod.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ branchId: null }),
        expect.anything(),
      );
    });
  });

  it('only sweeps ACTIVE organizations', async () => {
    const { service, prisma } = harness();

    await service.run(NOW);

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );
  });
});
