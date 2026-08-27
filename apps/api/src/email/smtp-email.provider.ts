import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

import {
  FAILURE_CODES,
  type FailureCode,
} from '../notifications/notification-policy';
import {
  EmailProvider,
  EmailSendError,
  type EmailDeliveryConfig,
  type EmailMessage,
  type EmailSendResult,
} from './email.provider';

/**
 * The subset of a nodemailer error the classifier reads.
 *
 * Nodemailer rejects with a plain `Error` carrying extra fields rather than a
 * typed class, so this is a structural view of it rather than an import.
 */
interface SmtpError extends Error {
  /** The SMTP reply code — 4xx transient, 5xx permanent. */
  responseCode?: number;
  /** Nodemailer's own code, e.g. ETIMEDOUT, ECONNECTION, EAUTH, EENVELOPE. */
  code?: string;
  response?: string;
}

/**
 * Outbound email over SMTP.
 *
 * # Transports are cached by configuration, not by organization
 *
 * A transport holds a connection pool, so building one per send would open a
 * TCP connection per notification. Caching by a fingerprint of the resolved
 * configuration rather than by `orgId` means an operator editing an
 * organization's SMTP row gets a new transport on the next send without an
 * explicit invalidation — the old fingerprint simply stops being requested.
 *
 * # Failures are classified here, not by the caller
 *
 * This is the only place that knows what nodemailer's error shapes mean, so it
 * is where the retryable/permanent decision Rules 19 and 20 turn on is made.
 * Getting it wrong is costly in both directions: retrying a 5xx is Rule 20's
 * "retry indefinitely" in slow motion, and giving up on a 4xx greylist loses a
 * notification that would have arrived on the second attempt.
 */
@Injectable()
export class SmtpEmailProvider extends EmailProvider {
  private readonly logger = new Logger(SmtpEmailProvider.name);

  private readonly transports = new Map<string, Transporter>();

  constructor(private readonly config: ConfigService) {
    super();
  }

  async send(
    message: EmailMessage,
    config: EmailDeliveryConfig = {},
  ): Promise<EmailSendResult> {
    const resolved = this.resolveConfig(config);

    if (!resolved.host || !resolved.fromAddress) {
      // Permanent by classification: an organization with no SMTP host will
      // still have none in sixteen minutes, so retrying only burns the attempt
      // budget to reach the same answer.
      throw new EmailSendError(
        'No SMTP host or from-address is configured for this organization.',
        FAILURE_CODES.CHANNEL_NOT_CONFIGURED,
      );
    }

    const transport = this.transportFor(resolved);

    try {
      const info = await transport.sendMail({
        from: resolved.fromName
          ? `"${resolved.fromName}" <${resolved.fromAddress}>`
          : resolved.fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.body,
      });

      // `messageId` and `response` are recorded verbatim on the attempt (Rule
      // 18). Note what is NOT returned: any claim of delivery. A 250 means the
      // next hop accepted the message, which Rule 17 and Scenario 27 are
      // explicit is not the same as delivering it.
      return {
        providerMessageId: info.messageId ?? null,
        providerStatus: info.response ?? 'accepted',
      };
    } catch (error) {
      const smtp = error as SmtpError;
      throw new EmailSendError(
        smtp.message,
        this.classify(smtp),
        smtp.response ?? smtp.code ?? null,
      );
    }
  }

  /**
   * Map a nodemailer failure onto a canonical failure code.
   *
   * The SMTP reply code is the authority where there is one: 5xx is a permanent
   * rejection by the receiving server, 4xx is an explicit "try again later" —
   * greylisting, a full mailbox, a rate limit.
   *
   * `EENVELOPE` and `EAUTH` are classified permanent without a reply code
   * because both are configuration faults: a malformed recipient address and
   * bad credentials do not become valid with time.
   */
  private classify(error: SmtpError): FailureCode {
    const status = error.responseCode;

    if (typeof status === 'number') {
      if (status >= 500) return FAILURE_CODES.PERMANENT_PROVIDER_ERROR;
      if (status >= 400) return FAILURE_CODES.TRANSIENT_PROVIDER_ERROR;
    }

    switch (error.code) {
      case 'EENVELOPE':
        return FAILURE_CODES.INVALID_RECIPIENT;
      case 'EAUTH':
        return FAILURE_CODES.CHANNEL_NOT_CONFIGURED;
      case 'ETIMEDOUT':
      case 'ESOCKET':
        return FAILURE_CODES.PROVIDER_TIMEOUT;
      case 'ECONNECTION':
      case 'ECONNREFUSED':
        return FAILURE_CODES.PROVIDER_UNAVAILABLE;
      default:
        // Unmapped, and therefore retryable — the safer of the two defaults.
        // See `classifyFailure` in notification-policy.ts.
        return FAILURE_CODES.PROVIDER_ERROR;
    }
  }

  /**
   * Merge the per-organization row over the deployment-wide defaults.
   *
   * The password is never part of this merge: it comes from the environment
   * alone, which is what lets `EmailDeliveryConfig` be logged safely.
   */
  private resolveConfig(config: EmailDeliveryConfig): EmailDeliveryConfig {
    const env = this.config.get<{
      host: string | null;
      port: number;
      secure: boolean;
      username: string | null;
      fromAddress: string | null;
      fromName: string | null;
    }>('notifications.smtp');

    return {
      host: config.host ?? env?.host ?? null,
      port: config.port ?? env?.port ?? 587,
      secure: config.secure ?? env?.secure ?? false,
      username: config.username ?? env?.username ?? null,
      fromAddress: config.fromAddress ?? env?.fromAddress ?? null,
      fromName: config.fromName ?? env?.fromName ?? null,
    };
  }

  private transportFor(config: EmailDeliveryConfig): Transporter {
    const password = this.config.get<string>('notifications.smtp.password');
    const fingerprint = [
      config.host,
      config.port,
      config.secure,
      config.username,
    ].join('|');

    const existing = this.transports.get(fingerprint);
    if (existing) return existing;

    const transport = createTransport({
      host: config.host ?? undefined,
      port: config.port ?? 587,
      secure: config.secure ?? false,
      auth:
        config.username && password
          ? { user: config.username, pass: password }
          : undefined,
      pool: true,
    });

    this.transports.set(fingerprint, transport);
    this.logger.log(`Opened SMTP transport for ${config.host}:${config.port}.`);
    return transport;
  }
}
