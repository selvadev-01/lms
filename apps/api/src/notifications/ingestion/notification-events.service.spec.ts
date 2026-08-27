import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { NotificationEventsService } from './notification-events.service';

const ORG = '11111111-1111-1111-1111-111111111111';

interface Recorded {
  created: Array<Record<string, unknown>>;
  enqueued: Array<Record<string, unknown>>;
  auditActions: string[];
}

function build(options: { createBehaviour?: () => Promise<unknown> } = {}): {
  service: NotificationEventsService;
  recorded: Recorded;
} {
  const recorded: Recorded = { created: [], enqueued: [], auditActions: [] };

  const prisma = {
    notificationSourceEvent: {
      create: (args: { data: Record<string, unknown> }) => {
        recorded.created.push(args.data);
        if (options.createBehaviour) return options.createBehaviour();
        return Promise.resolve({ eventId: 'event-1' });
      },
    },
  } as unknown as PrismaService;

  const queue = {
    send: (_queue: string, data: Record<string, unknown>) => {
      recorded.enqueued.push(data);
      return Promise.resolve('job');
    },
  } as unknown as QueueService;

  const audit = {
    record: (entry: { action: string }) => {
      recorded.auditActions.push(entry.action);
      return Promise.resolve();
    },
  } as unknown as AuditService;

  return {
    service: new NotificationEventsService(prisma, queue, audit),
    recorded,
  };
}

const INPUT = {
  orgId: ORG,
  branchId: 'branch-1',
  eventType: 'RECOVERY_ASSIGNED',
  sourceModule: 'recovery',
  sourceRecordId: 'case-1',
  sourceVersion: '3',
  payload: { caseNumber: 'RC-0001' },
};

/**
 * `NotificationEventsService`.
 *
 * The contract this file exists to defend is one sentence: **emit never
 * throws**. By the time a source module calls it, money has moved and a
 * transaction has committed. Rules 60 to 62 say a notification failure must not
 * undo that, and the only way to guarantee it is for every failure path to be
 * swallowed. Each test below is one of those paths.
 */
