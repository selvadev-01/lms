import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { QUEUES, QueueService } from '../queue/queue.service';
import { EodSweepService } from './eod-sweep.service';

/**
 * Registers the nightly EOD sweep on the queue.
 *
 * A separate class from `EodSweepService` for the same reason
 * `NotificationWorker` is separate from the services it drives: the sweep is an
 * ordinary method a test, a controller or a hand-run replay can call, and only
 * the registration needs `OnModuleInit`.
 *
 * # The handler takes no payload
 *
 * It derives its own business date from the Asia/Kolkata clock, so a replica
 * with a drifted clock cannot process a different day than its peers. pg-boss
 * enforces one run per cron expression per queue name across every connected
 * instance, so registering from every replica still produces one sweep a night.
 *
 * That is belt and braces rather than the real protection: even if two handlers
 * fired, each organization's run claims a unique `executionKey`, so the second
 * would be recognised as a duplicate and start no work (Scenarios 22, 66).
 *
 * # Default schedule
 *
 * 21:30 Asia/Kolkata — after the working day, before midnight, so the run's
 * derived business date is still the day being closed. Moving it past midnight
 * would silently close the FOLLOWING day, because the handler derives its date
 * from the clock rather than being told.
 */
@Injectable()
export class EodWorker implements OnModuleInit {
  private readonly logger = new Logger(EodWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly config: ConfigService,
    private readonly sweep: EodSweepService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.work(QUEUES.MAINTENANCE_EOD, () =>
      this.sweep.run().then(() => undefined),
    );

    await this.queue.schedule(
      QUEUES.MAINTENANCE_EOD,
      this.config.get<string>('maintenance.eodCron') ?? '30 21 * * *',
      // Not configurable, and deliberately so: the business date these runs
      // close is Asia/Kolkata by Rule 65, and a different scheduling timezone
      // would fire the sweep on a day boundary the data does not share.
      'Asia/Kolkata',
    );
  }
}
