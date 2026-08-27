/**
 * How a specific organization addresses its SMS gateway.
 *
 * Resolved per send from `sms_provider_configs`, falling back to environment
 * values when the organization has no row. Carries no credentials: the auth
 * token is environment-only, so this object can be logged or passed around
 * without leaking anything that can send SMS.
 */
export interface SmsDeliveryConfig {
  /** Preferred over `fromNumber` when both are present. */
  messagingServiceSid?: string | null;
  fromNumber?: string | null;
  /** E.164 prefix for the 10-digit numbers stored on users, e.g. "+91". */
  defaultCountryCode?: string | null;
}

/**
 * Outbound SMS delivery.
 *
 * An abstract class rather than an interface so it can be a Nest injection
 * token directly: `constructor(private readonly sms: SmsProvider)` resolves
 * without a separate `@Inject('SMS_PROVIDER')` string token, which would be
 * easy to typo and impossible to type-check.
 *
 * The LMS source defines no SMS gateway (Q-REC-1 / Q-NOTIF-*), so the concrete
 * provider is chosen per organization at runtime by `SmsService`. Everything
 * above that boundary — the recovery flow in particular — must not know which
 * one is in use.
 */
export abstract class SmsProvider {
  /**
   * @param to      Normalized 10-digit mobile number, no country code.
   * @param body    Fully rendered message text.
   * @param config  Resolved per-organization addressing. Optional so a provider
   *                that needs no configuration can ignore it entirely.
   *
   * Implementations must reject rather than resolve on delivery failure: the
   * caller audits the failure and keeps the recovery request replayable
   * (Forgot Password Scenario 33). A silently swallowed error would leave the
   * user waiting for a code that was never sent.
   */
  abstract send(
    to: string,
    body: string,
    config?: SmsDeliveryConfig,
  ): Promise<void>;
}
