import { AuditService } from '../../audit/audit.service';
import { EmailSendError } from '../../email/email.provider';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { SmsService } from '../../sms/sms.service';
import { FAILURE_CODES } from '../notification-policy';
import { NotificationDispatchService } from './notification-dispatch.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const NOTIFICATION = '22222222-2222-2222-2222-222222222222';

interface Recorded {
  deliveries: Array<Record<string, unknown>>;
  deliveryUpdates: Array<Record<string, unknown>>;
  notificationUpdates: Array<Record<string, unknown>>;
  enqueued: Array<{ seconds: number }>;
  auditActions: string[];
}

/**
 * Builds a dispatch service over an in-memory Prisma stand-in.
 *
 * `$transaction` here takes an array of already-evaluated promises, matching how
 * the service calls it — the update builders run eagerly and record themselves,
 * which is what lets the assertions read what was written.
 */
function build(input: {
  notification?: Partial<{
    status: string;
    ruleId: string | null;
    deliveries: Array<{ attemptNumber: number; channel: string }>;
    recipientUser: { email: string | null; mobile: string | null } | null;
  }>;
  rule?: Partial<{
    channel: string;
    maxAttempts: number;
    backoffBaseSeconds: number;
  }> | null;
  emailBehaviour?: () => Promise<{
    providerMessageId?: string | null;
    providerStatus?: string | null;
  }>;
}): { service: NotificationDispatchService; recorded: Recorded } {
  const recorded: Recorded = {
    deliveries: [],
    deliveryUpdates: [],
    notificationUpdates: [],
    enqueued: [],
    auditActions: [],
  };

  const notification = {
    orgId: ORG,
    notificationId: NOTIFICATION,
    status: 'QUEUED',
    ruleId: 'rule-1',
    title: 'Case RC-0001 assigned',
    message: 'Case RC-0001 is yours.',
    recipientUser: { email: 'a@example.test', mobile: '9000000001' },
    deliveries: [],
    ...input.notification,
  };

  const prisma = {
    notification: {
      findUnique: () => Promise.resolve(notification),
      update: (args: Record<string, unknown>) => {
        recorded.notificationUpdates.push(
          (args.data ?? {}) as Record<string, unknown>,
        );
        return Promise.resolve({});
      },
    },
    notificationEventRule: {
      findUnique: () =>
        Promise.resolve(
          input.rule === null
            ? null
            : {
                channel: 'EMAIL',
                maxAttempts: 5,
                backoffBaseSeconds: 60,
                ...input.rule,
              },
        ),
    },
    notificationDelivery: {
      create: (args: { data: Record<string, unknown> }) => {
        recorded.deliveries.push(args.data);
        return Promise.resolve({
          deliveryId: `d${recorded.deliveries.length}`,
        });
      },
      update: (args: Record<string, unknown>) => {
        recorded.deliveryUpdates.push(
          (args.data ?? {}) as Record<string, unknown>,
        );
        return Promise.resolve({});
      },
    },
    $transaction: (operations: unknown[]) => Promise.all(operations),
  } as unknown as PrismaService;

  const queue = {
    sendAfter: (_queue: string, _data: unknown, seconds: number) => {
      recorded.enqueued.push({ seconds });
      return Promise.resolve('job');
    },
    send: () => Promise.resolve('job'),
  } as unknown as QueueService;

  const audit = {
    record: (entry: { action: string }) => {
      recorded.auditActions.push(entry.action);
      return Promise.resolve();
    },
  } as unknown as AuditService;

  const email = {
    send:
      input.emailBehaviour ??
      (() =>
        Promise.resolve({
          providerMessageId: 'msg-1',
          providerStatus: '250 OK',
        })),
  } as unknown as EmailService;

  const sms = { send: () => Promise.resolve() } as unknown as SmsService;

  return {
    service: new NotificationDispatchService(prisma, queue, audit, email, sms),
    recorded,
  };
}

/**
 * `NotificationDispatchService`.
 *
 * Three guarantees are worth pinning, each with a silent failure mode:
 *
 *  1. **An external provider accepting is not delivery** (Rule 17, Scenario 27).
 *     Collapsing the two would make the system claim deliveries it cannot
 *     observe, and nothing would look wrong.
 *  2. **A permanent failure never retries** (Rules 20, 29). Getting this wrong
 *     burns the attempt budget on something that cannot succeed.
 *  3. **The attempt row is written before the provider is called** (Rule 13,
 *     Scenario 24). This is what makes a duplicate send impossible rather than
 *     unlikely.
 */
