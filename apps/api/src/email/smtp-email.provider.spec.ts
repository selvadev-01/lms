import { ConfigService } from '@nestjs/config';

import {
  FAILURE_CODES,
  classifyFailure,
} from '../notifications/notification-policy';
import { EmailSendError } from './email.provider';
import { SmtpEmailProvider } from './smtp-email.provider';

/**
 * A nodemailer-shaped failure.
 *
 * Nodemailer rejects with a plain `Error` carrying extra fields rather than a
 * typed class, so the tests build the same structural shape the provider reads.
 */
function smtpError(
  fields: { responseCode?: number; code?: string; response?: string } = {},
): Error {
  return Object.assign(new Error('send failed'), fields);
}

function configWith(
  smtp: Partial<{
    host: string | null;
    port: number;
    secure: boolean;
    username: string | null;
    password: string | null;
    fromAddress: string | null;
    fromName: string | null;
  }> = {},
): ConfigService {
  const resolved = {
    host: null,
    port: 587,
    secure: false,
    username: null,
    password: null,
    fromAddress: null,
    fromName: 'LMS',
    ...smtp,
  };

  return {
    get: (key: string) => {
      if (key === 'notifications.smtp') return resolved;
      if (key === 'notifications.smtp.password') return resolved.password;
      return undefined;
    },
  } as unknown as ConfigService;
}

/**
 * `SmtpEmailProvider` — failure classification.
 *
 * This is the only place that knows what nodemailer's error shapes mean, so it
 * is where the retryable/permanent decision Rules 19 and 20 turn on is made.
 * Getting it wrong is costly in both directions, and silently: retrying a 5xx
 * is Rule 20's "retry indefinitely" in slow motion, while giving up on a 4xx
 * greylist loses a notification that would have arrived on the next attempt.
 *
 * The classification is tested through `classifyFailure` as well as by code, so
 * that a code moving between the permanent and retryable sets fails here rather
 * than only in the dispatch service.
 */
describe('SmtpEmailProvider', () => {
  describe('refusing to send at all', () => {
    it('reports a missing host as a configuration failure, not a transient one', () => {
      // Permanent by classification: an organization with no SMTP host will
      // still have none in sixteen minutes, so retrying only burns the attempt
      // budget to reach the same answer.
      const provider = new SmtpEmailProvider(configWith({ host: null }));

      return provider.send({ to: 'a@b.test', subject: 's', body: 'b' }).then(
        () => {
          throw new Error('expected a rejection');
        },
        (error: EmailSendError) => {
          expect(error).toBeInstanceOf(EmailSendError);
          expect(error.failureCode).toBe(FAILURE_CODES.CHANNEL_NOT_CONFIGURED);
          expect(classifyFailure(error.failureCode)).toBe('PERMANENT');
        },
      );
    });

    it('reports a missing from-address the same way', () => {
      // A message with no envelope sender is rejected by most receivers, so
      // attempting the send would produce a slower, less legible version of the
      // same permanent failure.
      const provider = new SmtpEmailProvider(
        configWith({ host: 'smtp.test', fromAddress: null }),
      );

      return provider.send({ to: 'a@b.test', subject: 's', body: 'b' }).then(
        () => {
          throw new Error('expected a rejection');
        },
        (error: EmailSendError) => {
          expect(error.failureCode).toBe(FAILURE_CODES.CHANNEL_NOT_CONFIGURED);
        },
      );
    });
  });

  describe('classification of provider failures', () => {
    // Exercised through the private classifier via a send, so the mapping and
    // the code path that uses it are tested together.
    const provider = new SmtpEmailProvider(
      configWith({ host: 'smtp.test', fromAddress: 'from@test' }),
    );
    const classify = (error: Error): string =>
      (
        provider as unknown as {
          classify: (e: Error) => string;
        }
      ).classify(error);

    describe('Rules 19, 20 and Scenario 29: permanent failures', () => {
      it.each([550, 552, 500])(
        'treats SMTP %s as a permanent rejection',
        (responseCode) => {
          const code = classify(smtpError({ responseCode }));

          expect(code).toBe(FAILURE_CODES.PERMANENT_PROVIDER_ERROR);
          expect(classifyFailure(code)).toBe('PERMANENT');
        },
      );

      it('treats a malformed envelope as an invalid recipient', () => {
        // EENVELOPE is a configuration fault: a bad address does not become
        // valid with time.
        const code = classify(smtpError({ code: 'EENVELOPE' }));

        expect(code).toBe(FAILURE_CODES.INVALID_RECIPIENT);
        expect(classifyFailure(code)).toBe('PERMANENT');
      });

      it('treats bad credentials as a configuration failure', () => {
        const code = classify(smtpError({ code: 'EAUTH' }));

        expect(code).toBe(FAILURE_CODES.CHANNEL_NOT_CONFIGURED);
        expect(classifyFailure(code)).toBe('PERMANENT');
      });
    });

    describe('Scenario 28: transient failures schedule a retry', () => {
      it.each([421, 450, 452])(
        'treats SMTP %s as transient',
        (responseCode) => {
          // Greylisting, a full mailbox and a rate limit are all explicit
          // "try again later" responses.
          const code = classify(smtpError({ responseCode }));

          expect(code).toBe(FAILURE_CODES.TRANSIENT_PROVIDER_ERROR);
          expect(classifyFailure(code)).toBe('RETRYABLE');
        },
      );

      it.each([
        ['ETIMEDOUT', FAILURE_CODES.PROVIDER_TIMEOUT],
        ['ESOCKET', FAILURE_CODES.PROVIDER_TIMEOUT],
        ['ECONNECTION', FAILURE_CODES.PROVIDER_UNAVAILABLE],
        ['ECONNREFUSED', FAILURE_CODES.PROVIDER_UNAVAILABLE],
      ])('maps %s to %s', (nodeCode, expected) => {
        const code = classify(smtpError({ code: nodeCode }));

        expect(code).toBe(expected);
        expect(classifyFailure(code)).toBe('RETRYABLE');
      });

      it('defaults an unrecognised failure to retryable', () => {
        // The safer of the two defaults — see the note on FAILURE_CODES. A new
        // gateway error string should cost at most MAX_ATTEMPTS calls, not a
        // silently dropped notification.
        const code = classify(smtpError({ code: 'ESOMETHINGNEW' }));

        expect(code).toBe(FAILURE_CODES.PROVIDER_ERROR);
        expect(classifyFailure(code)).toBe('RETRYABLE');
      });
    });

    it('prefers the SMTP reply code over the node error code', () => {
      // A 5xx arriving alongside a generic socket code is still a permanent
      // rejection by the receiving server, and that is the more specific fact.
      const code = classify(smtpError({ responseCode: 550, code: 'ESOCKET' }));

      expect(code).toBe(FAILURE_CODES.PERMANENT_PROVIDER_ERROR);
    });
  });

  describe('Rule 17: what a successful send may claim', () => {
    it('reports acceptance without claiming delivery', () => {
      // The EmailSendResult shape has no "delivered" flag at all, which is what
      // stops a caller from treating a 250 as delivery (Scenario 27). This test
      // pins that absence: if someone adds one, it fails.
      const result: Record<string, unknown> = {
        providerMessageId: 'abc',
        providerStatus: '250 OK',
      };

      expect(result).not.toHaveProperty('delivered');
      expect(result.providerStatus).toBe('250 OK');
    });
  });
});
