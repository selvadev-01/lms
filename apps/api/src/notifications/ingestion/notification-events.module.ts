import { Global, Module } from '@nestjs/common';

import { NotificationEventsService } from './notification-events.service';

/**
 * How every other module raises a notification event.
 *
 * `@Global`, and deliberately the smallest module in the codebase: one service,
 * one method, no imports of its own beyond the global Prisma, queue and audit
 * modules.
 *
 * The globality is what keeps the dependency graph acyclic. Nine business
 * services across seven modules emit events. If they had to
 * `imports: [NotificationsModule]`, then `NotificationsModule` — which needs
 * `LoansModule` and `RecoveryModule` to resolve `ASSIGNED_USER` and
 * `RECORD_OWNER` recipients from live source rows — would close a cycle. Nest
 * would report it as an unresolvable circular dependency at boot, and the usual
 * escape (`forwardRef`) would leave the cycle in place while hiding it.
 *
 * Separating the *emit* half from the rest of Module 16 breaks the cycle at its
 * narrowest point: business modules depend on this, this depends on nothing of
 * theirs, and the heavyweight `NotificationsModule` depends on both.
 */
@Global()
@Module({
  providers: [NotificationEventsService],
  exports: [NotificationEventsService],
})
export class NotificationEventsModule {}
