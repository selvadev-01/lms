import { computeSchedule, parseIsoDate, type CivilDate } from '@lms/emi';

import type { AuditService } from '../../audit/audit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoanService } from '../shared/loan.service';
import {
  compareCivilDates,
  deriveEmiStatus,
  RepaymentScheduleService,
  toEmiRow,
  totalsOf,
  type EmiLike,
} from './repayment-schedule.service';

/**
 * Module 10 — the repayment schedule.
 *
 * Four properties here are load-bearing in the sense that a plausible tidy-up
 * would break them silently:
 *
 * 1. **A settled status is never overridden by the calendar.** Once a payment
 *    has moved a row to PAID or PARTIALLY_PAID, that is a fact about money.
 *    "Simplifying" the derivation to a pure date comparison would silently
 *    re-mark paid installments overdue, and every one of those is a wrong
 *    dunning message to a borrower who paid.
 * 2. **The persisted rows reconcile exactly** — principal components to the
 *    financed principal, EMI totals to the contractual total payable, with no
 *    paise unaccounted for (Scenarios 11, 12).
 * 3. **Identical inputs produce identical schedules** (Scenario 14). Any drift
 *    into floating point would show up here first.
 * 4. **Every one of the three downstream reference tables blocks
 *    regeneration.** Dropping any of the three counts would let a regeneration
 *    orphan real financial history (Scenarios 17, 19, 20).
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const SCHEDULE_ID = '33333333-3333-3333-3333-333333333333';

const TODAY: CivilDate = { year: 2026, month: 8, day: 21 };

/** A minimal persisted installment. Only the fields the helpers read. */
function emi(overrides: Partial<EmiLike> = {}): EmiLike {
  return {
    emiId: 'e1',
    installmentNumber: 1,
    dueDate: new Date('2026-08-21T12:00:00+05:30'),
    openingPrincipalPaise: 10_000_000n,
    principalDuePaise: 800_000n,
    interestDuePaise: 100_000n,
    totalDuePaise: 900_000n,
    paidAmountPaise: 0n,
    outstandingAmountPaise: 900_000n,
    status: 'PENDING',
    paidAt: null,
    ...overrides,
  };
}

describe('deriveEmiStatus', () => {
  // Scenario 23: a future installment stays pending and is not marked overdue.
  it('is PENDING before the due date', () => {
    expect(
      deriveEmiStatus('PENDING', { year: 2026, month: 8, day: 22 }, TODAY),
    ).toBe('PENDING');
  });

  // Scenario 24: the business date equalling the due date makes it collectable.
  it('is DUE on the due date', () => {
    expect(deriveEmiStatus('PENDING', TODAY, TODAY)).toBe('DUE');
  });

  it('is OVERDUE after the due date', () => {
    expect(
      deriveEmiStatus('PENDING', { year: 2026, month: 8, day: 20 }, TODAY),
    ).toBe('OVERDUE');
  });

  // The boundary that matters most: one day either side of today. An off-by-one
  // here bills a borrower a day early or lets an arrear go unnoticed a day late.
  it.each([
    [{ year: 2026, month: 8, day: 20 }, 'OVERDUE'],
    [{ year: 2026, month: 8, day: 21 }, 'DUE'],
    [{ year: 2026, month: 8, day: 22 }, 'PENDING'],
  ] as const)('resolves %o to %s', (dueDate, expected) => {
    expect(deriveEmiStatus('PENDING', dueDate, TODAY)).toBe(expected);
  });

  // Crossing a month and a year boundary, since the comparison is on three
  // integers rather than on a single ordinal.
  it('compares across month and year boundaries', () => {
    const newYearsEve = { year: 2025, month: 12, day: 31 };
    expect(deriveEmiStatus('PENDING', newYearsEve, TODAY)).toBe('OVERDUE');
    expect(
      deriveEmiStatus('PENDING', { year: 2027, month: 1, day: 1 }, TODAY),
    ).toBe('PENDING');
  });

  // The property a tidy-up would break: money already recorded wins over the
  // calendar, always.
  it.each(['PAID', 'PARTIALLY_PAID', 'WAIVED', 'CANCELLED'] as const)(
    'never overrides a settled %s row, even long past due',
    (status) => {
      const longPast = { year: 2020, month: 1, day: 1 };
      expect(deriveEmiStatus(status, longPast, TODAY)).toBe(status);
    },
  );

  it('does still advance a DUE row to OVERDUE', () => {
    expect(
      deriveEmiStatus('DUE', { year: 2026, month: 8, day: 1 }, TODAY),
    ).toBe('OVERDUE');
  });
});

