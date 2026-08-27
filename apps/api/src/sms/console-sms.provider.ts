import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { SmsProvider } from './sms.provider';

/**
 * Path of the development message sink, relative to the api package root.
 *
 * Exported so the e2e suite reads the same constant rather than hard-coding a
 * path that could drift. The file is gitignored.
 */
export const DEV_SMS_LOG = resolve(process.cwd(), '.dev-sms.log');

/**
 * Development SMS provider that writes the message to the application log and
 * to a local file.
 *
 * This exists so the whole recovery flow — request, verify, reset — is
 * buildable and end-to-end testable before an SMS gateway is procured
 * (Q-REC-1 is still open). The Playwright suite reads the OTP from the file,
 * because the OTP is argon2-hashed at rest and therefore cannot be recovered
 * from the database.
 *
 * It is the ONLY place in the system where a recovery OTP appears in
 * plaintext, which is precisely why it refuses to run in production: the
 * Forgot Password story requires that recovery secrets never reach application
 * logs (Scenario 25). A misconfigured deployment must fail at boot, loudly,
 * rather than quietly logging every user's OTP.
 */
@Injectable()
export class ConsoleSmsProvider extends SmsProvider implements OnModuleInit {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  /**
   * The file-append behind the message sink.
   *
   * A protected method rather than a constructor parameter: Nest resolves
   * constructor params through DI, and a function-typed one has no injectable
   * token, so the container cannot instantiate the provider at all. Tests
   * override this by subclassing.
   */
  protected appendToSink(path: string, data: string): Promise<void> {
    return appendFile(path, data, 'utf8');
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ConsoleSmsProvider must not run in production: it writes recovery ' +
          'codes to the application log. Set SMS_PROVIDER to a real gateway.',
      );
    }
    this.logger.warn(
      'Using ConsoleSmsProvider — SMS messages are logged, not delivered.',
    );
  }

  async send(to: string, body: string): Promise<void> {
    this.logger.log(`[SMS -> ${to}] ${body}`);

    // Best-effort: a test convenience must never be able to fail a recovery
    // request, which would turn a read-only filesystem into an outage.
    try {
      await this.appendToSink(
        DEV_SMS_LOG,
        `${new Date().toISOString()}\t${to}\t${body}\n`,
      );
    } catch (error) {
      this.logger.warn(
        `Could not write ${DEV_SMS_LOG}: ${(error as Error).message}`,
      );
    }
  }
}