describe('NotificationDispatchService', () => {
  describe('Rule 17 and Scenario 27: what a success may claim', () => {
    it('records an accepted email as ACCEPTED_BY_PROVIDER, never DELIVERED', async () => {
      const { service, recorded } = build({});

      await service.deliver(ORG, NOTIFICATION);

      expect(recorded.deliveryUpdates[0].status).toBe('ACCEPTED_BY_PROVIDER');
      expect(recorded.deliveryUpdates[0].deliveredAt).toBeNull();
    });

    it('records an in-app delivery as DELIVERED, the one honest case', async () => {
      // The LMS itself is the delivery for IN_APP — the row the recipient reads
      // is the message.
      const { service, recorded } = build({ rule: { channel: 'IN_APP' } });

      await service.deliver(ORG, NOTIFICATION);

      expect(recorded.deliveryUpdates[0].status).toBe('DELIVERED');
      expect(recorded.deliveryUpdates[0].deliveredAt).toBeInstanceOf(Date);
    });

    it('preserves the provider reference and raw status (Rule 18)', async () => {
      const { service, recorded } = build({});

      await service.deliver(ORG, NOTIFICATION);

      expect(recorded.deliveryUpdates[0].providerMessageId).toBe('msg-1');
      expect(recorded.deliveryUpdates[0].providerStatus).toBe('250 OK');
    });

    it('marks the notification SENT, not delivered', async () => {
      const { service, recorded } = build({});

      await service.deliver(ORG, NOTIFICATION);

      const update = recorded.notificationUpdates.at(-1);
      expect(update?.status).toBe('SENT');
    });
  });

  describe('Rule 13 and Scenario 24: one attempt row per attempt', () => {
    it('writes the attempt before calling the provider', async () => {
      // If the process dies mid-call the attempt is visible rather than
      // invisible, and two dispatchers racing collide on the unique index
      // before either sends.
      let providerCalledAfterInsert = false;
      const { service, recorded } = build({
        emailBehaviour: () => {
          providerCalledAfterInsert = recorded.deliveries.length === 1;
          return Promise.resolve({ providerStatus: 'ok' });
        },
      });

      await service.deliver(ORG, NOTIFICATION);

      expect(providerCalledAfterInsert).toBe(true);
    });

    it('numbers a retry as the next attempt on the same notification', async () => {
      // A retry is a new attempt under the SAME logical notification, never a
      // second notification.
      const { service, recorded } = build({
        notification: {
          status: 'RETRYING',
          deliveries: [
            { attemptNumber: 1, channel: 'EMAIL' },
            { attemptNumber: 2, channel: 'EMAIL' },
          ],
        },
      });

      await service.deliver(ORG, NOTIFICATION);

      expect(recorded.deliveries[0].attemptNumber).toBe(3);
    });

    it('numbers attempts per channel', async () => {
      const { service, recorded } = build({
        notification: {
          status: 'RETRYING',
          deliveries: [{ attemptNumber: 4, channel: 'SMS' }],
        },
      });

      await service.deliver(ORG, NOTIFICATION);

      expect(recorded.deliveries[0].attemptNumber).toBe(1);
    });
  });

  describe('terminal states are not re-attempted', () => {
    it.each(['SENT', 'SUPPRESSED', 'ARCHIVED'])(
      'does nothing for a %s notification',
      async (status) => {
        // What makes at-least-once queue delivery safe: a redelivered job for
        // an already-sent notification is a no-op, not a second send.
        const { service, recorded } = build({ notification: { status } });

        await service.deliver(ORG, NOTIFICATION);

        expect(recorded.deliveries).toHaveLength(0);
      },
    );
  });

  describe('Scenario 28: a transient failure schedules a retry', () => {
    it('records RETRY_SCHEDULED with a next attempt time', async () => {
      const { service, recorded } = build({
        emailBehaviour: () =>
          Promise.reject(
            new EmailSendError(
              'greylisted',
              FAILURE_CODES.TRANSIENT_PROVIDER_ERROR,
            ),
          ),
      });

      await service.deliver(ORG, NOTIFICATION);

      expect(recorded.deliveryUpdates[0].status).toBe('RETRY_SCHEDULED');
      expect(recorded.deliveryUpdates[0].nextRetryAt).toBeInstanceOf(Date);
      expect(recorded.notificationUpdates.at(-1)?.status).toBe('RETRYING');
    });

    it('enqueues the retry with the deterministic backoff (Rule 21)', async () => {
      const { service, recorded } = build({
        emailBehaviour: () =>
          Promise.reject(
            new EmailSendError('timeout', FAILURE_CODES.PROVIDER_TIMEOUT),
          ),
      });

      await service.deliver(ORG, NOTIFICATION);

      // First attempt fails -> 60s, the configured base.
      expect(recorded.enqueued).toEqual([{ seconds: 60 }]);
    });

    it('doubles the delay on a later attempt', async () => {
      const { service, recorded } = build({
        notification: {
          status: 'RETRYING',
          deliveries: [
            { attemptNumber: 1, channel: 'EMAIL' },
            { attemptNumber: 2, channel: 'EMAIL' },
          ],
        },
        emailBehaviour: () =>
          Promise.reject(
            new EmailSendError('timeout', FAILURE_CODES.PROVIDER_TIMEOUT),
          ),
      });

      await service.deliver(ORG, NOTIFICATION);

      // Attempt 3 -> 60 * 2^2.
      expect(recorded.enqueued).toEqual([{ seconds: 240 }]);
    });
  });

  describe('Rules 20, 29 and Scenario 29: a permanent failure stops', () => {
    it.each([
      FAILURE_CODES.PERMANENT_PROVIDER_ERROR,
      FAILURE_CODES.INVALID_RECIPIENT,
      FAILURE_CODES.MISSING_CONTACT,
      FAILURE_CODES.CHANNEL_NOT_CONFIGURED,
    ])('records %s as terminal and schedules nothing', async (failureCode) => {
      const { service, recorded } = build({
        emailBehaviour: () =>
          Promise.reject(new EmailSendError('rejected', failureCode)),
      });

      await service.deliver(ORG, NOTIFICATION);

      expect(recorded.deliveryUpdates[0].status).toBe('PERMANENT_FAILURE');
      expect(recorded.deliveryUpdates[0].nextRetryAt).toBeNull();
      expect(recorded.enqueued).toHaveLength(0);
      expect(recorded.notificationUpdates.at(-1)?.status).toBe('FAILED');
    });

    it('treats a recipient with no email as permanent, not transient', async () => {
      // Retrying a send to an address that does not exist burns the whole
      // attempt budget to reach the same answer; the fix is a data change.
      const { service, recorded } = build({
        notification: { recipientUser: { email: null, mobile: '9000000001' } },
      });

      await service.deliver(ORG, NOTIFICATION);

      expect(recorded.deliveryUpdates[0].failureCode).toBe(
        FAILURE_CODES.MISSING_CONTACT,
      );
      expect(recorded.enqueued).toHaveLength(0);
    });
  });

  describe('Rule 20 and Scenario 30: the attempt cap is terminal', () => {
    it('stops once the configured maximum is reached', async () => {
      const { service, recorded } = build({
        rule: { maxAttempts: 3 },
        notification: {
          status: 'RETRYING',
          deliveries: [
            { attemptNumber: 1, channel: 'EMAIL' },
            { attemptNumber: 2, channel: 'EMAIL' },
          ],
        },
        emailBehaviour: () =>
          Promise.reject(
            new EmailSendError('timeout', FAILURE_CODES.PROVIDER_TIMEOUT),
          ),
      });

      await service.deliver(ORG, NOTIFICATION);

      // Attempt 3 of 3 fails: retryable by classification, terminal by cap.
      expect(recorded.deliveryUpdates[0].status).toBe('PERMANENT_FAILURE');
      expect(recorded.enqueued).toHaveLength(0);
    });

    it('refuses to attempt at all beyond the cap', async () => {
      const { service, recorded } = build({
        rule: { maxAttempts: 2 },
        notification: {
          status: 'RETRYING',
          deliveries: [
            { attemptNumber: 1, channel: 'EMAIL' },
            { attemptNumber: 2, channel: 'EMAIL' },
          ],
        },
      });

      await service.deliver(ORG, NOTIFICATION);

      // No provider call, no new attempt row — the cap is checked first.
      expect(recorded.deliveries).toHaveLength(0);
      expect(recorded.notificationUpdates.at(-1)?.status).toBe('FAILED');
    });
  });

  describe('Rule 73: every outcome is audited', () => {
    it('records the attempt and its acceptance', async () => {
      const { service, recorded } = build({});

      await service.deliver(ORG, NOTIFICATION);

      expect(recorded.auditActions).toContain(
        'NOTIFICATION_DELIVERY_ATTEMPTED',
      );
      expect(recorded.auditActions).toContain('NOTIFICATION_DELIVERY_ACCEPTED');
    });

    it('distinguishes a scheduled retry from a permanent failure', async () => {
      const { service, recorded } = build({
        emailBehaviour: () =>
          Promise.reject(
            new EmailSendError('timeout', FAILURE_CODES.PROVIDER_TIMEOUT),
          ),
      });

      await service.deliver(ORG, NOTIFICATION);

      expect(recorded.auditActions).toContain(
        'NOTIFICATION_DELIVERY_RETRY_SCHEDULED',
      );
      expect(recorded.auditActions).not.toContain(
        'NOTIFICATION_DELIVERY_PERMANENTLY_FAILED',
      );
    });
  });
});
