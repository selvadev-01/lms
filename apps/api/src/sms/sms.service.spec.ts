import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { ConsoleSmsProvider } from './console-sms.provider';
import { SmsService } from './sms.service';
import { TwilioSmsProvider } from './twilio-sms.provider';
import type { SmsDeliveryConfig } from './sms.provider';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

interface Row {
  orgId: string;
  provider: 'CONSOLE' | 'TWILIO';
  messagingServiceSid: string | null;
  fromNumber: string | null;
  defaultCountryCode: string;
  enabled: boolean;
}

function row(orgId: string, overrides: Partial<Row> = {}): Row {
  return {
    orgId,
    provider: 'TWILIO',
    messagingServiceSid: null,
    fromNumber: '+15550000000',
    defaultCountryCode: '+91',
    enabled: true,
    ...overrides,
  };
}

/** Records what each provider was asked to send, without touching a network. */
class Recorder {
  readonly sent: Array<{ to: string; config?: SmsDeliveryConfig }> = [];
  send(to: string, _body: string, config?: SmsDeliveryConfig): Promise<void> {
    this.sent.push({ to, config });
    return Promise.resolve();
  }
}

describe('SmsService', () => {
  let rows: Row[];
  let queries: number;
  let consoleProvider: Recorder;
  let twilioProvider: Recorder;

  function build(envProvider = 'console'): SmsService {
    rows = rows ?? [];
    const prisma = {
      smsProviderConfig: {
        findUnique: ({ where }: { where: { orgId: string } }) => {
          queries += 1;
          return Promise.resolve(
            rows.find((r) => r.orgId === where.orgId) ?? null,
          );
        },
      },
    } as unknown as PrismaService;

    const config = {
      get: (key: string) =>
        key === 'auth.smsProvider' ? envProvider : undefined,
    } as unknown as ConfigService;

    return new SmsService(
      prisma,
      config,
      consoleProvider as unknown as ConsoleSmsProvider,
      twilioProvider as unknown as TwilioSmsProvider,
    );
  }

  beforeEach(() => {
    rows = [];
    queries = 0;
    consoleProvider = new Recorder();
    twilioProvider = new Recorder();
  });

  describe('fallback to the environment', () => {
    /**
     * The compatibility guarantee: an organization that has never been
     * configured behaves exactly as it did before this table existed, which is
     * what keeps the whole existing suite green.
     */
    it('uses the env provider when the organization has no row', async () => {
      await build('console').send(ORG_A, '9000000004', 'code');

      expect(consoleProvider.sent).toHaveLength(1);
      expect(twilioProvider.sent).toHaveLength(0);
    });

    it('honours SMS_PROVIDER=twilio as the deployment-wide default', async () => {
      await build('twilio').send(ORG_A, '9000000004', 'code');

      expect(twilioProvider.sent).toHaveLength(1);
    });

    it('ignores a disabled row and falls back to the environment', async () => {
      rows = [row(ORG_A, { enabled: false })];
      await build('console').send(ORG_A, '9000000004', 'code');

      expect(consoleProvider.sent).toHaveLength(1);
      expect(twilioProvider.sent).toHaveLength(0);
    });

    /**
     * Never silently downgrade to console: that would log the OTP locally and
     * report success while no SMS was sent. Rejecting lets the caller audit
     * RECOVERY_SMS_FAILED instead (Scenario 33).
     */
    it('rejects on an unknown env provider rather than downgrading', async () => {
      await expect(
        build('carrier-pigeon').send(ORG_A, '9000000004', 'code'),
      ).rejects.toThrow(/Unknown SMS_PROVIDER/);
    });
  });

  describe('per-organization selection', () => {
    it('uses the provider named on the row, over the env default', async () => {
      rows = [row(ORG_A)];
      await build('console').send(ORG_A, '9000000004', 'code');

      expect(twilioProvider.sent).toHaveLength(1);
      expect(consoleProvider.sent).toHaveLength(0);
    });

    it('passes the row addressing through to the provider', async () => {
      rows = [
        row(ORG_A, { messagingServiceSid: 'MGorg', defaultCountryCode: '+44' }),
      ];
      await build('console').send(ORG_A, '9000000004', 'code');

      expect(twilioProvider.sent[0].config).toMatchObject({
        messagingServiceSid: 'MGorg',
        defaultCountryCode: '+44',
      });
    });

    /** The actual point of the feature. */
    it('resolves two organizations independently', async () => {
      rows = [row(ORG_A, { provider: 'TWILIO' })];
      const service = build('console');

      await service.send(ORG_A, '9000000004', 'code');
      await service.send(ORG_B, '9000000001', 'code');

      expect(twilioProvider.sent).toHaveLength(1);
      expect(consoleProvider.sent).toHaveLength(1);
    });
  });

  describe('caching', () => {
    it('reads the row once across repeated sends', async () => {
      rows = [row(ORG_A)];
      const service = build('console');

      await service.send(ORG_A, '9000000004', 'code');
      await service.send(ORG_A, '9000000004', 'code');
      await service.send(ORG_A, '9000000004', 'code');

      expect(queries).toBe(1);
      expect(twilioProvider.sent).toHaveLength(3);
    });

    it('caches each organization separately', async () => {
      const service = build('console');
      await service.send(ORG_A, '9000000004', 'code');
      await service.send(ORG_B, '9000000001', 'code');

      expect(queries).toBe(2);
    });

    it('re-reads after the entry is invalidated', async () => {
      rows = [row(ORG_A)];
      const service = build('console');

      await service.send(ORG_A, '9000000004', 'code');
      rows = [row(ORG_A, { provider: 'CONSOLE' })];
      service.invalidate(ORG_A);
      await service.send(ORG_A, '9000000004', 'code');

      expect(queries).toBe(2);
      expect(consoleProvider.sent).toHaveLength(1);
    });
  });
});
