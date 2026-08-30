import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../audit/audit.service';
import { OrganizationProvisioningService } from '../organizations/provisioning/organization-provisioning.service';
import type { RequestMeta } from './auth.service';
import { SignUpDto } from './dto/sign-up.dto';
import { PasswordPolicyService } from './password-policy.service';
import { PasswordService } from './password.service';
import { SignUpService } from './sign-up.service';

/**
 * Public organization signup.
 *
 * Two properties carry most of the weight. The flag must be checked before any
 * work happens, so a disabled deployment cannot be made to hash a password or
 * touch the database by an unauthenticated caller. And the password must be
 * hashed *before* the provisioning transaction opens — argon2 is deliberately
 * expensive, and holding a transaction across it wastes a connection for no
 * reason.
 */

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

function dto(overrides: Partial<SignUpDto> = {}): SignUpDto {
  return {
    orgName: 'Kestrel Finance',
    orgCode: 'kestrel',
    adminName: 'Asha R',
    adminMobile: '9876543210',
    password: 'Falcon9Ridge2026',
    ...overrides,
  };
}

function setup(options: { enabled?: boolean } = {}) {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'signup.allowPublicSignup') return options.enabled ?? true;
      if (key === 'signup.transactionTimeoutMs') return 30_000;
      return undefined;
    }),
  };

  const passwords = {
    hash: jest.fn().mockResolvedValue('$argon2id$fake'),
  };

  const policy = { assertMeetsPolicy: jest.fn() };

  const provisioning = {
    provision: jest.fn().mockResolvedValue({
      orgId: 'org-1',
      orgCode: 'KESTREL',
      branchId: 'branch-1',
      userId: 'user-1',
      counts: {},
    }),
  };

  const audit = { recordSignupRejected: jest.fn() };

  const service = new SignUpService(
    config as unknown as ConfigService,
    passwords as unknown as PasswordService,
    policy as unknown as PasswordPolicyService,
    provisioning as unknown as OrganizationProvisioningService,
    audit as unknown as AuditService,
  );

  return { service, config, passwords, policy, provisioning, audit };
}

describe('SignUpService', () => {
  describe('the feature flag', () => {
    it('404s when signup is disabled', async () => {
      // 404 rather than 403: a 403 confirms the endpoint exists and is merely
      // switched off, which invites a scanner to check back.
      const { service } = setup({ enabled: false });

      await expect(service.signUp(dto(), META)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('does no work at all when disabled', async () => {
      // Checked before hashing, so a disabled deployment cannot be made to burn
      // argon2 cycles by an unauthenticated caller.
      const { service, passwords, policy, provisioning } = setup({
        enabled: false,
      });

      await service.signUp(dto(), META).catch(() => undefined);

      expect(policy.assertMeetsPolicy).not.toHaveBeenCalled();
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(provisioning.provision).not.toHaveBeenCalled();
    });
  });

  describe('the organization code', () => {
    it('uppercases it before anything else sees it', async () => {
      // `Organization.code` is a plain unique column, so `acme` and `ACME`
      // would be two tenants nobody could tell apart at the sign-in screen.
      const { service, provisioning } = setup();

      const result = await service.signUp(dto({ orgCode: 'kestrel' }), META);

      expect(provisioning.provision).toHaveBeenCalledWith(
        expect.objectContaining({ orgCode: 'KESTREL' }),
        META,
        30_000,
      );
      expect(result.orgCode).toBe('KESTREL');
    });

    it('trims surrounding whitespace', async () => {
      const { service, provisioning } = setup();

      await service.signUp(dto({ orgCode: '  kestrel  ' }), META);

      expect(provisioning.provision).toHaveBeenCalledWith(
        expect.objectContaining({ orgCode: 'KESTREL' }),
        META,
        30_000,
      );
    });
  });

  describe('the password', () => {
    it('is checked against the policy, with the account identifiers', async () => {
      // Q-PWD-8: a password may not embed the account's own identifiers.
      const { service, policy } = setup();

      await service.signUp(dto(), META);

      expect(policy.assertMeetsPolicy).toHaveBeenCalledWith(
        'Falcon9Ridge2026',
        ['Asha R', '9876543210', 'KESTREL'],
      );
    });

    it('is hashed before the provisioning transaction opens', async () => {
      const { service, passwords, provisioning } = setup();

      await service.signUp(dto(), META);

      expect(passwords.hash.mock.invocationCallOrder[0]).toBeLessThan(
        provisioning.provision.mock.invocationCallOrder[0],
      );
      expect(provisioning.provision).toHaveBeenCalledWith(
        expect.objectContaining({ adminPasswordHash: '$argon2id$fake' }),
        META,
        30_000,
      );
    });

    it('never reaches the provisioner in plaintext', async () => {
      const { service, provisioning } = setup();

      await service.signUp(dto(), META);

      const [firstCall] = provisioning.provision.mock.calls as Array<
        [Record<string, unknown>]
      >;
      const passed = JSON.stringify(firstCall?.[0]);
      expect(passed).not.toContain('Falcon9Ridge2026');
    });

    it('refuses a weak password before touching the database', async () => {
      const { service, policy, passwords, provisioning } = setup();
      policy.assertMeetsPolicy.mockImplementation(() => {
        throw new Error('Password is too short');
      });

      await expect(service.signUp(dto(), META)).rejects.toThrow(
        'Password is too short',
      );
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(provisioning.provision).not.toHaveBeenCalled();
    });
  });

  describe('rejections', () => {
    it('logs a failed signup rather than auditing it', async () => {
      // There is no orgId to scope an audit row against — the rejection is
      // precisely that no organization came into existence. Same documented
      // deviation as `recordUnresolvableTenant`.
      const { service, provisioning, audit } = setup();
      provisioning.provision.mockRejectedValue(
        new ConflictException('code taken'),
      );

      await expect(service.signUp(dto(), META)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(audit.recordSignupRejected).toHaveBeenCalledWith(
        expect.objectContaining({
          orgCode: 'KESTREL',
          ipAddress: '203.0.113.7',
        }),
      );
    });

    it('re-throws the original failure rather than masking it', async () => {
      const { service, provisioning } = setup();
      provisioning.provision.mockRejectedValue(
        new ConflictException('code taken'),
      );

      const error = await service.signUp(dto(), META).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
    });
  });

  describe('the response', () => {
    it('names the organization so the client can pre-fill sign-in', async () => {
      // No cookies are set: signing in is a separate act, so a session failure
      // cannot make a successful provisioning look like an error.
      const { service } = setup();

      const result = await service.signUp(dto(), META);

      expect(result.orgCode).toBe('KESTREL');
      expect(result.message).toContain('KESTREL');
    });
  });
});
