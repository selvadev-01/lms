import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { PasswordService } from '../../auth/password.service';
import type { AuthContext } from '../../common/auth-context';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SmsService } from '../../sms/sms.service';
import { CustomerMobileService } from './customer-mobile.service';
import type { CustomerService } from './customer.service';

/**
 * LOCAL customer mobile verification (Module 04, Scenarios 2, 14).
 *
 * For a LOCAL customer this OTP is the *only* identity evidence the system ever
 * collects (Q-CUST-27), so the tests here are about it being a real check rather
 * than a formality.
 *
 * **The code is never stored or logged in clear text.** Asserted directly
 * against the audit metadata, because a leaked database or a verbose log should
 * not hand over a live credential.
 *
 * **Every failure path burns a verification's worth of time.** Otherwise
 * response timing tells a caller which customers have a code outstanding.
 *
 * **A number changed mid-flow invalidates the code.** The OTP proves control of
 * the number it was sent to and nothing about a new one.
 *
 * **Only a successful verify stamps the customer**, and it does so in the same
 * transaction that consumes the code — so a customer can never read as verified
 * against a code that was not actually spent.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
const VERIFICATION_ID = '44444444-4444-4444-4444-444444444444';

const META: RequestMeta = {
  requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  ipAddress: '203.0.113.11',
  userAgent: 'jest',
};

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: ACTOR_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    branchId: null,
    roles: ['BRANCH_ADMIN'],
    permissions: ['customers.update'],
    ...overrides,
  };
}

/**
 * `expect.objectContaining` and `expect.stringContaining` are typed `any`,
 * which trips `no-unsafe-assignment` as soon as either is nested inside an
 * object literal. Narrowing them once here keeps the assertions below both
 * readable and type-safe — the same helper `branch.service.spec.ts` introduced
 * for Module 02.
 */
function containing(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

function containingString(fragment: string): unknown {
  return expect.stringContaining(fragment) as unknown;
}

function build(
  options: {
    customerType?: 'KYC' | 'LOCAL';
    mobileVerifiedAt?: Date | null;
    active?: Record<string, unknown> | null;
    otpMatches?: boolean;
  } = {},
) {
  const customer = {
    customerId: CUSTOMER_ID,
    customerType: options.customerType ?? ('LOCAL' as const),
    mobile: '9100000006',
    mobileVerifiedAt: options.mobileVerifiedAt ?? null,
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const created: Record<string, unknown>[] = [];

  const client = {
    customerMobileVerification: {
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.orgId !== ORG_ID) {
          throw new Error(
            'mobileVerification.findFirst must be tenant-filtered',
          );
        }
        return Promise.resolve(
          options.active === undefined
            ? {
                verificationId: VERIFICATION_ID,
                mobile: '9100000006',
                otpHash: 'hashed',
                attemptCount: 0,
                expiresAt: new Date(Date.now() + 600_000),
                consumedAt: null,
              }
            : options.active,
        );
      }),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        if (args.data.orgId !== ORG_ID) {
          throw new Error('mobileVerification.create must carry the orgId');
        }
        created.push(args.data);
        return Promise.resolve({ verificationId: VERIFICATION_ID });
      }),
      update: jest.fn(() => Promise.resolve({})),
      updateMany: jest.fn((args: { where: Record<string, unknown> }) => {
        if (args.where.orgId !== ORG_ID) {
          throw new Error(
            'mobileVerification.updateMany must be tenant-filtered',
          );
        }
        return Promise.resolve({ count: 1 });
      }),
    },
    customer: {
      update: jest.fn(
        (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const key = args.where.orgId_customerId as { orgId: string };
          if (key.orgId !== ORG_ID) {
            throw new Error('customer.update must be tenant-filtered');
          }
          Object.assign(customer, args.data);
          return Promise.resolve({ ...customer });
        },
      ),
    },
  };

  const prisma = {
    ...client,
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn(client),
    ),
  } as unknown as PrismaService;

  const customersMocks = {
    findInScope: jest.fn().mockResolvedValue(customer),
  };
  const customers = customersMocks as unknown as CustomerService;

  const passwordsMocks = {
    hash: jest.fn().mockResolvedValue('hashed'),
    verify: jest.fn().mockResolvedValue(options.otpMatches ?? true),
    burn: jest.fn().mockResolvedValue(undefined),
  };
  const passwords = passwordsMocks as unknown as PasswordService;

  const smsMocks = {
    send: jest.fn().mockResolvedValue(undefined),
  };
  const sms = smsMocks as unknown as SmsService;

  const config = {
    get: jest.fn((key: string) => {
      if (key === 'customers.otpLength') return 6;
      if (key === 'customers.otpTtlMinutes') return 15;
      if (key === 'customers.otpMaxAttempts') return 5;
      return undefined;
    }),
  } as unknown as ConfigService;

  const service = new CustomerMobileService(
    prisma,
    audit as unknown as AuditService,
    customers,
    passwords,
    sms,
    config,
  );

  /**
   * The `*Mocks` bindings are returned rather than the cast services.
   *
   * `unbound-method` fires on any member access whose object *type* is a real
   * class, so an assertion must read the `jest.fn()` off the object literal.
   * The cast values above exist only to satisfy the constructor.
   */
  return {
    service,
    audit,
    customersMocks,
    passwordsMocks,
    smsMocks,
    client,
    customer,
    created,
  };
}

