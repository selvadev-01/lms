import { NotificationController } from './notification.controller';
import { NotificationsModule } from './notifications.module';
import { PreferenceController } from './preferences/preference.controller';

/**
 * Controller registration order.
 *
 * This file exists because of one bug that shipped and was caught only by an
 * HTTP check: `GET /notifications/preferences` returned
 * "Validation failed (uuid v 4 is expected)".
 *
 * `NotificationController` declares `GET /notifications/:notificationId`.
 * `PreferenceController` declares `GET /notifications/preferences`. Express
 * matches the first registered pattern that fits, and the parameterised one
 * fits the literal path — so with the wrong order the preferences screen is
 * unreachable and the error blames the caller for sending a bad UUID.
 *
 * Within a controller, declaration order settles this, which is why
 * `unread-count` is declared above `:notificationId`. Across controllers, only
 * the module's `controllers` array does, and nothing about that array's order
 * looks load-bearing when read.
 */
describe('NotificationsModule route registration', () => {
  function controllers(): unknown[] {
    // Reflect on the decorator metadata rather than booting Nest: this is a
    // property of the module definition, and asserting it needs no database.
    return (
      (Reflect.getMetadata('controllers', NotificationsModule) as unknown[]) ??
      []
    );
  }

  it('registers PreferenceController before NotificationController', () => {
    const registered = controllers();
    const preferences = registered.indexOf(PreferenceController);
    const notifications = registered.indexOf(NotificationController);

    expect(preferences).toBeGreaterThanOrEqual(0);
    expect(notifications).toBeGreaterThanOrEqual(0);

    // The assertion the bug would have failed. Swapping these two lines in the
    // module makes `/notifications/preferences` return a 400 and this test go
    // red — which is the whole point of it existing.
    expect(preferences).toBeLessThan(notifications);
  });

  it('declares unread-count before the :notificationId route', () => {
    // The same hazard one level down, inside a single controller. Nest reads
    // handler metadata in declaration order, so the literal must come first.
    const source = Object.getOwnPropertyNames(
      NotificationController.prototype,
    ).filter((name) => name !== 'constructor');

    expect(source.indexOf('unreadCount')).toBeLessThan(
      source.indexOf('detail'),
    );
  });
});