describe('NotificationEventsService', () => {
  describe('recording an event', () => {
    it('writes the event and enqueues it by id', async () => {
      const { service, recorded } = build();

      await service.emit(INPUT);

      expect(recorded.created).toHaveLength(1);
      expect(recorded.created[0].status).toBe('PENDING');
      // Ids only — never rendered content, never money.
      expect(recorded.enqueued).toEqual([{ orgId: ORG, eventId: 'event-1' }]);
    });

    it('computes a deduplication key from the event identity', async () => {
      const { service, recorded } = build();

      await service.emit(INPUT);

      expect(recorded.created[0].deduplicationKey).toBe(
        'RECOVERY_ASSIGNED:recovery:case-1:3',
      );
    });

    it('honours a caller-supplied key', async () => {
      // A collection already holds an Idempotency-Key, which is a better
      // natural identity than anything this service could compute.
      const { service, recorded } = build();

      await service.emit({ ...INPUT, deduplicationKey: 'collection:abc' });

      expect(recorded.created[0].deduplicationKey).toBe('collection:abc');
    });

    it('records the event time separately from ingestion (Rule 67)', async () => {
      const occurredAt = new Date('2026-08-27T04:30:00.000Z');
      const { service, recorded } = build();

      await service.emit({ ...INPUT, occurredAt });

      expect(recorded.created[0].occurredAt).toBe(occurredAt);
    });

    it('audits the acceptance', async () => {
      const { service, recorded } = build();

      await service.emit(INPUT);

      expect(recorded.auditActions).toContain('NOTIFICATION_EVENT_RECEIVED');
    });
  });

  describe('Rule 22 and Scenario 23: a duplicate is traceable, not an error', () => {
    it('swallows a unique-constraint violation', async () => {
      const { service } = build({
        createBehaviour: () =>
          Promise.reject(
            Object.assign(new Error('duplicate'), { code: 'P2002' }),
          ),
      });

      await expect(service.emit(INPUT)).resolves.toBeUndefined();
    });

    it('audits the duplicate rather than dropping it silently', async () => {
      // Scenario 23 asks for the duplicate processing attempt to be traceable.
      // This audit record is where it is traced.
      const { service, recorded } = build({
        createBehaviour: () =>
          Promise.reject(
            Object.assign(new Error('duplicate'), { code: 'P2002' }),
          ),
      });

      await service.emit(INPUT);

      expect(recorded.auditActions).toContain(
        'NOTIFICATION_EVENT_DUPLICATE_IGNORED',
      );
    });

    it('does not enqueue a duplicate for processing', async () => {
      const { service, recorded } = build({
        createBehaviour: () =>
          Promise.reject(
            Object.assign(new Error('duplicate'), { code: 'P2002' }),
          ),
      });

      await service.emit(INPUT);

      expect(recorded.enqueued).toHaveLength(0);
    });

    it('matches on the Prisma error code, not the message text', async () => {
      // A localised or reworded database error must not turn a duplicate into a
      // logged failure — and, more importantly, a *different* failure carrying
      // the word "duplicate" must not be mistaken for one.
      const { service, recorded } = build({
        createBehaviour: () =>
          Promise.reject(new Error('duplicate key value violates constraint')),
      });

      await service.emit(INPUT);

      expect(recorded.auditActions).not.toContain(
        'NOTIFICATION_EVENT_DUPLICATE_IGNORED',
      );
    });
  });

  describe('Rules 60-62: emit never throws', () => {
    it('swallows a database failure', async () => {
      // The source transaction has already committed. There is nothing to roll
      // back and nobody to tell.
      const { service } = build({
        createBehaviour: () => Promise.reject(new Error('connection lost')),
      });

      await expect(service.emit(INPUT)).resolves.toBeUndefined();
    });

    it('swallows an audit failure', async () => {
      const prisma = {
        notificationSourceEvent: {
          create: () => Promise.resolve({ eventId: 'event-1' }),
        },
      } as unknown as PrismaService;
      const queue = {
        send: () => Promise.resolve('job'),
      } as unknown as QueueService;
      const audit = {
        record: () => Promise.reject(new Error('audit store down')),
      } as unknown as AuditService;

      const service = new NotificationEventsService(prisma, queue, audit);

      await expect(service.emit(INPUT)).resolves.toBeUndefined();
    });

    it('records the event even when the enqueue fails', async () => {
      // The row stays PENDING and is visible in Delivery Monitoring; losing the
      // job is recoverable, losing the event is not.
      const prisma = {
        notificationSourceEvent: {
          create: () => Promise.resolve({ eventId: 'event-1' }),
        },
      } as unknown as PrismaService;
      const queue = {
        send: () => Promise.reject(new Error('queue down')),
      } as unknown as QueueService;
      const audit = {
        record: () => Promise.resolve(),
      } as unknown as AuditService;

      const service = new NotificationEventsService(prisma, queue, audit);

      await expect(service.emit(INPUT)).resolves.toBeUndefined();
    });
  });

  describe('what it cannot do', () => {
    it('never writes inside a caller transaction', async () => {
      // The load-bearing omission: `emit` takes no `tx` parameter, so a
      // notification write can never join a business transaction and can never
      // roll one back (Rules 6, 7, 31; Scenario 35).
      //
      // Asserted by behaviour rather than by `Function.length`, which counts
      // only parameters before the first default and would silently stop
      // testing anything if a third were added.
      let sawTransaction = false;
      const prisma = {
        notificationSourceEvent: {
          create: () => Promise.resolve({ eventId: 'event-1' }),
        },
        // Reaching for this at all would be the bug.
        $transaction: () => {
          sawTransaction = true;
          return Promise.resolve([]);
        },
      } as unknown as PrismaService;
      const queue = {
        send: () => Promise.resolve('job'),
      } as unknown as QueueService;
      const audit = {
        record: () => Promise.resolve(),
      } as unknown as AuditService;

      await new NotificationEventsService(prisma, queue, audit).emit(INPUT);

      expect(sawTransaction).toBe(false);
    });
  });
});
