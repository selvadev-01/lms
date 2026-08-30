import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomInt } from 'node:crypto';

import { AuditAction, AuditService, maskMobile } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import {
  PasswordPolicyException,
  PasswordPolicyService,
} from './password-policy.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import type { RequestMeta } from './auth.service';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { VerifyOtpDto } from './dto/verify-otp.dto';

/**
 * Outcome of the recovery-request transaction.
 *
 * As in `AuthService.signIn`, the transaction returns a value rather than
 * throwing: throwing would roll back the very rows that make rate limiting and
 * attempt counting work. Nothing here is surfaced to the caller — every branch
 * produces the same HTTP response — but the delivery step needs to know whether
 * an OTP was actually minted.
 */
type RequestOutcome =
  { status: 'SEND'; mobile: string; otp: string } | { status: 'NO_SEND' };

/** Reason recorded on sessions revoked because the password changed. */
const REVOKE_REASON_PASSWORD_RESET = 'PASSWORD_RESET';

/**
 * Password recovery: request an OTP, verify it, set a new password.
 *
 * The governing constraint throughout is non-disclosure. Whether the mobile
 * number belongs to an LMS account, whether that account is active, locked or
 * suspended — none of it may be inferable from the response body, the status
 * code, or the time taken (Scenarios 8, 9, 10, 22, 26). Every branch of
 * `requestRecovery` therefore returns normally, and the ineligible ones still
 * spend a password-verification's worth of CPU before doing so.
 *
 * The mechanism itself is an applied default, not a source requirement: the LMS
 * diagrams contain no Forgot Password flow (Q-REC-1). See docs/OPEN-QUESTIONS.md.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly policy: PasswordPolicyService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  private num(key: string, fallback: number): number {
    return this.config.get<number>(`auth.${key}`) ?? fallback;
  }

  /**
   * Generates a zero-padded numeric OTP.
   *
   * `randomInt` from node:crypto, never `Math.random`: a predictable OTP is
   * equivalent to no OTP at all, and `Math.random` is seeded per-process.
   */
  private generateOtp(): string {
    const length = this.num('recoveryOtpLength', 6);
    return String(randomInt(0, 10 ** length)).padStart(length, '0');
  }

  // ---------------------------------------------------------------------------
  // Step 1 — request
  // ---------------------------------------------------------------------------

  /**
   * Raises a recovery request. Returns void in every case, including unknown
   * accounts, so the caller cannot branch on the result and accidentally leak
   * existence (Scenario 22).
   */
  async requestRecovery(
    dto: ForgotPasswordDto,
    meta: RequestMeta,
  ): Promise<void> {
    const organization = await this.prisma.organization.findUnique({
      where: { code: dto.orgCode },
      select: { orgId: true, status: true },
    });

    // Unknown or inactive tenant. No orgId exists, so no audit row is possible
    // (orgId is part of the audit primary key); this is logged instead.
    if (!organization || organization.status !== 'ACTIVE') {
      this.audit.recordUnresolvableTenant({
        orgCode: dto.orgCode,
        maskedMobile: maskMobile(dto.mobile),
        requestId: meta.requestId,
        ipAddress: meta.ipAddress ?? undefined,
        userAgent: meta.userAgent ?? undefined,
      });
      await this.passwords.burn(dto.mobile);
      return;
    }

    const orgId = organization.orgId;
    const outcome = await this.prisma.$transaction(
      async (tx): Promise<RequestOutcome> => {
        // Row-lock the candidate user so two concurrent requests cannot both
        // pass the cooldown check and mint competing OTPs (Scenario 35).
        const locked = await tx.$queryRaw<
          Array<{ user_id: string }>
        >`SELECT user_id FROM users WHERE org_id = ${orgId}::uuid AND mobile = ${dto.mobile} FOR UPDATE`;

        const auditBase = {
          orgId,
          entityType: 'USER',
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        };

        // No such account. No user row is created (Scenario 8, rule 25) and no
        // existing record is touched.
        if (locked.length === 0) {
          await this.passwords.burn(dto.mobile);
          await this.audit.record(
            {
              ...auditBase,
              action: AuditAction.RECOVERY_REQUEST_IGNORED,
              // Composite FK forbids referencing a user that does not exist.
              actorUserId: null,
              metadata: { attemptedMobileMasked: maskMobile(dto.mobile) },
            },
            tx,
          );
          return { status: 'NO_SEND' };
        }

        const userId = locked[0].user_id;
        const user = await tx.user.findUniqueOrThrow({
          where: { orgId_userId: { orgId, userId } },
          select: { userId: true, status: true, mobile: true },
        });

        const withActor = {
          ...auditBase,
          entityId: user.userId,
          actorUserId: user.userId,
        };

        /**
         * Eligibility. A LOCKED account may recover — a forgotten password is a
         * plausible cause of the lockout, and the reset leaves the lock itself
         * untouched (Scenario 12). INACTIVE and SUSPENDED may not, and are
         * silently ignored rather than told so: recovery must not be a way to
         * discover that a deactivated account exists (Scenarios 11, 14).
         */
        if (user.status !== 'ACTIVE' && user.status !== 'LOCKED') {
          await this.passwords.burn(dto.mobile);
          await this.audit.record(
            {
              ...withActor,
              action: AuditAction.RECOVERY_REQUEST_IGNORED,
              metadata: { reason: 'ACCOUNT_INELIGIBLE' },
            },
            tx,
          );
          return { status: 'NO_SEND' };
        }

        const now = new Date();

        /**
         * Per-account throttling. The endpoint's @Throttle caps requests per IP,
         * which does nothing against a distributed attempt to flood one user
         * with SMS. These counters are the account-level control (Scenarios 21,
         * 23; Q-REC-17).
         */
        const active = await tx.passwordRecoveryRequest.findFirst({
          where: { orgId, userId: user.userId, status: 'REQUESTED' },
          orderBy: { createdAt: 'desc' },
        });

        if (active && active.expiresAt > now) {
          const cooldownMs =
            this.num('recoveryResendCooldownSeconds', 60) * 1000;
          const withinCooldown =
            now.getTime() - active.lastSentAt.getTime() < cooldownMs;
          const resendsExhausted =
            active.resendCount >= this.num('recoveryMaxResends', 3);

          if (withinCooldown || resendsExhausted) {
            await this.audit.record(
              {
                ...withActor,
                action: AuditAction.RECOVERY_RATE_LIMITED,
                metadata: {
                  reason: withinCooldown ? 'COOLDOWN' : 'MAX_RESENDS',
                  recoveryRef: active.requestId,
                  resendCount: active.resendCount,
                },
              },
              tx,
            );
            return { status: 'NO_SEND' };
          }
        }

        const otp = this.generateOtp();
        const otpHash = await this.passwords.hash(otp);
        const expiresAt = new Date(
          now.getTime() + this.num('recoveryOtpTtlMinutes', 10) * 60_000,
        );

        /**
         * Issuing a new authorization invalidates every earlier one (Q-REC-8),
         * so at most one recovery request per user is ever live. Without this a
         * user who requested three codes would have three usable OTPs, tripling
         * the guessing surface.
         */
        await tx.passwordRecoveryRequest.updateMany({
          where: {
            orgId,
            userId: user.userId,
            status: { in: ['REQUESTED', 'VERIFIED'] },
          },
          // Hash cleared here, unlike on consumption: a superseded request is
          // abandoned rather than replayed, and `resetTokenHash` is globally
          // unique, so leaving stale values behind would eventually collide.
          data: { status: 'CANCELLED', resetTokenHash: null },
        });

        const created = await tx.passwordRecoveryRequest.create({
          data: {
            orgId,
            userId: user.userId,
            otpHash,
            expiresAt,
            lastSentAt: now,
            // Carried forward so the cap counts codes sent to this user, not
            // codes sent under one row id.
            resendCount: active ? active.resendCount + 1 : 0,
            ipAddress: meta.ipAddress ?? null,
            userAgent: meta.userAgent ?? null,
          },
          select: { requestId: true },
        });

        await this.audit.record(
          {
            ...withActor,
            action: AuditAction.RECOVERY_REQUESTED,
            // `recoveryRef`, not `tokenId`: sanitizeMetadata drops any key
            // matching /token|hash|secret/, which would erase the only handle
            // an investigator has on this request.
            metadata: {
              recoveryRef: created.requestId,
              mobileMasked: maskMobile(dto.mobile),
            },
          },
          tx,
        );

        return { status: 'SEND', mobile: user.mobile ?? dto.mobile, otp };
      },
    );

    if (outcome.status !== 'SEND') return;

    /**
     * Delivery runs after the commit, never inside the transaction: an SMS
     * gateway call is slow and cannot be rolled back, and holding a row lock
     * across it would serialise every recovery request in the org.
     *
     * A delivery failure does not change the response (that would leak account
     * existence) and does not fail the request. The row stays REQUESTED, so the
     * user can resend and the password remains unchanged (Scenario 33).
     */
    const minutes = this.num('recoveryOtpTtlMinutes', 10);
    try {
      await this.sms.send(
        orgId,
        outcome.mobile,
        `Your LMS password recovery code is ${outcome.otp}. ` +
          `It expires in ${minutes} minutes. Do not share it with anyone.`,
      );
    } catch (error) {
      this.logger.error(
        `Recovery SMS delivery failed: ${(error as Error).message}`,
      );
      await this.audit.record({
        orgId,
        action: AuditAction.RECOVERY_SMS_FAILED,
        entityType: 'USER',
        actorUserId: null,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { mobileMasked: maskMobile(outcome.mobile) },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Step 2 — verify
  // ---------------------------------------------------------------------------

  /**
   * Verifies the OTP and mints the single-use reset authorization.
   *
   * Unlike step 1 this does throw on failure, and deliberately so: the user is
   * now holding a code they believe is valid, and telling them it is not is not
   * a disclosure — it reveals nothing about whether the account exists, because
   * an unknown account produces exactly the same error.
   */
  async verifyOtp(
    dto: VerifyOtpDto,
    meta: RequestMeta,
  ): Promise<{ resetToken: string }> {
    const invalid = (): never => {
      throw new UnauthorizedException('Invalid or expired verification code');
    };

    const organization = await this.prisma.organization.findUnique({
      where: { code: dto.orgCode },
      select: { orgId: true, status: true },
    });

    if (!organization || organization.status !== 'ACTIVE') {
      await this.passwords.burn(dto.otp);
      return invalid();
    }

    const orgId = organization.orgId;
    const result = await this.prisma.$transaction(
      async (tx): Promise<{ resetToken: string } | null> => {
        const locked = await tx.$queryRaw<
          Array<{ user_id: string }>
        >`SELECT user_id FROM users WHERE org_id = ${orgId}::uuid AND mobile = ${dto.mobile} FOR UPDATE`;

        if (locked.length === 0) {
          await this.passwords.burn(dto.otp);
          return null;
        }

        const userId = locked[0].user_id;
        const auditBase = {
          orgId,
          entityType: 'USER',
          entityId: userId,
          actorUserId: userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        };

        const request = await tx.passwordRecoveryRequest.findFirst({
          where: { orgId, userId, status: 'REQUESTED' },
          orderBy: { createdAt: 'desc' },
        });

        if (!request) {
          await this.passwords.burn(dto.otp);
          return null;
        }

        const now = new Date();

        // Scenario 17: an expired authorization cannot be continued.
        if (request.expiresAt <= now) {
          await tx.passwordRecoveryRequest.update({
            where: { orgId_requestId: { orgId, requestId: request.requestId } },
            data: { status: 'EXPIRED' },
          });
          await this.passwords.burn(dto.otp);
          await this.audit.record(
            {
              ...auditBase,
              action: AuditAction.RECOVERY_EXPIRED,
              metadata: { recoveryRef: request.requestId },
            },
            tx,
          );
          return null;
        }

        // Scenario 41: the attempt cap burns the request, not just this try —
        // otherwise the OTP could be brute-forced across many requests.
        const maxAttempts = this.num('recoveryMaxOtpAttempts', 5);
        if (request.attemptCount >= maxAttempts) {
          await tx.passwordRecoveryRequest.update({
            where: { orgId_requestId: { orgId, requestId: request.requestId } },
            data: { status: 'FAILED' },
          });
          await this.passwords.burn(dto.otp);
          await this.audit.record(
            {
              ...auditBase,
              action: AuditAction.RECOVERY_OTP_FAILED,
              metadata: {
                reason: 'MAX_ATTEMPTS',
                recoveryRef: request.requestId,
              },
            },
            tx,
          );
          return null;
        }

        const matches = await this.passwords.verify(request.otpHash, dto.otp);

        if (!matches) {
          const attemptCount = request.attemptCount + 1;
          await tx.passwordRecoveryRequest.update({
            where: { orgId_requestId: { orgId, requestId: request.requestId } },
            data: {
              attemptCount,
              // Exhausting the last attempt retires the request immediately,
              // rather than leaving it usable until the next call notices.
              status: attemptCount >= maxAttempts ? 'FAILED' : 'REQUESTED',
            },
          });
          await this.audit.record(
            {
              ...auditBase,
              action: AuditAction.RECOVERY_OTP_FAILED,
              metadata: { recoveryRef: request.requestId, attemptCount },
            },
            tx,
          );
          return null;
        }

        // SHA-256 rather than argon2: the token is 256 bits of randomness, so
        // it needs no work factor — the same reasoning as refresh tokens.
        const resetToken = randomBytes(32).toString('base64url');
        const tokenExpiresAt = new Date(
          now.getTime() + this.num('recoveryTokenTtlMinutes', 15) * 60_000,
        );

        await tx.passwordRecoveryRequest.update({
          where: { orgId_requestId: { orgId, requestId: request.requestId } },
          data: {
            status: 'VERIFIED',
            resetTokenHash: SessionService.hashToken(resetToken),
            tokenExpiresAt,
          },
        });

        await this.audit.record(
          {
            ...auditBase,
            action: AuditAction.RECOVERY_OTP_VERIFIED,
            metadata: { recoveryRef: request.requestId },
          },
          tx,
        );

        return { resetToken };
      },
    );

    return result ?? invalid();
  }

  // ---------------------------------------------------------------------------
  // Step 3 — reset
  // ---------------------------------------------------------------------------

  /**
   * Consumes the reset authorization and establishes the new password.
   *
   * What this method does NOT touch is as important as what it does: account
   * status, lock state, failed-attempt counter, branch, roles and permissions
   * are all left exactly as they were (Scenarios 11-14, 29, 30). Recovery
   * restores access to an account; it never upgrades one.
   */
  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta): Promise<void> {
    const rejected = (): never => {
      throw new UnauthorizedException(
        'This password reset request is no longer valid',
      );
    };

    const tokenHash = SessionService.hashToken(dto.resetToken);

    // Globally unique, so the token resolves without the caller knowing its
    // orgId — which is the whole point: the client holds nothing else.
    const request = await this.prisma.passwordRecoveryRequest.findUnique({
      where: { resetTokenHash: tokenHash },
    });

    if (!request) {
      await this.passwords.burn(dto.password);
      return rejected();
    }

    const { orgId, userId, requestId } = request;
    const auditBase = {
      orgId,
      entityType: 'USER',
      entityId: userId,
      actorUserId: userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    };

    const now = new Date();

    // Scenarios 18 and 34: a consumed or already-finalised authorization is a
    // replay, and is recorded as one.
    if (request.status !== 'VERIFIED' || request.consumedAt) {
      await this.passwords.burn(dto.password);
      await this.audit.record({
        ...auditBase,
        action: AuditAction.RECOVERY_REPLAY_DENIED,
        metadata: { recoveryRef: requestId, state: request.status },
      });
      return rejected();
    }

    // Scenario 17: expiry applies to the reset authorization too, not just the OTP.
    if (!request.tokenExpiresAt || request.tokenExpiresAt <= now) {
      await this.passwords.burn(dto.password);
      await this.prisma.passwordRecoveryRequest.update({
        where: { orgId_requestId: { orgId, requestId } },
        // Hash retained for the same reason as on consumption: `status` is what
        // rejects it, and keeping it lets a repeated attempt be audited.
        data: { status: 'EXPIRED' },
      });
      await this.audit.record({
        ...auditBase,
        action: AuditAction.RECOVERY_EXPIRED,
        metadata: { recoveryRef: requestId },
      });
      return rejected();
    }

    /**
     * Policy enforcement, and the ordering here is load-bearing.
     *
     * Both checks run BEFORE the authorization is consumed below. Scenarios
     * 10-13 all require that a policy rejection leaves the recovery
     * authorization untouched: a user who picks a weak password must be able to
     * correct it and submit again, not be sent back through the whole SMS flow
     * for a typo.
     *
     * The identifiers come from the account rather than the request, because
     * the request deliberately carries no identity (Scenario 19).
     */
    const account = await this.prisma.user.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: {
        name: true,
        mobile: true,
        passwordHash: true,
        organization: { select: { code: true } },
      },
    });

    if (!account) {
      await this.passwords.burn(dto.password);
      return rejected();
    }

    try {
      this.policy.assertMeetsPolicy(dto.password, [
        account.name,
        account.mobile ?? '',
        account.organization.code,
      ]);

      await this.policy.assertNotReused(
        orgId,
        userId,
        dto.password,
        account.passwordHash,
      );
    } catch (error) {
      if (error instanceof PasswordPolicyException) {
        /**
         * Audited without the password and without the specific messages: the
         * reason category is what an investigator needs, and the messages can
         * describe the password closely enough to be worth omitting
         * (Scenarios 21, 33 and rule 9).
         */
        await this.audit.record({
          ...auditBase,
          action: AuditAction.PASSWORD_RESET_FAILED,
          metadata: { recoveryRef: requestId, reason: error.reason },
        });
      }
      throw error;
    }

    const passwordHash = await this.passwords.hash(dto.password);

    await this.prisma.$transaction(async (tx) => {
      /**
       * Consume first, and scope the update to `status: VERIFIED`. Two
       * concurrent resets with the same token both reach this point; only the
       * one whose updateMany reports a changed row may continue, so the
       * password is written exactly once (Scenario 35).
       *
       * `resetTokenHash` is deliberately NOT cleared here. `status` and
       * `consumedAt` are what make the token unusable (Scenario 42); keeping
       * the hash means a replayed token still resolves to its row, so the
       * attempt can be audited against the right account instead of vanishing
       * into an anonymous "no such token" rejection (Scenario 34).
       */
      const consumed = await tx.passwordRecoveryRequest.updateMany({
        where: { orgId, requestId, status: 'VERIFIED', consumedAt: null },
        data: { status: 'COMPLETED', consumedAt: now },
      });

      if (consumed.count === 0) {
        await this.audit.record(
          {
            ...auditBase,
            action: AuditAction.RECOVERY_REPLAY_DENIED,
            metadata: { recoveryRef: requestId, reason: 'CONCURRENT' },
          },
          tx,
        );
        return rejected();
      }

      /**
       * Only the password changes. `status`, `lockedUntil`,
       * `failedLoginAttempts`, `branchId` and every role assignment are
       * deliberately absent from this update — omitting them is the mechanism
       * by which Scenarios 11-14, 29 and 30 hold.
       *
       * `mustChangePassword` is the exception, cleared for the same reason
       * Change Password clears it: the flag says a password someone else chose
       * is still in force, and a self-service reset makes that untrue. Leaving
       * it set would confine an account to a screen it had just finished with.
       */
      await tx.user.update({
        where: { orgId_userId: { orgId, userId } },
        data: {
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
        },
      });

      /**
       * History is written inside the same transaction as the password itself.
       * A history row that survived a rolled-back password change would forbid
       * a password the user is in fact still using.
       */
      await this.policy.recordAndTrim(orgId, userId, passwordHash, tx);

      await this.audit.record(
        {
          ...auditBase,
          action: AuditAction.PASSWORD_RESET_COMPLETED,
          metadata: { recoveryRef: requestId },
        },
        tx,
      );
    });

    /**
     * A credential change invalidates every existing session (Q-REC-18): if the
     * password was reset because it was compromised, leaving the attacker's
     * session alive would defeat the reset entirely.
     *
     * After the commit, because a stale session is a smaller harm than a
     * password change that rolled back for an unrelated reason.
     */
    const revoked = await this.sessions.revokeAllForUser(
      orgId,
      userId,
      REVOKE_REASON_PASSWORD_RESET,
    );

    if (revoked > 0) {
      this.logger.log(
        `Revoked ${revoked} session(s) after password reset for user ${userId}`,
      );
    }
  }
}
