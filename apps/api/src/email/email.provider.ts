import {
  FAILURE_CODES,
  type FailureCode,
} from '../notifications/notification-policy';

/**
 * How a specific organization addresses its email gateway.
 *
 * Resolved per send from `email_provider_configs`, falling back to environment
 * values when the organization has no row. Carries no password: the SMTP
 * credential is environment-only, so this object can be logged or passed around
 * without leaking anything that can send mail.
 */
export interface EmailDeliveryConfig {
  host?: string | null;
  port?: number | null;
  /** Implicit TLS (port 465). False means STARTTLS on a plain connection. */
  secure?: boolean | null;
  username?: string | null;
  fromAddress?: string | null;
  fromName?: string | null;
}

/** One message to send. */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

/**
 * What a provider returns on success.
 *
 * `providerMessageId` and `providerStatus` are recorded verbatim on the
 * delivery attempt (Rule 18), so a support engineer can quote the gateway's own
 * reference when asking it what happened.
 *
 * There is deliberately no "delivered" flag. A provider accepting a message is
 * not delivery (Rule 17, Scenario 27), and a boolean here would invite a caller
 * to treat it as one.
 */
export interface EmailSendResult {
  providerMessageId?: string | null;
  providerStatus?: string | null;
}

/**
 * A failed send, carrying the classification the retry decision needs.
 *
 * A typed error rather than a rejected promise with a bare message, because the
 * caller must distinguish retryable from permanent (Rules 19, 20) and parsing
 * that back out of an error string would be guesswork.
 */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly failureCode: FailureCode = FAILURE_CODES.PROVIDER_ERROR,
    readonly providerStatus: string | null = null,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/**
 * Outbound email delivery.
 *
 * An abstract class rather than an interface so it can be a Nest injection
 * token directly, exactly as `SmsProvider` is: `constructor(private readonly
 * email: EmailProvider)` resolves without a separate `@Inject('EMAIL_PROVIDER')`
 * string token, which would be easy to typo and impossible to type-check.
 *
 * The concrete provider is chosen per organization at runtime by
 * `EmailService`. Everything above that boundary — the notification dispatch
 * service in particular — must not know which one is in use.
 */
export abstract class EmailProvider {
  /**
   * @param message The rendered message. Content policy has already been
   *                applied by the template renderer (Rules 55, 56); a provider
   *                does not inspect what it is sending.
   * @param config  Resolved per-organization addressing. Optional so a provider
   *                that needs no configuration can ignore it entirely.
   *
   * Implementations must reject with an `EmailSendError` rather than resolve on
   * failure: the dispatch service records the attempt, classifies the failure
   * and schedules or refuses a retry. A silently swallowed error would be
   * recorded as a successful send of a message nobody received, which is
   * precisely the false claim Rule 17 forbids.
   */
  abstract send(
    message: EmailMessage,
    config?: EmailDeliveryConfig,
  ): Promise<EmailSendResult>;
}
