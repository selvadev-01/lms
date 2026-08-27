import { ConfigService } from '@nestjs/config';

/**
 * pg-boss 12 ships as pure ESM (`"type": "module"`), and Jest's CommonJS
 * runtime cannot load it — Node's own require works through ESM-in-CJS interop
 * that the test runtime does not have. Transforming the package is not a way
 * out either: it pulls in a transitive tree of ESM modules.
 *
 * Mocking the module is the right answer rather than a workaround, because
 * nothing below actually exercises pg-boss. Every assertion here is about what
 * `QueueService` does when the queue is absent, disabled, or failing — the
 * paths that protect a committed business transaction (Rules 60-62). The real
 * pg-boss round trip is verified against a live Postgres, where it belongs.
 */
jest.mock('pg-boss', () => ({ PgBoss: class {} }));

import { QUEUES, QueueService } from './queue.service';

function configWith(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

/**
 * `QueueService` — the guarantees that hold with no database.
 *
 * The pg-boss round trip itself is exercised against a real Postgres rather
 * than mocked; what matters here is the behaviour when the queue is *absent* or
 * disabled, because that is what protects the business transaction.
 *
 * Rules 60-62 are the whole point: a notification may be delayed, failed or
 * dropped without rolling back committed business data. So every method on this
 * service must degrade rather than throw, and a process with workers disabled
 * must construct without touching a database at all.
 */
describe('QueueService', () => {
  describe('when the queue never started', () => {
    // This is the shape the Jest suite and any misconfigured deployment see.
    // Every assertion below is really the same one: notification
    // infrastructure cannot be a reason a business transaction fails.
    let service: QueueService;

    beforeEach(() => {
      service = new QueueService(configWith({}));
    });

    it('returns null from send rather than throwing', async () => {
      await expect(
        service.send(QUEUES.NOTIFICATION_INGEST, { orgId: 'o', eventId: 'e' }),
      ).resolves.toBeNull();
    });

    it('returns null from sendAfter rather than throwing', async () => {
      await expect(
        service.sendAfter(
          QUEUES.NOTIFICATION_DELIVER,
          { orgId: 'o', notificationId: 'n' },
          60,
        ),
      ).resolves.toBeNull();
    });

    it('buffers a worker registration instead of failing', async () => {
      // Nest calls onModuleInit in dependency order, and a consumer may
      // register before this service is ready. Buffering removes the ordering
      // requirement rather than making every consumer aware of it.
      await expect(
        service.work(QUEUES.NOTIFICATION_INGEST, async () => undefined),
      ).resolves.toBeUndefined();
    });

    it('tolerates a shutdown it never started', async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  describe('when workers are disabled for this process', () => {
    // NOTIFICATIONS_WORKER_ENABLED=false is what stops the Jest suite spawning
    // pollers against a real database. A write-only replica uses the same
    // switch — note that it still *enqueues*, so turning workers off makes a
    // process write-only rather than disabling notifications.
    let service: QueueService;

    beforeEach(() => {
      service = new QueueService(
        configWith({ 'notifications.workerEnabled': false }),
      );
    });

    it('reports workers as disabled', () => {
      expect(service.workerEnabled).toBe(false);
    });

    it('registers no handler', async () => {
      let called = false;
      await service.work(QUEUES.NOTIFICATION_INGEST, async () => {
        called = true;
      });

      expect(called).toBe(false);
    });

    it('registers no schedule', async () => {
      await expect(
        service.schedule(
          QUEUES.NOTIFICATION_REMINDERS,
          '0 6 * * *',
          'Asia/Kolkata',
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('defaults', () => {
    it('enables workers when nothing says otherwise', () => {
      // Development and production both want workers; only the test
      // environment opts out. Defaulting the other way would mean a deployment
      // that silently delivers nothing.
      const service = new QueueService(configWith({}));

      expect(service.workerEnabled).toBe(true);
    });
  });

  describe('queue names', () => {
    it('declares every queue as a constant', () => {
      // pg-boss 12 requires a queue to exist before a send, and onModuleInit
      // creates exactly these. A queue name passed as a literal at a call site
      // would not be created, and its jobs would fail to enqueue.
      expect(Object.values(QUEUES)).toEqual([
        'notifications.ingest',
        'notifications.deliver',
        'notifications.reminders.daily',
        // Module 17. Payload-free: the handler derives its own Asia/Kolkata
        // business date, so a replica with a drifted clock cannot process a
        // different day than its peers.
        'maintenance.eod.daily',
      ]);
    });
  });

  describe('a queue that fails mid-flight', () => {
    it('swallows an enqueue failure', async () => {
      // Rules 60-62 again, at the other end: a source transaction has already
      // committed by the time anything is enqueued, so a queue error must be
      // logged and absorbed rather than propagated back to a caller that can no
      // longer roll back.
      const service = new QueueService(configWith({}));

      (service as unknown as { boss: unknown; started: boolean }).boss = {
        send: () => Promise.reject(new Error('connection lost')),
        sendAfter: () => Promise.reject(new Error('connection lost')),
      };
      (service as unknown as { started: boolean }).started = true;

      await expect(
        service.send(QUEUES.NOTIFICATION_INGEST, { orgId: 'o', eventId: 'e' }),
      ).resolves.toBeNull();
      await expect(
        service.sendAfter(
          QUEUES.NOTIFICATION_DELIVER,
          { orgId: 'o', notificationId: 'n' },
          60,
        ),
      ).resolves.toBeNull();
    });
  });
});
