import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { ConsoleEmailProvider } from './console-email.provider';
import { EmailService } from './email.service';
import { SmtpEmailProvider } from './smtp-email.provider';
import type {
  EmailDeliveryConfig,
  EmailMessage,
  EmailSendResult,
} from './email.provider';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

interface Row {
  orgId: string;
  provider: 'CONSOLE' | 'SMTP';
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  fromAddress: string | null;
  fromName: string | null;
  enabled: boolean;
}

function row(orgId: string, overrides: Partial<Row> = {}): Row {
  return {
    orgId,
    provider: 'SMTP',
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    username: 'lms',
    fromAddress: 'noreply@example.test',
    fromName: 'LMS',
    enabled: true,
    ...overrides,
  };
}

/** Records what each provider was asked to send, without touching a network. */
class Recorder {
  readonly sent: Array<{
    message: EmailMessage;
    config?: EmailDeliveryConfig;
  }> = [];

  send(
    message: EmailMessage,
    config?: EmailDeliveryConfig,
  ): Promise<EmailSendResult> {
    this.sent.push({ message, config });
    return Promise.resolve({ providerStatus: 'recorded' });
  }
}

const MESSAGE: EmailMessage = {
  to: 'officer@example.test',
  subject: 'Recovery case assigned',
  body: 'Case RC-0001 is now yours.',
};

/**
 * `EmailService` — choosing a gateway per organization.
 *
 * Deliberately the same test shape as `sms.service.spec.ts`, because the two
 * services solve the same problem and a reader who has understood one should
 * not have to re-derive the other.
 *
 * The properties worth pinning are the ones whose failure is silent: an
 * organization falling through to the wrong provider, a cache that outlives an
 * operator's edit, and an unknown environment value degrading to console — which
 * would look exactly like successful delivery while nothing was sent.
 */
describe('EmailService', () => {
  let rows: Row[];
  let queries: number;
  let consoleProvider: Recorder;
  let smtpProvider: Recorder;

  function build(envProvider = 'console'): EmailService {
    rows = rows ?? [];
    queries = 0;
    consoleProvider = new Recorder();
    smtpProvider = new Recorder();

    const prisma = {
      emailProviderConfig: {
        findUnique: ({ where }: { where: { orgId: string } }) => {
          queries += 1;
          return Promise.resolve(
            rows.find((candidate) => candidate.orgId === where.orgId) ?? null,
          );
        },
      },
    } as unknown as PrismaService;

    const config = {
      get: (key: string) =>
        key === 'notifications.emailProvider' ? envProvider : undefined,
    } as unknown as ConfigService;

    return new EmailService(
      prisma,
      config,
      consoleProvider as unknown as ConsoleEmailProvider,
      smtpProvider as unknown as SmtpEmailProvider,
    );
  }

  beforeEach(() => {
    rows = [];
  });

  describe('resolution order', () => {
    it('prefers the organization row over the environment default', () => {
      rows = [row(ORG_A)];
      const service = build('console');

      return service.send(ORG_A, MESSAGE).then(() => {
        expect(smtpProvider.sent).toHaveLength(1);
        expect(consoleProvider.sent).toHaveLength(0);
      });
    });

    it('passes the row addressing through to the provider', () => {
      rows = [
        row(ORG_A, { host: 'mail.branch.test', port: 465, secure: true }),
      ];
      const service = build();

      return service.send(ORG_A, MESSAGE).then(() => {
        expect(smtpProvider.sent[0].config).toMatchObject({
          host: 'mail.branch.test',
          port: 465,
          secure: true,
          fromAddress: 'noreply@example.test',
        });
      });
    });

    it('falls back to the environment default when an organization has no row', () => {
      const service = build('smtp');

      return service.send(ORG_A, MESSAGE).then(() => {
        expect(smtpProvider.sent).toHaveLength(1);
      });
    });

    it('falls back to console when nothing is configured anywhere', () => {
      // The property that keeps the EMAIL channel exercisable in development
      // and CI: an unconfigured organization logs its notifications rather than
      // failing them.
      const service = build();

      return service.send(ORG_A, MESSAGE).then(() => {
        expect(consoleProvider.sent).toHaveLength(1);
      });
    });

    it('ignores a disabled row and uses the environment default', () => {
      // Disabling is how an operator turns a misbehaving gateway off without
      // deleting its settings; it must not mean "send through it anyway".
      rows = [row(ORG_A, { enabled: false })];
      const service = build('console');

      return service.send(ORG_A, MESSAGE).then(() => {
        expect(consoleProvider.sent).toHaveLength(1);
        expect(smtpProvider.sent).toHaveLength(0);
      });
    });

    it('resolves each organization independently', () => {
      // Rule 1: everything in Module 16 is scoped by organization, and a shared
      // cache key would let one organization send through another's gateway.
      rows = [row(ORG_A), row(ORG_B, { provider: 'CONSOLE' })];
      const service = build();

      return service
        .send(ORG_A, MESSAGE)
        .then(() => service.send(ORG_B, MESSAGE))
        .then(() => {
          expect(smtpProvider.sent).toHaveLength(1);
          expect(consoleProvider.sent).toHaveLength(1);
        });
    });
  });

  describe('caching', () => {
    it('reads the row once for repeated sends', () => {
      // Dispatch runs per notification; without this, a fan-out to fifty
      // recipients would be fifty identical configuration reads.
      rows = [row(ORG_A)];
      const service = build();

      return service
        .send(ORG_A, MESSAGE)
        .then(() => service.send(ORG_A, MESSAGE))
        .then(() => service.send(ORG_A, MESSAGE))
        .then(() => {
          expect(queries).toBe(1);
          expect(smtpProvider.sent).toHaveLength(3);
        });
    });

    it('re-reads after an explicit invalidation', () => {
      // An operator editing a row must see it take effect without a redeploy.
      rows = [row(ORG_A)];
      const service = build();

      return service
        .send(ORG_A, MESSAGE)
        .then(() => {
          service.invalidate(ORG_A);
          return service.send(ORG_A, MESSAGE);
        })
        .then(() => {
          expect(queries).toBe(2);
        });
    });
  });

  describe('an unknown environment provider', () => {
    it('rejects rather than silently degrading to console', () => {
      // The failure mode this prevents is the worst kind: a typo in
      // EMAIL_PROVIDER that logs every notification to a file while the
      // delivery record says it was accepted. A rejected send is recorded as a
      // failure the dispatch service can classify and surface.
      const service = build('carrier-pigeon');

      return expect(service.send(ORG_A, MESSAGE)).rejects.toThrow(
        /Unknown EMAIL_PROVIDER/,
      );
    });
  });

  describe('the result it returns', () => {
    it('passes the provider reference back for the delivery record', () => {
      // Rule 18: the provider's own reference is preserved so a support
      // engineer can quote it back to the gateway.
      rows = [row(ORG_A)];
      const service = build();

      return service.send(ORG_A, MESSAGE).then((result) => {
        expect(result.providerStatus).toBe('recorded');
      });
    });
  });
});
