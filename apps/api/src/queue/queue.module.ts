import { Global, Module } from '@nestjs/common';

import { QueueService } from './queue.service';

/**
 * The job queue.
 *
 * `@Global` so a module that needs to enqueue does not have to import it, and —
 * more importantly — so `NotificationEventsModule` can stay dependency-free.
 * That module is itself global and injected by nearly every business service; if
 * it had to import a queue module, every consumer would acquire a transitive
 * dependency on notification infrastructure, which is the coupling Module 16 is
 * organized to avoid.
 *
 * One service, deliberately: pg-boss's own instance is private to it, so nothing
 * else can start, stop or reconfigure the queue.
 */
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
