import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { ConsoleEmailProvider } from './console-email.provider';
import {
  EmailProvider,
  type EmailDeliveryConfig,
  type EmailMessage,
  type EmailSendResult,
} from './email.provider';
import { SmtpEmailProvider } from './smtp-email.provider';

/** A resolved provider choice plus the addressing that goes with it. */
interface ResolvedProvider {
  kind: 'CONSOLE' | 'SMTP';
  config: EmailDeliveryConfig;
}

/** How long a resolved configuration is reused before re-reading the row. */
const CACHE_TTL_MS = 60_000;

/**
 * Chooses an email gateway per organization and delegates delivery to it.
 *
 * Deliberately shaped exactly like `SmsService`, down to the cache TTL: the two
 * solve the same problem, and a reader who has understood one should not have
 * to re-derive the other.
 *
 * This is what callers inject, rather than a concrete `EmailProvider`: the
 * choice is per-organization data, so it cannot be bound once at boot. A facade
 * rather than a REQUEST-scoped provider because request scoping is contagious —
 * it would force the dispatch service, and everything that injects it, to become
 * request-scoped too, and the dispatch service runs from a queue worker where
 * there is no request at all.
 *
 * Resolution order for each organization:
 *   1. its `email_provider_configs` row, when one exists and is enabled
 *   2. the `EMAIL_PROVIDER` environment value
 *   3. `console`
 *
 * So an organization that has never been configured logs its notifications
 * rather than failing them, which is what keeps the EMAIL channel exercisable
 * in development and CI.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  /**
   * Short-lived cache so dispatch does not add a database read per delivery.
   * The TTL is deliberately brief: an operator changing a row should see it
   * take effect without a redeploy.
   */
  private readonly cache = new Map<
    string,
    { value: ResolvedProvider; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly consoleProvider: ConsoleEmailProvider,
    private readonly smtpProvider: SmtpEmailProvider,
  ) {}

  /**
   * Send one message.
   *
   * Rejects with an `EmailSendError` on failure — never resolves. The dispatch
   * service records the attempt and decides whether to retry; a swallowed error
   * here would be recorded as a successful send of a message nobody received.
   */
  async send(orgId: string, message: EmailMessage): Promise<EmailSendResult> {
    const resolved = await this.resolve(orgId);
    return this.providerFor(resolved.kind).send(message, resolved.config);
  }

  /** Drops the cached choice for an organization, for use after an edit. */
  invalidate(orgId: string): void {
    this.cache.delete(orgId);
  }

  private async resolve(orgId: string): Promise<ResolvedProvider> {
    const cached = this.cache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const row = await this.prisma.emailProviderConfig.findUnique({
      where: { orgId },
    });

    const value: ResolvedProvider =
      row && row.enabled
        ? {
            kind: row.provider,
            config: {
              host: row.host,
              port: row.port,
              secure: row.secure,
              username: row.username,
              fromAddress: row.fromAddress,
              fromName: row.fromName,
            },
          }
        : { kind: this.envKind(), config: {} };

    this.cache.set(orgId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  /** The deployment-wide fallback, used when an organization has no row. */
  private envKind(): ResolvedProvider['kind'] {
    const name = (
      this.config.get<string>('notifications.emailProvider') ?? 'console'
    ).toLowerCase();

    switch (name) {
      case 'console':
        return 'CONSOLE';
      case 'smtp':
        return 'SMTP';
      default:
        // Surfaced as a rejected send the dispatch service records, rather than
        // a silent downgrade to console that would look like a delivery.
        throw new Error(
          `Unknown EMAIL_PROVIDER "${name}". Supported providers: console, smtp.`,
        );
    }
  }

  private providerFor(kind: ResolvedProvider['kind']): EmailProvider {
    return kind === 'SMTP' ? this.smtpProvider : this.consoleProvider;
  }
}
