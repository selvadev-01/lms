import { Module } from '@nestjs/common';

import { EmailModule } from '../email/email.module';
import { SmsModule } from '../sms/sms.module';
import {
  NotificationDeliveryController,
  NotificationRuleController,
  NotificationTemplateController,
} from './admin/notification-admin.controller';
import { NotificationDeliveryService } from './admin/notification-delivery.service';
import { NotificationRuleService } from './admin/notification-rule.service';
import { NotificationTemplateService } from './admin/notification-template.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { PreferenceController } from './preferences/preference.controller';
import { PreferenceService } from './preferences/preference.service';
import { ReminderSchedulerService } from './scheduled/reminder-scheduler.service';
import { NotificationDispatchService } from './dispatch/notification-dispatch.service';
import { NotificationWorker } from './dispatch/notification-worker';
import { NotificationIngestionService } from './ingestion/notification-ingestion.service';
import { PreferenceEvaluatorService } from './preferences/preference-evaluator.service';
import { RecipientResolverService } from './recipients/recipient-resolver.service';
import { TemplateRendererService } from './templates/template-renderer.service';

/**
 * Module 16 — notifications.
 *
 * The *processing* half of the module. Raising an event lives in
 * `NotificationEventsModule`, which is separate and `@Global` — see its header
 * for why splitting them is what keeps the dependency graph acyclic.
 *
 * The pipeline, in order:
 *
 *   NotificationEventsService.emit   (elsewhere; called by business modules)
 *     → notifications.ingest
 *       → NotificationIngestionService.process
 *           → RecipientResolverService   who to notify (Rules 3, 4, 42-44)
 *           → PreferenceEvaluatorService whether to (Rules 46-48)
 *           → TemplateRendererService    what to say (Rules 25, 27, 40)
 *     → notifications.deliver
 *       → NotificationDispatchService.deliver
 *           → IN_APP / EmailService / SmsService, with bounded retry (19-21)
 *
 * `SmsModule` and `EmailModule` are imported rather than made global because
 * only the dispatch service should be able to send anything. Nothing else in
 * the application needs to reach a gateway directly, and a global export would
 * make that reachable by accident.
 */
@Module({
  imports: [SmsModule, EmailModule],
  /**
   * `PreferenceController` MUST come before `NotificationController`.
   *
   * Nest registers routes in the order controllers are listed here, and Express
   * matches the first pattern that fits. `NotificationController` declares
   * `GET /notifications/:notificationId`, which matches the literal path
   * `/notifications/preferences` — so with the other order, reading your
   * preferences returns a 400 from `ParseUUIDPipe` complaining that
   * "preferences" is not a UUID, and the preferences controller is unreachable.
   *
   * Within a controller, declaration order handles this (which is why
   * `unread-count` is declared above `:notificationId`). Across controllers,
   * only this array does.
   */
  controllers: [
    PreferenceController,
    NotificationController,
    NotificationTemplateController,
    NotificationRuleController,
    NotificationDeliveryController,
  ],
  providers: [
    RecipientResolverService,
    TemplateRendererService,
    PreferenceEvaluatorService,
    NotificationIngestionService,
    NotificationDispatchService,
    NotificationWorker,
    NotificationService,
    PreferenceService,
    NotificationTemplateService,
    NotificationRuleService,
    NotificationDeliveryService,
    ReminderSchedulerService,
  ],
  exports: [
    NotificationIngestionService,
    NotificationDispatchService,
    ReminderSchedulerService,
  ],
})
export class NotificationsModule {}
