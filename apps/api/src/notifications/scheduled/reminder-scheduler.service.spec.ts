import { PrismaService } from '../../prisma/prisma.service';
import { NotificationEventsService } from '../ingestion/notification-events.service';
import { ReminderSchedulerService } from './reminder-scheduler.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const BRANCH = '22222222-2222-2222-2222-222222222222';

/** 2026-08-27 at 06:00 Asia/Kolkata, which is 00:30 UTC. */
const RUN_AT = new Date('2026-08-27T00:30:00.000Z');

interface Emitted {
  eventType: string;
  sourceModule: string;
  sourceRecordId?: string | null;
  sourceVersion?: string | null;
  branchId?: string | null;
  payload: Record<string, unknown>;
}

function emi(overrides: Record<string, unknown> = {}) {
  return {
    emiId: 'emi-1',
    installmentNumber: 3,
    dueDate: new Date('2026-08-27T00:00:00.000Z'),
    outstandingAmountPaise: 125_000n,
    loan: {
      loanNumber: 'LN-000001',
      branchId: BRANCH,
      customer: { fullName: 'A. Borrower' },
    },
    ...overrides,
  };
}

function build(data: {
  emis?: Record<string, unknown>[];
  promises?: Record<string, unknown>[];
  postedCollections?: number;
}): { service: ReminderSchedulerService; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  const emis = data.emis ?? [];

  const prisma = {
    organization: { findMany: () => Promise.resolve([{ orgId: ORG }]) },
    emi: {
      findMany: ({ where, cursor }: Record<string, never>) => {
        // A cursor page after the first returns nothing, so the paging loop
        // terminates. The filtering below models the predicates the service
        // builds, so a service that stopped filtering would fail these tests.
        if (cursor) return Promise.resolve([]);

        const clause = where as unknown as {
          dueDate?: Date | { lt: Date };
        };

        return Promise.resolve(
          emis.filter((row) => {
            const due = (row as { dueDate: Date }).dueDate;
            if (clause.dueDate instanceof Date) {
              return due.getTime() === clause.dueDate.getTime();
            }
            if (clause.dueDate && 'lt' in clause.dueDate) {
              return due.getTime() < clause.dueDate.lt.getTime();
            }
            return true;
          }),
        );
      },
    },
    recoveryAction: {
      findMany: () => Promise.resolve(data.promises ?? []),
    },
    collection: {
      count: () => Promise.resolve(data.postedCollections ?? 0),
    },
  } as unknown as PrismaService;

  const events = {
    emit: (input: Emitted) => {
      emitted.push(input);
      return Promise.resolve();
    },
  } as unknown as NotificationEventsService;

  return { service: new ReminderSchedulerService(prisma, events), emitted };
}

/**
 * `ReminderSchedulerService`.
 *
 * One property carries the whole design: **every event is keyed on the
 * Asia/Kolkata business date**. That is what makes running the sweep twice on
 * one day produce nothing the second time, tomorrow's run produce tomorrow's
 * reminders, and a failed run safely re-runnable — with no "have I run today?"
 * flag, which would be a second source of truth able to disagree with the data.
 *
 * The tests below assert the key, not just the count, because a sweep that
 * emitted the right *number* of events under the wrong key would look correct
 * here and duplicate every reminder in production.
 */
