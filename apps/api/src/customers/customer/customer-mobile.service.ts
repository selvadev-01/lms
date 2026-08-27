import { randomInt } from 'node:crypto';

import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AuditAction,
  AuditService,
  maskMobile,
} from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import { PasswordService } from '../../auth/password.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsService } from '../../sms/sms.service';
import { CustomerService } from './customer.service';
import { VerifyMobileOtpDto } from './dto/verify-mobile-otp.dto';

/**
 * LOCAL customer mobile verification (Module 04, Scenarios 2, 14).
 *
 * A LOCAL customer skips KYC entirely, so this OTP round-trip is the *only*
 * identity evidence the system ever collects about them (Q-CUST-27). That is why
 * it is a real verification rather than an operator checkbox: everything else
 * that would corroborate who this person is has been deliberately skipped.
 *
 * Reuses `PasswordService` for hashing and `SmsService` for delivery rather than
 * introducing either. The OTP is stored hashed, never in clear text — the same
 * standard as password recovery, and for the same reason: a leaked database
 * should not hand over live credentials.
 *
 * This is a permissioned staff action, not a customer-facing one. The caller is
 * the branch employee sitting with the customer; the customer reads the code off
 * their own phone and says it aloud. There is no public endpoint here.
 */
@Injectable()
export class CustomerMobileService {
  private readonly logger = new Logger(CustomerMobileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomerService,
    private readonly passwords: PasswordService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Mints and sends a verification code.
   *
   * Any previous unconsumed code for the customer is invalidated first. Without
   * that, a customer who pressed "resend" three times would have three usable
   * codes at once, tripling the guessing surface for no benefit — the same rule
   * password recovery applies.
   */
  async sendOtp(
    actor: AuthContext,
    customerId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const customer = await this.customers.findInScope(actor, customerId, meta);

    if (customer.customerType !== 'LOCAL') {
      // A KYC customer's identity is established by their documents. Offering an
      // OTP here would suggest the two paths are interchangeable, which is the
      // confusion the explicit customer type exists to prevent.
      throw new ConflictException(
        'Mobile verification applies to Local customers',
      );
    }

    if (customer.mobileVerifiedAt !== null) {
      throw new ConflictException('This mobile number is already verified');
    }

    const otp = this.generateOtp();
    const otpHash = await this.passwords.hash(otp);
    const ttlMinutes = this.num('otpTtlMinutes', 15);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

    await this.prisma.$transaction(async (tx) => {
      await tx.customerMobileVerification.updateMany({
        where: { orgId: actor.orgId, customerId, consumedAt: null },
        // Marked consumed rather than deleted: an operator asking why a customer
        // received four texts needs the history to still exist.
        data: { consumedAt: new Date() },
      });

      await tx.customerMobileVerification.create({
        data: {
          orgId: actor.orgId,
          customerId,
          // The number is captured on the row, so a mobile changed mid-flow
          // cannot be verified by a code minted for the previous one.
          mobile: customer.mobile,
          otpHash,
          expiresAt,
          requestedBy: actor.userId,
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_MOBILE_OTP_SENT,
          entityType: 'CUSTOMER',
          entityId: customerId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          // The code itself is never recorded. `sanitizeMetadata` would strip a
          // key matching /token|hash|secret/, but the real safeguard is not
          // putting it here in the first place.
          metadata: {
            mobile: maskMobile(customer.mobile),
            expiresAt: expiresAt.toISOString(),
          },
        },
        tx,
      );
    });

    // Sent after the transaction commits. Sending inside it would mean a
    // rollback still delivers a code that no longer exists server-side, and the
    // customer would be reading out a number that can never verify.
    await this.sms.send(
      actor.orgId,
      customer.mobile,
      `Your verification code is ${otp}. It expires in ${ttlMinutes} minutes. Do not share it with anyone.`,
    );
  }

  /**
   * Verifies the code and stamps `mobileVerifiedAt` (Scenario 14).
   *
   * Stamping the customer is what unblocks activation; the verification row is
   * the evidence. Both land in one transaction, so a customer can never be
   * marked verified against a code that was not actually consumed.
   */
  async verifyOtp(
    actor: AuthContext,
    customerId: string,
    dto: VerifyMobileOtpDto,
    meta: RequestMeta,
  ): Promise<void> {
    const customer = await this.customers.findInScope(actor, customerId, meta);

    const active = await this.prisma.customerMobileVerification.findFirst({
      where: { orgId: actor.orgId, customerId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!active) {
      // Still spends a verification's worth of time, so "no code outstanding"
      // and "wrong code" cost the same — the timing itself should not report
      // which customers have a verification in flight.
      await this.passwords.burn(dto.otp);
      await this.recordFailure(actor, customerId, meta, 'NO_ACTIVE_REQUEST');
      throw new ConflictException('Enter the verification code that was sent');
    }

    if (active.expiresAt <= new Date()) {
      await this.passwords.burn(dto.otp);
      await this.recordFailure(actor, customerId, meta, 'EXPIRED');
      throw new ConflictException(
        'That verification code has expired. Send a new one.',
      );
    }

    const maxAttempts = this.num('otpMaxAttempts', 5);
    if (active.attemptCount >= maxAttempts) {
      await this.passwords.burn(dto.otp);
      await this.recordFailure(actor, customerId, meta, 'ATTEMPTS_EXHAUSTED');
      throw new ConflictException(
        'Too many incorrect attempts. Send a new code.',
      );
    }

    // The number may have been edited between minting and verifying. The code
    // proves control of the number it was sent to, and nothing about the new
    // one.
    if (active.mobile !== customer.mobile) {
      await this.passwords.burn(dto.otp);
      await this.recordFailure(actor, customerId, meta, 'MOBILE_CHANGED');
      throw new ConflictException(
        'The mobile number has changed. Send a new code.',
      );
    }

    const matches = await this.passwords.verify(active.otpHash, dto.otp);

    if (!matches) {
      await this.prisma.customerMobileVerification.update({
        where: {
          orgId_verificationId: {
            orgId: actor.orgId,
            verificationId: active.verificationId,
          },
        },
        data: { attemptCount: { increment: 1 } },
      });

      await this.recordFailure(actor, customerId, meta, 'INCORRECT');
      throw new ConflictException('That verification code is not correct');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customerMobileVerification.update({
        where: {
          orgId_verificationId: {
            orgId: actor.orgId,
            verificationId: active.verificationId,
          },
        },
        data: { consumedAt: new Date() },
      });

      await tx.customer.update({
        where: { orgId_customerId: { orgId: actor.orgId, customerId } },
        data: { mobileVerifiedAt: new Date() },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_MOBILE_VERIFIED,
          entityType: 'CUSTOMER',
          entityId: customerId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { mobile: maskMobile(customer.mobile) },
          newData: { mobileVerified: true },
        },
        tx,
      );
    });
  }

  /**
   * Generates a zero-padded numeric code.
   *
   * `randomInt` from `node:crypto`, never `Math.random`: a predictable code is
   * equivalent to no verification at all, and `Math.random` is seeded per
   * process. Identical to the password-recovery generator, deliberately.
   */
  private generateOtp(): string {
    const length = this.num('otpLength', 6);
    const max = 10 ** length;
    return String(randomInt(0, max)).padStart(length, '0');
  }

  private num(key: string, fallback: number): number {
    return this.config.get<number>(`customers.${key}`) ?? fallback;
  }

  private async recordFailure(
    actor: AuthContext,
    customerId: string,
    meta: RequestMeta,
    reason: string,
  ): Promise<void> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_MOBILE_VERIFY_FAILED,
      entityType: 'CUSTOMER',
      entityId: customerId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { reason },
    });
  }
}
