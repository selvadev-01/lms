import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { ConsoleSmsProvider } from './console-sms.provider';
import { SmsProvider, type SmsDeliveryConfig } from './sms.provider';
import { TwilioSmsProvider } from './twilio-sms.provider';

/** A resolved provider choice plus the addressing that goes with it. */
interface ResolvedProvider {
  kind: 'CONSOLE' | 'TWILIO';
  config: SmsDeliveryConfig;
}

/** How long a resolved configuration is reused before re-reading the row. */
const CACHE_TTL_MS = 60_000;

/**
 * Chooses an SMS gateway per organization and delegates delivery to it.
 *
 * This is what callers inject, rather than a concrete `SmsProvider`: the choice
 * is per-organization data, so it cannot be bound once at boot. A facade rather
 * than a REQUEST-scoped provider because request scoping is contagious — it
 * would force `RecoveryService`, and everything that injects it, to become
 * request-scoped too.
 *
 * Resolution order for each organization:
 *   1. its `sms_provider_configs` row, when one exists and is enabled
 *   2. the `SMS_PROVIDER` environment value
 *   3. `console`
 *
 * So an organization that has never been configured behaves exactly as it did
 * before this table existed.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  /**
   * Short-lived cache so recovery does not add a database read per request.
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
    private readonly consoleProvider: ConsoleSmsProvider,
    private readonly twilioProvider: TwilioSmsProvider,
  ) {}

  async send(orgId: string, to: string, body: string): Promise<void> {
    const resolved = await this.resolve(orgId);
    await this.providerFor(resolved.kind).send(to, body, resolved.config);
  }

  /** Drops the cached choice for an organization, for use after an edit. */
  invalidate(orgId: string): void {
    this.cache.delete(orgId);
  }

  private async resolve(orgId: string): Promise<ResolvedProvider> {
    const cached = this.cache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const row = await this.prisma.smsProviderConfig.findUnique({
      where: { orgId },
    });

    const value: ResolvedProvider =
      row && row.enabled
        ? {
            kind: row.provider,
            config: {
              messagingServiceSid: row.messagingServiceSid,
              fromNumber: row.fromNumber,
              defaultCountryCode: row.defaultCountryCode,
            },
          }
        : { kind: this.envKind(), config: {} };

    this.cache.set(orgId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  /** The deployment-wide fallback, used when an organization has no row. */
  private envKind(): ResolvedProvider['kind'] {
    const name = (
      this.config.get<string>('auth.smsProvider') ?? 'console'
    ).toLowerCase();

    switch (name) {
      case 'console':
        return 'CONSOLE';
      case 'twilio':
        return 'TWILIO';
      default:
        // Surfaced as a rejected send that the caller audits, rather than a
        // silent downgrade to console that would look like successful delivery.
        throw new Error(
          `Unknown SMS_PROVIDER "${name}". Supported providers: console, twilio.`,
        );
    }
  }

  private providerFor(kind: ResolvedProvider['kind']): SmsProvider {
    return kind === 'TWILIO' ? this.twilioProvider : this.consoleProvider;
  }
}
