import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// A NAMED import, deliberately. pg-boss 12 is an ESM package ("type": "module")
// whose CommonJS interop exposes `PgBoss` as a named export and no default —
// `import PgBoss from 'pg-boss'` type-checks against the namespace and then
// fails at runtime with "not constructable".
import { PgBoss, type SendOptions } from 'pg-boss';

/**
 * The queue names this application uses.
 *
 * Written out rather than passed as strings at each call site: a typo does not
 * fail loudly — it creates a second queue that nothing consumes, and the jobs
 * sit there forever looking like a delivery bug.
 */
export const QUEUES = {
  /** One authoritative source event, awaiting rule matching and fan-out. */
  NOTIFICATION_INGEST: 'notifications.ingest',
  /** One notification, awaiting a delivery attempt on its channel. */
  NOTIFICATION_DELIVER: 'notifications.deliver',
  /** The daily Asia/Kolkata reminder sweep. */
  NOTIFICATION_REMINDERS: 'notifications.reminders.daily',
  /**
   * The nightly end-of-day sweep (Module 17).
   *
   * Carries no payload. The handler derives its own business date from the
   * Asia/Kolkata clock, so a replica whose clock has drifted cannot process a
   * different day than its peers — the same reasoning as the reminder sweep
   * above. Duplicate protection is separate and stronger: every run claims a
   * unique `executionKey`, so even two handlers firing at once produce one run.
   */
  MAINTENANCE_EOD: 'maintenance.eod.daily',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** What a handler receives. Ids only — see the note on `send`. */
export interface JobPayload {
  [key: string]: unknown;
}

/**
 * The job queue.
 *
 * pg-boss rather than BullMQ because it is backed by the Postgres this
 * application already has: no Redis to provision, no second thing to fail, and
 * a job visible in the same database as the row it refers to.
 *
 * # pg-boss owns its own schema
 *
 * It creates and migrates a `pgboss` schema itself on `start()`. That schema
 * MUST NOT be added to `schema.prisma`. Prisma's `migrate diff` reports anything
 * present in the database and absent from the datamodel as drift, and would
 * happily generate `DROP SCHEMA pgboss CASCADE` into the next migration —
 * destroying every queued job. Keeping it outside the datamodel is what makes
 * the two migration systems coexist.
 *
 * # Jobs carry ids, never content
 *
 * Every payload is `{ orgId, someId }`. A job payload is a second copy of the
 * truth: enqueue a rendered message and it can be stale by the time the worker
 * runs — the notification archived, the recipient deactivated, the source
 * transaction reversed. Handlers re-read the Prisma row instead, so they always
 * act on current state. It also keeps money and PII out of the queue tables.
 *
 * # Workers run in-process, on every replica
 *
 * That is correct rather than duplicative: pg-boss locks a job while it is being
 * worked, so N replicas share the load instead of each doing all of it.
 * Scheduled jobs are singleton per queue name, so N replicas produce one daily
 * sweep and not N.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);

  private boss: PgBoss | null = null;

  /**
   * Registrations captured before `start()` completes.
   *
   * Nest calls `onModuleInit` in dependency order, and a module that depends on
   * this one may register a worker before or after this service is ready.
   * Buffering removes the ordering requirement entirely, rather than making
   * every consumer aware of it.
   */
  private readonly pending: Array<() => Promise<void>> = [];

  private started = false;

  constructor(private readonly config: ConfigService) {}

  /** Whether this process registers workers, or only enqueues. */
  get workerEnabled(): boolean {
    return this.config.get<boolean>('notifications.workerEnabled') ?? true;
  }

  async onModuleInit(): Promise<void> {
    const connectionString = this.config.get<string>('DATABASE_URL');
    if (!connectionString) {
      // Not thrown: the queue is not required for the application to serve
      // requests, and a missing DATABASE_URL will already have failed
      // `validateEnv` far more legibly than a queue error would.
      this.logger.error('DATABASE_URL is unset; the job queue is disabled.');
      return;
    }

    this.boss = new PgBoss({
      connectionString,
      // pg-boss self-migrates this schema. It is deliberately absent from
      // schema.prisma — see the class comment.
      schema: 'pgboss',
      migrate: true,
    });

    // An unhandled 'error' event would otherwise reach the process as an
    // uncaught exception and take the API down over a queue problem — exactly
    // the coupling Rule 62 forbids between notification infrastructure and the
    // business it serves.
    this.boss.on('error', (error: Error) => {
      this.logger.error(`pg-boss error: ${error.message}`, error.stack);
    });

    await this.boss.start();

    // pg-boss 12 requires queues to exist before a job is sent to them. Created
    // here rather than lazily so that a send never races a create, and so
    // retention is declared in one place.
    //
    // `deleteAfterSeconds` is queue bookkeeping only. The authoritative
    // notification history lives in `notifications` and
    // `notification_deliveries` and is never purged (Rules 69, 70).
    const retentionDays =
      this.config.get<number>('notifications.jobRetentionDays') ?? 7;
    for (const name of Object.values(QUEUES)) {
      await this.boss.createQueue(name, {
        deleteAfterSeconds: retentionDays * 24 * 60 * 60,
      });
    }

    this.started = true;
    this.logger.log(
      `Job queue started (workers ${this.workerEnabled ? 'enabled' : 'disabled'}).`,
    );

    for (const register of this.pending.splice(0)) {
      await register();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.boss) return;
    // Graceful: lets in-flight handlers finish rather than orphaning jobs in an
    // active state, which would leave them invisible until their lock expired.
    await this.boss.stop({ graceful: true });
    this.started = false;
    this.boss = null;
  }

  /**
   * Enqueue one job.
   *
   * `data` must contain identifiers only, never rendered content or money — see
   * the class comment.
   *
   * Returns the job id, or null when the queue is unavailable. Never throws: a
   * caller that could be broken by a queue failure would make notification
   * infrastructure able to fail a business transaction, which Rules 60-62
   * forbid.
   */
  async send(
    queue: QueueName,
    data: JobPayload,
    options: SendOptions = {},
  ): Promise<string | null> {
    if (!this.boss || !this.started) {
      this.logger.warn(
        `Queue unavailable; dropped a ${queue} job. A scheduled event will be ` +
          'recovered by the next sweep; a state-change event will not.',
      );
      return null;
    }

    try {
      return await this.boss.send(queue, data, options);
    } catch (error) {
      this.logger.error(
        `Could not enqueue ${queue}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Enqueue a job to run no earlier than `seconds` from now.
   *
   * This is how a scheduled retry is expressed (Rules 19, 21): the dispatch
   * service computes a deterministic backoff and hands it here, rather than a
   * sweep polling for due retries.
   */
  async sendAfter(
    queue: QueueName,
    data: JobPayload,
    seconds: number,
  ): Promise<string | null> {
    if (!this.boss || !this.started) {
      this.logger.warn(`Queue unavailable; dropped a delayed ${queue} job.`);
      return null;
    }

    try {
      return await this.boss.sendAfter(queue, data, null, seconds);
    } catch (error) {
      this.logger.error(
        `Could not enqueue delayed ${queue}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Register a handler.
   *
   * A no-op when workers are disabled for this process, so the Jest suite and a
   * write-only replica can construct the module without polling a database.
   *
   * The handler is wrapped so a thrown error is logged and re-thrown: pg-boss
   * needs the throw to mark the job failed and apply its own retry, while the
   * log is what makes a failing handler visible rather than silently
   * accumulating dead jobs.
   */
  async work<T extends JobPayload>(
    queue: QueueName,
    handler: (data: T) => Promise<void>,
  ): Promise<void> {
    if (!this.workerEnabled) {
      this.logger.debug(`Workers disabled; not consuming ${queue}.`);
      return;
    }

    const register = async (): Promise<void> => {
      if (!this.boss) return;

      await this.boss.work<T>(
        queue,
        {
          batchSize:
            this.config.get<number>('notifications.workerBatchSize') ?? 10,
          pollingIntervalSeconds:
            this.config.get<number>(
              'notifications.workerPollIntervalSeconds',
            ) ?? 5,
        },
        async (jobs) => {
          for (const job of jobs) {
            try {
              await handler(job.data);
            } catch (error) {
              this.logger.error(
                `${queue} job ${job.id} failed: ${(error as Error).message}`,
                (error as Error).stack,
              );
              throw error;
            }
          }
        },
      );

      this.logger.log(`Consuming ${queue}.`);
    };

    if (this.started) {
      await register();
    } else {
      this.pending.push(register);
    }
  }

  /**
   * Register a cron schedule.
   *
   * pg-boss holds schedules in its own table and enforces one run per
   * expression per queue name across every connected instance, so this is safe
   * to call from every replica — which is exactly why the reminder sweep can be
   * registered here rather than in a separate singleton deployment.
   */
  async schedule(
    queue: QueueName,
    cron: string,
    timezone: string,
  ): Promise<void> {
    if (!this.workerEnabled) {
      this.logger.debug(`Workers disabled; not scheduling ${queue}.`);
      return;
    }

    const register = async (): Promise<void> => {
      if (!this.boss) return;
      await this.boss.schedule(queue, cron, {}, { tz: timezone });
      this.logger.log(`Scheduled ${queue} at "${cron}" (${timezone}).`);
    };

    if (this.started) {
      await register();
    } else {
      this.pending.push(register);
    }
  }
}