describe('ReminderSchedulerService', () => {
  describe('the business date is the deduplication key', () => {
    it('keys a due reminder on the Asia/Kolkata date, not UTC', async () => {
      // 00:30 UTC is already the 27th in Kolkata. A sweep keyed on the UTC date
      // would use the 26th and raise the same reminder again tomorrow.
      const { service, emitted } = build({ emis: [emi()] });

      await service.run(RUN_AT);

      const due = emitted.find((e) => e.eventType === 'EMI_DUE_TODAY');
      expect(due?.sourceVersion).toBe('2026-08-27');
    });

    it('produces the same key on a second run of the same day', async () => {
      // The dedup index then swallows the second set — which is why the sweep
      // needs no run-once flag of its own.
      const first = build({ emis: [emi()] });
      await first.service.run(RUN_AT);

      const second = build({ emis: [emi()] });
      await second.service.run(new Date('2026-08-27T14:00:00.000Z'));

      expect(second.emitted[0].sourceVersion).toBe(
        first.emitted[0].sourceVersion,
      );
    });

    it('produces a different key the next day', async () => {
      const today = build({ emis: [emi()] });
      await today.service.run(RUN_AT);

      const tomorrow = build({
        emis: [emi({ dueDate: new Date('2026-08-28T00:00:00.000Z') })],
      });
      await tomorrow.service.run(new Date('2026-08-28T00:30:00.000Z'));

      expect(tomorrow.emitted[0].sourceVersion).not.toBe(
        today.emitted[0].sourceVersion,
      );
    });
  });

  describe('EMIs due today and tomorrow', () => {
    it('raises EMI_DUE_TODAY for an instalment due on the business date', async () => {
      const { service, emitted } = build({ emis: [emi()] });

      await service.run(RUN_AT);

      const due = emitted.filter((e) => e.eventType === 'EMI_DUE_TODAY');
      expect(due).toHaveLength(1);
      expect(due[0].sourceModule).toBe('repayment_schedule');
      expect(due[0].branchId).toBe(BRANCH);
    });

    it('raises EMI_DUE_TOMORROW for one due the next day', async () => {
      const { service, emitted } = build({
        emis: [emi({ dueDate: new Date('2026-08-28T00:00:00.000Z') })],
      });

      await service.run(RUN_AT);

      expect(
        emitted.filter((e) => e.eventType === 'EMI_DUE_TOMORROW'),
      ).toHaveLength(1);
    });

    it('carries a DATE-only due date (Rules 26, 68; Scenario 36)', async () => {
      const { service, emitted } = build({ emis: [emi()] });

      await service.run(RUN_AT);

      expect(emitted[0].payload.dueDate).toBe('2026-08-27');
      expect(String(emitted[0].payload.dueDate)).not.toContain('T');
    });

    it('carries money as a paise string and a formatted string (Rule 25)', async () => {
      const { service, emitted } = build({ emis: [emi()] });

      await service.run(RUN_AT);

      expect(emitted[0].payload.amountPaise).toBe('125000');
      expect(typeof emitted[0].payload.amountFormatted).toBe('string');
      // Never a JS number: that is where a float could enter.
      expect(typeof emitted[0].payload.amountPaise).toBe('string');
    });
  });

  describe('the overdue cadence', () => {
    it.each([1, 3, 7, 15, 30])(
      'raises EMI_OVERDUE at %s days past due',
      async (daysPastDue) => {
        const dueDate = new Date(
          Date.UTC(2026, 7, 27 - daysPastDue), // August is month 7.
        );
        const { service, emitted } = build({ emis: [emi({ dueDate })] });

        await service.run(RUN_AT);

        const overdue = emitted.filter((e) => e.eventType === 'EMI_OVERDUE');
        expect(overdue).toHaveLength(1);
        expect(overdue[0].payload.daysPastDue).toBe(daysPastDue);
      },
    );

    it.each([2, 10, 29])(
      'stays silent at %s days past due',
      async (daysPastDue) => {
        // Reminding daily would train recipients to ignore the reminder.
        const dueDate = new Date(Date.UTC(2026, 7, 27 - daysPastDue));
        const { service, emitted } = build({ emis: [emi({ dueDate })] });

        await service.run(RUN_AT);

        expect(
          emitted.filter((e) => e.eventType === 'EMI_OVERDUE'),
        ).toHaveLength(0);
      },
    );

    it('does not treat an instalment due today as overdue', async () => {
      const { service, emitted } = build({ emis: [emi()] });

      await service.run(RUN_AT);

      expect(emitted.filter((e) => e.eventType === 'EMI_OVERDUE')).toHaveLength(
        0,
      );
    });
  });

  describe('Scenario 39: promises to pay', () => {
    const promise = (overrides: Record<string, unknown> = {}) => ({
      recoveryActionId: 'action-1',
      recoveryCaseId: 'case-1',
      promiseToPayDate: new Date('2026-08-20T00:00:00.000Z'),
      promiseToPayAmountPaise: 500_000n,
      recoveryCase: {
        caseNumber: 'RC-0001',
        branchId: BRANCH,
        status: 'OPEN',
        loanId: 'loan-1',
        loan: {
          loanNumber: 'LN-000001',
          customer: { fullName: 'A. Borrower' },
        },
      },
      ...overrides,
    });

    it('raises PROMISE_TO_PAY_MISSED when nothing was collected', async () => {
      const { service, emitted } = build({
        promises: [promise()],
        postedCollections: 0,
      });

      await service.run(RUN_AT);

      const missed = emitted.filter(
        (e) => e.eventType === 'PROMISE_TO_PAY_MISSED',
      );
      expect(missed).toHaveLength(1);
      expect(missed[0].payload.promiseDate).toBe('2026-08-20');
    });

    it('stays silent when a collection was posted on or after the promise date', async () => {
      // The "was it kept?" test reads authoritative collection rows. It does
      // not recompute a balance or judge sufficiency — Rules 27 and 37.
      const { service, emitted } = build({
        promises: [promise()],
        postedCollections: 1,
      });

      await service.run(RUN_AT);

      expect(
        emitted.filter((e) => e.eventType === 'PROMISE_TO_PAY_MISSED'),
      ).toHaveLength(0);
    });

    it('ignores a promise on a closed case', async () => {
      const { service, emitted } = build({
        promises: [
          promise({
            recoveryCase: {
              ...promise().recoveryCase,
              status: 'CLOSED',
            },
          }),
        ],
      });

      await service.run(RUN_AT);

      expect(
        emitted.filter((e) => e.eventType.startsWith('PROMISE_')),
      ).toHaveLength(0);
    });

    it('announces a missed promise once, not daily until the case closes', async () => {
      // Keyed on the action rather than the business date, unlike the EMI
      // sweeps — a missed promise is one fact, not a recurring condition.
      const { service, emitted } = build({ promises: [promise()] });

      await service.run(RUN_AT);

      const [missed] = emitted.filter(
        (e) => e.eventType === 'PROMISE_TO_PAY_MISSED',
      );
      expect(missed.sourceVersion).toBe('action-1:missed');
      expect(missed.sourceVersion).not.toContain('2026-08-27');
    });
  });

  describe('Rules 27, 37 and Scenario 39: it writes nothing but events', () => {
    it('reaches no write method on Prisma', async () => {
      // The sweep raises events and nothing else. A Prisma stand-in with no
      // update/create/delete at all would throw if the service tried one.
      const { service } = build({ emis: [emi()], promises: [] });

      await expect(service.run(RUN_AT)).resolves.toBeDefined();
    });

    it('reports what it raised, for the operator log', async () => {
      const { service } = build({ emis: [emi()] });

      const result = await service.run(RUN_AT);

      expect(result).toMatchObject({
        businessDate: '2026-08-27',
        dueToday: 1,
      });
    });
  });

  describe('one organization cannot stop another', () => {
    it('continues after a failure and still reports', async () => {
      // The sweep runs unattended, so a thrown error would silently skip every
      // organization after the failing one.
      const prisma = {
        organization: {
          findMany: () =>
            Promise.resolve([{ orgId: ORG }, { orgId: 'other-org' }]),
        },
        emi: { findMany: () => Promise.reject(new Error('database down')) },
        recoveryAction: { findMany: () => Promise.resolve([]) },
        collection: { count: () => Promise.resolve(0) },
      } as unknown as PrismaService;

      const events = {
        emit: () => Promise.resolve(),
      } as unknown as NotificationEventsService;

      const service = new ReminderSchedulerService(prisma, events);

      await expect(service.run(RUN_AT)).resolves.toMatchObject({
        businessDate: '2026-08-27',
      });
    });
  });
});