describe('compareCivilDates', () => {
  it.each([
    [{ year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 1 }, 0],
    [{ year: 2025, month: 12, day: 31 }, { year: 2026, month: 1, day: 1 }, -1],
    [{ year: 2026, month: 2, day: 1 }, { year: 2026, month: 1, day: 31 }, 1],
  ] as const)('compares %o to %o', (a, b, expected) => {
    expect(Math.sign(compareCivilDates(a, b))).toBe(expected);
  });
});

describe('toEmiRow', () => {
  it('serializes every money field as a paise string', () => {
    const row = toEmiRow(emi(), TODAY);

    expect(row).toMatchObject({
      openingPrincipalPaise: '10000000',
      principalDuePaise: '800000',
      interestDuePaise: '100000',
      totalDuePaise: '900000',
      paidAmountPaise: '0',
      outstandingAmountPaise: '900000',
    });
  });

  it('carries the persisted status beside the derived one', () => {
    const row = toEmiRow(
      emi({
        status: 'PENDING',
        dueDate: new Date('2026-08-01T12:00:00+05:30'),
      }),
      TODAY,
    );

    expect(row.status).toBe('PENDING');
    expect(row.effectiveStatus).toBe('OVERDUE');
  });

  // Noon IST on both sides of the round-trip: a midnight anchor would let a
  // timezone conversion move a due date across a day boundary.
  it('renders the due date as DATE-only', () => {
    expect(toEmiRow(emi(), TODAY).dueDate).toBe('2026-08-21');
  });

  it('omits paidAt when nothing has been paid', () => {
    expect(toEmiRow(emi(), TODAY).paidAt).toBeUndefined();
  });
});

describe('totalsOf', () => {
  const rows = [
    emi({
      emiId: 'a',
      installmentNumber: 1,
      paidAmountPaise: 900_000n,
      outstandingAmountPaise: 0n,
    }),
    emi({
      emiId: 'b',
      installmentNumber: 2,
      dueDate: new Date('2026-09-21T12:00:00+05:30'),
    }),
    emi({
      emiId: 'c',
      installmentNumber: 3,
      dueDate: new Date('2026-10-21T12:00:00+05:30'),
    }),
  ];

  it('sums every column', () => {
    expect(totalsOf(rows)).toMatchObject({
      installmentCount: 3,
      totalPrincipalPaise: '2400000',
      totalInterestPaise: '300000',
      totalPayablePaise: '2700000',
      totalPaidPaise: '900000',
      outstandingPaise: '1800000',
    });
  });

  // Keyed on outstanding rather than on status, so it needs no business date:
  // a settled installment owes nothing whatever the calendar says.
  it('reports the earliest installment still owing as next due', () => {
    expect(totalsOf(rows).nextDueDate).toBe('2026-09-21');
  });

  it('omits nextDueDate once everything is settled', () => {
    const settled = rows.map((row) => ({ ...row, outstandingAmountPaise: 0n }));
    expect(totalsOf(settled).nextDueDate).toBeUndefined();
  });

  it('totals an empty schedule to zero rather than throwing', () => {
    expect(totalsOf([])).toMatchObject({
      installmentCount: 0,
      totalPayablePaise: '0',
      outstandingPaise: '0',
    });
  });
});

/**
 * Scenarios 11, 12, 13, 14 — the reconciliation invariants, asserted against
 * rows shaped exactly as `persist` writes them.
 */