describe('CustomerMobileService.sendOtp', () => {
  it('sends a code to the customer mobile', async () => {
    const { service, smsMocks } = build();
    await service.sendOtp(actor(), CUSTOMER_ID, META);

    expect(smsMocks.send).toHaveBeenCalledWith(
      ORG_ID,
      '9100000006',
      expect.stringContaining('verification code'),
    );
  });

  it('stores the code hashed, never in clear text', async () => {
    const { service, created, passwordsMocks } = build();
    await service.sendOtp(actor(), CUSTOMER_ID, META);

    expect(passwordsMocks.hash).toHaveBeenCalled();
    expect(created[0].otpHash).toBe('hashed');
    expect(Object.keys(created[0])).not.toContain('otp');
  });

  it('never puts the code in the audit metadata', async () => {
    const { service, audit, smsMocks } = build();
    await service.sendOtp(actor(), CUSTOMER_ID, META);

    // Typed explicitly: `mock.calls` is `any[][]`, and reading the message and
    // the audit input off it untyped is what the unsafe-access rules object to.
    const sentCalls = smsMocks.send.mock.calls as Array<
      [string, string, string]
    >;
    const sent = sentCalls[0]?.[2];
    const otp = /\b(\d{6})\b/.exec(sent)?.[1];

    const auditCalls = audit.record.mock.calls as Array<
      [{ action: string; metadata?: Record<string, unknown> }]
    >;
    const auditCall = auditCalls.find(
      ([input]) => input.action === AuditAction.CUSTOMER_MOBILE_OTP_SENT,
    );

    expect(otp).toBeDefined();
    expect(JSON.stringify(auditCall?.[0].metadata)).not.toContain(otp);
  });

  it('masks the mobile number in the audit metadata', async () => {
    const { service, audit } = build();
    await service.sendOtp(actor(), CUSTOMER_ID, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_MOBILE_OTP_SENT,
        metadata: containing({
          mobile: containingString('X'),
        }),
      }),
      expect.anything(),
    );
  });

  // Three live codes at once would triple the guessing surface for no benefit.
  it('invalidates any previous unconsumed code', async () => {
    const { service, client } = build();
    await service.sendOtp(actor(), CUSTOMER_ID, META);

    expect(client.customerMobileVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: containing({ consumedAt: null }),
      }),
    );
  });

  it('captures the number the code was minted for', async () => {
    const { service, created } = build();
    await service.sendOtp(actor(), CUSTOMER_ID, META);

    expect(created[0].mobile).toBe('9100000006');
  });

  // The two identity paths are not interchangeable.
  it('refuses to send a code for a KYC customer', async () => {
    const { service } = build({ customerType: 'KYC' });

    await expect(service.sendOtp(actor(), CUSTOMER_ID, META)).rejects.toThrow(
      /Local customers/,
    );
  });

  it('refuses to send a code for an already-verified number', async () => {
    const { service } = build({ mobileVerifiedAt: new Date() });

    await expect(service.sendOtp(actor(), CUSTOMER_ID, META)).rejects.toThrow(
      /already verified/,
    );
  });

  it('resolves the customer through the shared scope check', async () => {
    const { service, customersMocks } = build();
    await service.sendOtp(actor(), CUSTOMER_ID, META);

    expect(customersMocks.findInScope).toHaveBeenCalled();
  });
});

