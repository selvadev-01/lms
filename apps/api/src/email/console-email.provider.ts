import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  EmailProvider,
  type EmailMessage,
  type EmailSendResult,
} from './email.provider';

/**
 * Path of the development message sink, relative to the api package root.
 *
 * Exported so the e2e suite reads the same constant rather than hard-coding a
 * path that could drift. The file is gitignored.
 */
export const DEV_EMAIL_LOG = resolve(process.cwd(), '.dev-email.log');

/**
 * Development email provider that writes the message to the application log and
 * to a local file.
 *
 * This exists so the whole notification pipeline — event, rule, render,
 * dispatch, delivery record — is testable end to end before SMTP credentials
 * are procured (Q-NOTIF-26 is still open). It is the reason an organization with
 * no `email_provider_configs` row still exercises a real EMAIL delivery path
 * rather than skipping the channel.
 *
 * It refuses to run in production for the same reason `ConsoleSmsProvider` does,
 * though the justification is weaker and worth stating honestly: notification
 * bodies are less sensitive than recovery OTPs, but they still carry loan
 * numbers, amounts and customer names on the in-app channel, and Rule 55
 * requires notification content be controlled rather than written to a file
 * anyone with shell access can read. A misconfigured deployment must fail at
 * boot, loudly, rather than quietly accumulating that file.
 */
@Injectable()
export class ConsoleEmailProvider
  extends EmailProvider
  implements OnModuleInit
{
  private readonly logger = new Logger(ConsoleEmailProvider.name);

  /**
   * The file-append behind the message sink.
   *
   * A protected method rather than a constructor parameter: Nest resolves
   * constructor params through DI, and a function-typed one has no injectable
   * token, so the container could not instantiate the provider at all. Tests
   * override this by subclassing.
   */
  protected appendToSink(path: string, data: string): Promise<void> {
    return appendFile(path, data, 'utf8');
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ConsoleEmailProvider must not run in production: it writes ' +
          'notification content to a local file. Set EMAIL_PROVIDER=smtp.',
      );
    }
    this.logger.warn(
      'Using ConsoleEmailProvider — email is logged, not delivered.',
    );
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.logger.log(`[EMAIL -> ${message.to}] ${message.subject}`);

    // Best-effort: a development convenience must never be able to fail a
    // delivery, which would turn a read-only filesystem into a wave of
    // permanent failures on a channel that is otherwise working.
    try {
      await this.appendToSink(
        DEV_EMAIL_LOG,
        `${new Date().toISOString()}\t${message.to}\t${message.subject}\t${message.body.replace(/\n/g, '\\n')}\n`,
      );
    } catch (error) {
      this.logger.warn(
        `Could not write ${DEV_EMAIL_LOG}: ${(error as Error).message}`,
      );
    }

    // ACCEPTED_BY_PROVIDER, not DELIVERED — the console provider is a stand-in
    // for a gateway, and reporting a delivery it cannot observe would teach the
    // pipeline a habit Rule 17 forbids in production.
    return { providerStatus: 'logged' };
  }
}
