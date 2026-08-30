import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../audit/audit.service';
import { OrganizationProvisioningService } from '../organizations/provisioning/organization-provisioning.service';
import type { RequestMeta } from './auth.service';
import { SignUpDto } from './dto/sign-up.dto';
import { PasswordPolicyService } from './password-policy.service';
import { PasswordService } from './password.service';

export interface SignUpResult {
  /** The canonical (uppercased) code, to pre-fill the sign-in form. */
  orgCode: string;
  message: string;
}

/**
 * Public organization signup — Q-ACT-1 and Q-ACT-2.
 *
 * Deliberately does not sign the new administrator in. Minting a session would
 * give this endpoint a second failure mode where provisioning succeeded and the
 * session did not, showing an error for an organization that actually exists.
 * They just typed the password, so re-entering it once is a fair price for the
 * endpoint doing one thing.
 */
@Injectable()
export class SignUpService {
  constructor(
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
    private readonly policy: PasswordPolicyService,
    private readonly provisioning: OrganizationProvisioningService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 404 rather than 403 when signup is switched off.
   *
   * A 403 confirms the endpoint exists and is merely disabled, which tells a
   * scanner this deployment has signup code and invites them to check back. A
   * 404 is indistinguishable from a route that was never built.
   */
  private assertEnabled(): void {
    if (!this.config.get<boolean>('signup.allowPublicSignup')) {
      throw new NotFoundException();
    }
  }

  async signUp(dto: SignUpDto, meta: RequestMeta): Promise<SignUpResult> {
    this.assertEnabled();

    const orgCode = dto.orgCode.trim().toUpperCase();

    // Reuses the same policy the change-password and reset flows enforce,
    // including the Q-PWD-8 rule that a password may not embed the account's
    // own identifiers. `assertNotReused` is deliberately not called: history is
    // per-user and there is no user yet.
    this.policy.assertMeetsPolicy(dto.password, [
      dto.adminName,
      dto.adminMobile,
      orgCode,
    ]);

    // Before the transaction opens. argon2 is ~19 MiB and a few hundred
    // milliseconds of deliberate CPU, and holding a database transaction across
    // it is pure waste.
    const adminPasswordHash = await this.passwords.hash(dto.password);

    try {
      const provisioned = await this.provisioning.provision(
        {
          orgName: dto.orgName,
          orgCode,
          adminName: dto.adminName,
          adminMobile: dto.adminMobile,
          adminPasswordHash,
        },
        meta,
        this.config.get<number>('signup.transactionTimeoutMs'),
      );

      return {
        orgCode: provisioned.orgCode,
        message: `Organization ${provisioned.orgCode} is ready. Sign in to continue.`,
      };
    } catch (error) {
      // A rejected signup creates no organization, so there is no orgId to
      // scope an audit row against — the same documented deviation as
      // `recordUnresolvableTenant`. Logged instead.
      this.audit.recordSignupRejected({
        orgCode,
        reason: error instanceof Error ? error.message : 'unknown',
        requestId: meta.requestId ?? undefined,
        ipAddress: meta.ipAddress ?? undefined,
        userAgent: meta.userAgent ?? undefined,
      });
      throw error;
    }
  }
}
