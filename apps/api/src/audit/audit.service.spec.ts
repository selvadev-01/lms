import type { PrismaService } from '../prisma/prisma.service';
import { AuditService, maskMobile, sanitizeMetadata } from './audit.service';

describe('AuditService helpers', () => {
  describe('sanitizeMetadata', () => {
    // Scenarios 20, 33, 34, 35: a password must never reach an audit record.
    it.each([
      'password',
      'Password',
      'passwordHash',
      'pwd',
      'currentPassword',
      'refreshToken',
      'tokenHash',
      'clientSecret',
      'credential',
    ])('strips the sensitive key %s', (key) => {
      const result = sanitizeMetadata({ [key]: 'Password@123', reason: 'X' });

      expect(result).not.toHaveProperty(key);
      expect(JSON.stringify(result)).not.toContain('Password@123');
    });

    it('keeps non-sensitive keys', () => {
      expect(
        sanitizeMetadata({ reason: 'INVALID_CREDENTIALS', attemptNumber: 3 }),
      ).toEqual({ reason: 'INVALID_CREDENTIALS', attemptNumber: 3 });
    });

    /**
     * The filter matches key *names*, so it also drops harmless fields that
     * merely contain "token" or "hash". Doing that silently is the hazard:
     * a contributor unaware of the convention writes `tokenId`, it never
     * appears, and nothing anywhere says the record is incomplete.
     */
    it('names the keys it dropped', () => {
      const result = sanitizeMetadata({
        reason: 'X',
        resetToken: 'secret-value',
      });

      expect(result).toEqual({ reason: 'X', redactedKeys: ['resetToken'] });
    });

    it('records only the key name, never the value it dropped', () => {
      const result = sanitizeMetadata({ password: 'Password@123' });

      expect(JSON.stringify(result)).not.toContain('Password@123');
      expect(result).toEqual({ redactedKeys: ['password'] });
    });

    it('adds nothing when there was nothing to drop', () => {
      expect(sanitizeMetadata({ reason: 'X' })).not.toHaveProperty(
        'redactedKeys',
      );
    });

    /**
     * Forgot Password Scenario 25: a usable recovery secret must never be
     * persisted in an audit record.
     */
    it.each(['resetToken', 'otpHash', 'recoverySecret'])(
      'strips the recovery secret key %s',
      (key) => {
        expect(sanitizeMetadata({ [key]: '123456' })).not.toHaveProperty(key);
      },
    );

    /**
     * The filter matches key names, not values, so recovery metadata must
     * identify a request by a name that survives it. If this ever fails, every
     * recovery audit record silently loses its only investigative handle.
     */
    it('keeps recoveryRef, the non-secret handle on a recovery request', () => {
      const recoveryRef = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
      expect(sanitizeMetadata({ recoveryRef })).toEqual({ recoveryRef });
    });

    it('returns undefined when there is no metadata', () => {
      expect(sanitizeMetadata(undefined)).toBeUndefined();
    });
  });

  describe('maskMobile', () => {
    it('reveals only the first and last two digits', () => {
      expect(maskMobile('9876543210')).toBe('98XXXXXX10');
    });

    it('never returns the original value', () => {
      const mobile = '9000000001';
      expect(maskMobile(mobile)).not.toBe(mobile);
    });

    it('fully masks values too short to partially reveal', () => {
      expect(maskMobile('123')).toBe('XXX');
    });
  });
});

/**
 * Events that belong to no tenant.
 *
 * `audit_logs` cannot hold these — `org_id` is half its primary key and a
 * foreign key — so a sign-in against an unknown organization code used to reach
 * the application log only. That left credential stuffing against invented org
 * codes with no queryable trail, which is the one attack that probes the tenant
 * boundary itself.
 */
describe('AuditService untenanted events', () => {
  let create: jest.Mock;
  let service: AuditService;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
    service = new AuditService({
      untenantedAuditLog: { create },
    } as unknown as PrismaService);
  });

  it('persists a sign-in against an unknown organization', () => {
    service.recordUnresolvableTenant({
      orgCode: 'NOPE',
      maskedMobile: '98XXXXXX10',
      ipAddress: '203.0.113.9',
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'AUTH_LOGIN_UNKNOWN_ORG',
        orgCode: 'NOPE',
        maskedMobile: '98XXXXXX10',
        ipAddress: '203.0.113.9',
      }),
    });
  });

  it('persists a rejected signup with its reason', () => {
    service.recordSignupRejected({ orgCode: 'TAKEN', reason: 'DUPLICATE' });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ORG_SIGNUP_REJECTED',
        metadata: { reason: 'DUPLICATE' },
      }),
    });
  });

  /** The value is attacker-supplied; the column is 100 wide. */
  it('truncates an over-long organization code rather than losing the record', () => {
    service.recordSignupRejected({ orgCode: 'X'.repeat(500), reason: 'BAD' });

    const data = create.mock.calls[0][0].data as { orgCode: string };
    expect(data.orgCode).toHaveLength(100);
  });

  /**
   * A write failure must not surface to the caller. If it did, an attacker
   * could tell a real organization code from an invented one by which request
   * errors — the enumeration oracle the constant response text exists to deny.
   */
  it('swallows a write failure rather than failing the request', () => {
    create.mockRejectedValue(new Error('table missing'));

    expect(() =>
      service.recordUnresolvableTenant({
        orgCode: 'NOPE',
        maskedMobile: '98XXXXXX10',
      }),
    ).not.toThrow();
  });
});