describe('CustomerMobileService.verifyOtp', () => {
  // Scenario 14 — this is what unblocks activation.
  it('stamps the customer on a correct code', async () => {
    const { service, customer } = build();
    await service.verifyOtp(actor(), CUSTOMER_ID, { otp: '123456' }, META);

    expect(jest.mocked(customer).mobileVerifiedAt).toBeInstanceOf(Date);
  });

  it('consumes the code so it cannot be reused', async () => {
    const { service, client } = build();
    await service.verifyOtp(actor(), CUSTOMER_ID, { otp: '123456' }, META);

    expect(client.customerMobileVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ consumedAt: expect.any(Date) }),
      }),
    );
  });

  it('audits a successful verification', async () => {
    const { service, audit } = build();
    await service.verifyOtp(actor(), CUSTOMER_ID, { otp: '123456' }, META);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.CUSTOMER_MOBILE_VERIFIED }),
      expect.anything(),
    );
  });

  it('rejects an incorrect code and does not stamp the customer', async () => {
    const { service, customer } = build({ otpMatches: false });

    await expect(
      service.verifyOtp(actor(), CUSTOMER_ID, { otp: '999999' }, META),
    ).rejects.toThrow(/not correct/);

    expect(jest.mocked(customer).mobileVerifiedAt).toBeNull();
  });

  it('counts a failed attempt', async () => {
    const { service, client } = build({ otpMatches: false });

    await service
      .verifyOtp(actor(), CUSTOMER_ID, { otp: '999999' }, META)
      .catch(() => {});

    expect(client.customerMobileVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ attemptCount: { increment: 1 } }),
      }),
    );
  });

  it('rejects an expired code', async () => {
    const { service } = build({
      active: {
        verificationId: VERIFICATION_ID,
        mobile: '9100000006',
        otpHash: 'hashed',
        attemptCount: 0,
        expiresAt: new Date(Date.now() - 1000),
        consumedAt: null,
      },
    });

    await expect(
      service.verifyOtp(actor(), CUSTOMER_ID, { otp: '123456' }, META),
    ).rejects.toThrow(/expired/);
  });

  it('rejects once attempts are exhausted', async () => {
    const { service } = build({
      active: {
        verificationId: VERIFICATION_ID,
        mobile: '9100000006',
        otpHash: 'hashed',
        attemptCount: 5,
        expiresAt: new Date(Date.now() + 600_000),
        consumedAt: null,
      },
    });

    await expect(
      service.verifyOtp(actor(), CUSTOMER_ID, { otp: '123456' }, META),
    ).rejects.toThrow(/Too many/);
  });

  // The code proves control of the number it was sent to, not of a new one.
  it('rejects a code minted for a different number', async () => {
    const { service } = build({
      active: {
        verificationId: VERIFICATION_ID,
        mobile: '9188888888',
        otpHash: 'hashed',
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 600_000),
        consumedAt: null,
      },
    });

    await expect(
      service.verifyOtp(actor(), CUSTOMER_ID, { otp: '123456' }, META),
    ).rejects.toThrow(/mobile number has changed/);
  });

  it('rejects when no code is outstanding', async () => {
    const { service } = build({ active: null });

    await expect(
      service.verifyOtp(actor(), CUSTOMER_ID, { otp: '123456' }, META),
    ).rejects.toThrow(ConflictException);
  });

  // Otherwise the response timing reports which customers have a code in flight.
  it.each([
    ['no outstanding code', { active: null }],
    [
      'an expired code',
      {
        active: {
          verificationId: VERIFICATION_ID,
          mobile: '9100000006',
          otpHash: 'hashed',
          attemptCount: 0,
          expiresAt: new Date(Date.now() - 1000),
          consumedAt: null,
        },
      },
    ],
  ])('spends verification time on %s', async (_label, options) => {
    const { service, passwordsMocks } = build(options);

    await service
      .verifyOtp(actor(), CUSTOMER_ID, { otp: '123456' }, META)
      .catch(() => {});

    expect(passwordsMocks.burn).toHaveBeenCalled();
  });

  it.each([
    ['NO_ACTIVE_REQUEST', { active: null }],
    ['INCORRECT', { otpMatches: false }],
  ])('audits a %s failure with its reason', async (reason, options) => {
    const { service, audit } = build(options);

    await service
      .verifyOtp(actor(), CUSTOMER_ID, { otp: '123456' }, META)
      .catch(() => {});

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CUSTOMER_MOBILE_VERIFY_FAILED,
        metadata: containing({ reason }),
      }),
    );
  });
});
