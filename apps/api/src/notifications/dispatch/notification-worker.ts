import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { QUEUES, QueueService } from '../../queue/queue.service';
import { NotificationIngestionService } from '../ingestion/notification-ingestion.service';
import { ReminderSchedulerService } from '../scheduled/reminder-scheduler.service';
import { NotificationDispatchService } from './notification-dispatch.service';

/**
 * Wires the queue handlers to the services that do the work.
 *
 * A separate class from either service so that neither depends on the queue's
 * lifecycle: `NotificationIngestionService.process` and
 * `NotificationDispatchService.deliver` are ordinary methods that a test, a
 * controller (the manual retry) or a future replay tool can call directly.
 * Registration is the only thing that needs `OnModuleInit`, and it lives here
 * alone.
 *
 * Every handler takes ids and re-reads its row — see `QueueService`. The
 * payload is never trusted as content.
 */
@Injectable()
export class NotificationWorker implements OnModuleInit {
  private readonly logger = new Logger(NotificationWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly config: ConfigService,
    private readonly ingestion: NotificationIngestionService,
    private readonly dispatch: NotificationDispatchService,
    private readonly reminders: ReminderSchedulerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.work<{ orgId: string; eventId: string }>(
      QUEUES.NOTIFICATION_INGEST,
      (data) => this.ingestion.process(data.orgId, data.eventId),
    );

    await this.queue.work<{ orgId: string; notificationId: string }>(
      QUEUES.NOTIFICATION_DELIVER,
      (data) => this.dispatch.deliver(data.orgId, data.notificationId),
    );

    // The daily reminder sweep (Phase 7).
    //
    // pg-boss holds schedules in its own table and enforces one run per cron
    // expression per queue name across every connected instance, so registering
    // this from every replica produces one sweep a day rather than N.
    //
    // The handler takes no payload: the sweep derives its own business date
    // from the Asia/Kolkata clock. Passing a date in would let a replica with a
    // skewed clock raise a day's reminders twice under two different keys.
    await this.queue.work(QUEUES.NOTIFICATION_REMINDERS, () =>
      this.reminders.run().then(() => undefined),
    );

    await this.queue.schedule(
      QUEUES.NOTIFICATION_REMINDERS,
      this.config.get<string>('notifications.reminderCron') ?? '0 6 * * *',
      this.config.get<string>('notifications.reminderTimezone') ??
        'Asia/Kolkata',
    );
  }
}