describe('schedule reconciliation', () => {
  const PRINCIPAL = 10_000_000n;

  const INPUTS = [
    {
      label: 'reducing monthly',
      interestType: 'REDUCING' as const,
      frequency: 'MONTHLY' as const,
      durationCount: 12,
      annualRateBps: 1_450n,
    },
    {
      label: 'flat monthly',
      interestType: 'FLAT' as const,
      frequency: 'MONTHLY' as const,
      durationCount: 12,
      annualRateBps: 1_200n,
    },
    {
      label: 'reducing weekly',
      interestType: 'REDUCING' as const,
      frequency: 'WEEKLY' as const,
      durationCount: 52,
      annualRateBps: 1_800n,
    },
    {
      label: 'zero rate',
      interestType: 'REDUCING' as const,
      frequency: 'MONTHLY' as const,
      durationCount: 7,
      annualRateBps: 0n,
    },
    // A duration that does not divide the principal evenly, so a residue exists
    // and has to land somewhere deterministic.
    {
      label: 'awkward residue',
      interestType: 'REDUCING' as const,
      frequency: 'MONTHLY' as const,
      durationCount: 7,
      annualRateBps: 1_333n,
    },
  ];

  /** Rebuild the opening balances exactly as `persist` does. */
  function persistedRows(schedule: ReturnType<typeof computeSchedule>) {
    let opening = PRINCIPAL;
    return schedule.installments.map((installment) => {
      const row = emi({
        emiId: `e${installment.installmentNumber}`,
        installmentNumber: installment.installmentNumber,
        dueDate: new Date(`${installment.dueDate}T12:00:00+05:30`),
        openingPrincipalPaise: opening,
        principalDuePaise: installment.principalPaise,
        interestDuePaise: installment.interestPaise,
        totalDuePaise: installment.totalPaise,
        outstandingAmountPaise: installment.totalPaise,
      });
      opening = installment.closingBalancePaise;
      return row;
    });
  }

  describe.each(INPUTS)('$label', (input) => {
    const schedule = computeSchedule({
      principalPaise: PRINCIPAL,
      startDate: '2026-08-21',
      ...input,
    });
    const rows = persistedRows(schedule);

    // Scenario 11: no paise of principal unexplained.
    it('sums principal components to the financed principal exactly', () => {
      expect(totalsOf(rows).totalPrincipalPaise).toBe(PRINCIPAL.toString());
    });

    // Scenario 12: no rounding difference left outside the schedule.
    it('sums EMI amounts to the contractual total payable exactly', () => {
      expect(totalsOf(rows).totalPayablePaise).toBe(
        schedule.totalPayablePaise.toString(),
      );
    });

    it('reconciles principal plus interest to total payable', () => {
      const totals = totalsOf(rows);
      expect(
        BigInt(totals.totalPrincipalPaise) + BigInt(totals.totalInterestPaise),
      ).toBe(BigInt(totals.totalPayablePaise));
    });

    // The first row opens at the financed principal and the chain is unbroken:
    // each row opens where the previous one closed.
    it('chains opening balances from the principal down to the last', () => {
      expect(rows[0]?.openingPrincipalPaise).toBe(PRINCIPAL);

      for (let i = 1; i < rows.length; i += 1) {
        const previous = rows[i - 1];
        expect(rows[i].openingPrincipalPaise).toBe(
          previous.openingPrincipalPaise - previous.principalDuePaise,
        );
      }

      const last = rows[rows.length - 1];
      expect(last.openingPrincipalPaise - last.principalDuePaise).toBe(0n);
    });

    // Scenario 14: recomputation with identical inputs is deterministic.
    it('produces an identical schedule when recomputed', () => {
      const again = computeSchedule({
        principalPaise: PRINCIPAL,
        startDate: '2026-08-21',
        ...input,
      });
      expect(again).toEqual(schedule);
    });

    // Scenario 9: DATE-only, no time component anywhere.
    it('emits DATE-only due dates', () => {
      for (const row of rows) {
        expect(toEmiRow(row, TODAY).dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    // Scenario 13: the residue is deterministic and lands on the final row.
    it('absorbs any residue into the final installment', () => {
      const last = rows[rows.length - 1];
      expect(last.totalDuePaise).toBe(schedule.finalInstallmentPaise);
    });
  });
});

describe('checkRegenerationBlockers', () => {
  const EMI_IDS = [{ emiId: 'e1' }, { emiId: 'e2' }];

  /**
   * The mock shape, kept as a named type so an assertion can see the mocks.
   *
   * Without it, `tx()` returned only `PrismaService` and a test reading
   * `client.collectionAllocation.count` was handed Prisma's *real* method
   * rather than the `jest.Mock` standing in for it — which is a detached
   * method, and what `@typescript-eslint/unbound-method` was reporting. The
   * cast to `PrismaService` is still what the service is called with; this
   * type is what the assertions read.
   */
  interface CountingTx {
    emi: { findMany: jest.Mock };
    collectionAllocation: { count: jest.Mock };
    penalty: { count: jest.Mock };
    recoveryCase: { count: jest.Mock };
  }

  /** Counts for the three reference tables, defaulting to none. */
  function tx(counts: {
    allocations?: number;
    penalties?: number;
    recoveryCases?: number;
    emis?: { emiId: string }[];
  }): CountingTx {
    return {
      emi: { findMany: jest.fn().mockResolvedValue(counts.emis ?? EMI_IDS) },
      collectionAllocation: {
        count: jest.fn().mockResolvedValue(counts.allocations ?? 0),
      },
      penalty: { count: jest.fn().mockResolvedValue(counts.penalties ?? 0) },
      recoveryCase: {
        count: jest.fn().mockResolvedValue(counts.recoveryCases ?? 0),
      },
    };
  }

  const service = new RepaymentScheduleService(
    {} as PrismaService,
    {} as LoanService,
    {} as AuditService,
  );

  // The cast lives here, at the one boundary the service is called across,
  // rather than inside `tx()` — so every assertion keeps seeing the mocks.
  const check = (client: CountingTx, loan = 'ACTIVE', schedule = 'ACTIVE') =>
    service.checkRegenerationBlockers(
      client as unknown as PrismaService,
      ORG_ID,
      SCHEDULE_ID,
      loan,
      schedule,
    );

  it('allows regeneration when nothing references the schedule', async () => {
    expect(await check(tx({}))).toEqual([]);
  });

  // Scenario 17: payment activity blocks ordinary regeneration.
  it('blocks on payment allocations', async () => {
    const blockers = await check(tx({ allocations: 3 }));
    expect(blockers).toEqual([
      expect.objectContaining({ key: 'ALLOCATIONS_EXIST', count: 3 }),
    ]);
  });

  it('blocks on penalties', async () => {
    const blockers = await check(tx({ penalties: 1 }));
    expect(blockers).toEqual([
      expect.objectContaining({ key: 'PENALTIES_EXIST', count: 1 }),
    ]);
  });

  it('blocks on recovery cases', async () => {
    const blockers = await check(tx({ recoveryCases: 2 }));
    expect(blockers).toEqual([
      expect.objectContaining({ key: 'RECOVERY_CASES_EXIST', count: 2 }),
    ]);
  });

  // Every reason at once, so the caller is not led through a sequence of
  // refusals discovering one blocker per attempt.
  it('reports every blocker together', async () => {
    const blockers = await check(
      tx({ allocations: 1, penalties: 1, recoveryCases: 1 }),
      'CLOSED',
      'SUPERSEDED',
    );

    expect(blockers.map((b) => b.key).sort()).toEqual([
      'ALLOCATIONS_EXIST',
      'LOAN_NOT_ACTIVE',
      'PENALTIES_EXIST',
      'RECOVERY_CASES_EXIST',
      'SCHEDULE_NOT_ACTIVE',
    ]);
  });

  // Scenario 22: an ineligible loan may not enter a new repayment cycle.
  it.each(['CLOSED', 'WRITTEN_OFF', 'FORECLOSED'])(
    'blocks a %s loan',
    async (status) => {
      const blockers = await check(tx({}), status);
      expect(blockers).toEqual([
        expect.objectContaining({ key: 'LOAN_NOT_ACTIVE' }),
      ]);
    },
  );

  it('blocks a schedule that is not the active one', async () => {
    const blockers = await check(tx({}), 'ACTIVE', 'SUPERSEDED');
    expect(blockers).toEqual([
      expect.objectContaining({ key: 'SCHEDULE_NOT_ACTIVE' }),
    ]);
  });

  // A schedule with no installments cannot be referenced by anything, so the
  // three counts are skipped rather than run against an empty `IN ()`.
  it('skips the reference counts when the schedule has no installments', async () => {
    const client = tx({ emis: [] });
    expect(await check(client)).toEqual([]);
    expect(client.collectionAllocation.count).not.toHaveBeenCalled();
  });

  // The counts must be scoped by organization as well as by installment: an
  // unscoped count is a cross-tenant read.
  it('scopes the reference counts to the organization', async () => {
    const client = tx({ allocations: 1 });
    await check(client);

    expect(client.collectionAllocation.count).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, emiId: { in: ['e1', 'e2'] } },
    });
  });

  it('pluralizes the message for a single reference', async () => {
    const [blocker] = await check(tx({ allocations: 1 }));
    expect(blocker?.message).toContain('1 payment allocation reference');
  });
});

describe('parseIsoDate round-trip', () => {
  // The derivation parses the same string `toEmiRow` emits, so the two must
  // agree exactly or a due date could be read back as a different day.
  it('round-trips a rendered due date', () => {
    const row = toEmiRow(emi(), TODAY);
    expect(parseIsoDate(row.dueDate)).toEqual({
      year: 2026,
      month: 8,
      day: 21,
    });
  });
});
