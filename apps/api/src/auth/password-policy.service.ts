import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildPasswordPolicySchema,
  PASSWORD_HISTORY_DEPTH,
} from '@lms/validation';

import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';

/** Minimal surface of the Prisma client that history writes need. */
type HistoryClient = Pick<PrismaService, 'passwordHistory'>;

/** Rejection reason recorded on the audit trail; never the password itself. */
export type PolicyFailureReason = 'POLICY' | 'HISTORY';

/**
 * Thrown when a candidate password is refused. Carries the reason so the caller
 * can audit it, and the messages so the user is told what to fix.
 *
 * A `BadRequestException` rather than an `UnauthorizedException`: the recovery
 * authorization is perfectly valid here — the password is not. That distinction
 * is what lets the client keep the reset token and retry (Scenarios 10-13).
 */
export class PasswordPolicyException extends BadRequestException {
  constructor(
    readonly reason: PolicyFailureReason,
    messages: string[],
  ) {
    super({
      statusCode: 400,
      message: messages,
      error: 'Bad Request',
    });
  }
}

/**
 * Enforcement of the password policy and the password-history rule.
 *
 * Kept apart from `PasswordService`, which owns hashing and nothing else. The
 * rules themselves live in `@lms/validation` so the browser applies the exact
 * same ones; this service adds what only the server can do — the identifier
 * check, which needs the account, and the history check, which needs the
 * database.
 *
 * Every method throws rather than returning a boolean. A caller that forgets to
 * inspect a returned flag would silently accept a non-compliant password, and
 * that failure mode is not acceptable on a credential path.
 */
@Injectable()
export class PasswordPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService,
  ) {}

  private get historyDepth(): number {
    return (
      this.config.get<number>('auth.passwordHistoryDepth') ??
      PASSWORD_HISTORY_DEPTH
    );
  }

  /**
   * Validates a candidate password against the configured policy.
   *
   * `identifiers` are the account values a password may not embed — typically
   * the user's name, mobile number and organization code (Q-PWD-8). They are
   * passed in rather than looked up so this method stays usable inside a
   * transaction that already holds the user row.
   *
   * Server-side validation is mandatory even though the browser runs the same
   * schema: the client is not a trustworthy validator, and the API is reachable
   * directly (story rule 10, Scenario "Validation must occur server-side").
   */
  assertMeetsPolicy(password: string, identifiers: readonly string[]): void {
    const result = buildPasswordPolicySchema({ identifiers }).safeParse(
      password,
    );

    if (!result.success) {
      // Deduplicated: several rules can fail at once, and Zod may surface the
      // same message twice when a refinement runs per-issue.
      const messages = [
        ...new Set(result.error.issues.map((issue): string => issue.message)),
      ];
      throw new PasswordPolicyException('POLICY', messages);
    }
  }

  /**
   * Rejects a password the user has recently used (Scenario 12, Q-PWD-4).
   *
   * Checks the current password as well as the stored history, so the most
   * obvious reuse — setting the same password again — is caught even when the
   * history table is empty, as it will be for every account predating this
   * feature.
   *
   * Cost: one argon2 verification per stored hash. At the default depth of 5
   * that is six verifications, which is why the depth is configurable and why
   * this runs only on password change, never on sign-in.
   */
  async assertNotReused(
    orgId: string,
    userId: string,
    password: string,
    currentHash: string | null,
  ): Promise<void> {
    const depth = this.historyDepth;

    if (depth <= 0 && !currentHash) return;

    const history =
      depth > 0
        ? await this.prisma.passwordHistory.findMany({
            where: { orgId, userId },
            orderBy: { createdAt: 'desc' },
            take: depth,
            select: { passwordHash: true },
          })
        : [];

    const hashes = [
      ...(currentHash ? [currentHash] : []),
      ...history.map((row) => row.passwordHash),
    ];

    for (const hash of hashes) {
      if (await this.passwords.verify(hash, password)) {
        throw new PasswordPolicyException('HISTORY', [
          'You cannot reuse a recent password. Choose one you have not used before',
        ]);
      }
    }
  }

  /**
   * Records the newly established hash and discards anything past the retention
   * depth.
   *
   * Takes the transaction client because history must commit atomically with
   * the password itself: a history row written for a password change that then
   * rolled back would lock the user out of a password they are still using.
   *
   * `deleteMany` by id rather than a raw offset delete, so the trim works
   * identically against the in-memory Prisma fake the unit tests use.
   */
  async recordAndTrim(
    orgId: string,
    userId: string,
    passwordHash: string,
    tx: HistoryClient,
  ): Promise<void> {
    const depth = this.historyDepth;
    if (depth <= 0) return;

    await tx.passwordHistory.create({
      data: { orgId, userId, passwordHash },
    });

    const retained = await tx.passwordHistory.findMany({
      where: { orgId, userId },
      orderBy: { createdAt: 'desc' },
      select: { historyId: true },
    });

    const stale = retained.slice(depth).map((row) => row.historyId);
    if (stale.length > 0) {
      await tx.passwordHistory.deleteMany({
        where: { orgId, historyId: { in: stale } },
      });
    }
  }
}
