import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import { SessionService } from '../../auth/session.service';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthContext } from '../auth-context';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * JwtAuthGuard — the point at which Logout, expiry and revocation become real.
 *
 * Covers Active Sessions Scenarios 6, 11, 12, 13, 17, 21, 22, 27, 28, 29, 36
 * and 39. These are the story's load-bearing security tests: before the session
 * lookup existed, a signed token alone was enough, so a logged-out session kept
 * working until the token's own 15-minute expiry.
 *
 * Module 03 added a third check on the same path and its own set of load-bearing
 * cases at the bottom of this file. Before it, roles and permissions came from
 * the token, so deactivating a user or revoking a permission changed nothing
 * until they signed in again.
 *
 * Collaborators are hand-rolled fakes rather than a Nest testing module, in
 * keeping with auth.service.spec.ts.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_ORG_ID = '44444444-4444-4444-4444-444444444444';
const BRANCH_ID = '55555555-5555-5555-5555-555555555555';

const TOKEN_PAYLOAD = {
  sub: USER_ID,
  orgId: ORG_ID,
  orgCode: 'DEMO',
  sid: SESSION_ID,
  branchId: BRANCH_ID,
  roles: ['BRANCH_ADMIN'],
  permissions: ['dashboard.view'],
};

interface FakeRequest {
  cookies: Record<string, string | undefined>;
  user?: AuthContext;
  requestId?: string;
  ip?: string | null;
  header: (name: string) => string | undefined;
  body?: unknown;
}

function buildRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    cookies: { lms_at: 'signed.access.token' },
    requestId: '66666666-6666-6666-6666-666666666666',
    ip: '203.0.113.7',
    header: () => 'jest-agent',
    ...overrides,
  };
}

function buildContext(request: FakeRequest): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let validateForRequest: jest.Mock;
  let record: jest.Mock;
  let verifyAsync: jest.Mock;
  let resolve: jest.Mock;
  let isPublic: boolean;

  beforeEach(() => {
    isPublic = false;
    verifyAsync = jest.fn().mockResolvedValue(TOKEN_PAYLOAD);
    validateForRequest = jest.fn().mockResolvedValue({
      state: 'ACTIVE',
      userId: USER_ID,
      branchId: BRANCH_ID,
    });
    record = jest.fn().mockResolvedValue(undefined);
    /**
     * The default is an ACTIVE account whose effective permissions happen to
     * match the token's. They match so the pre-Module-03 tests keep asserting
     * what they always did; the tests that care about the difference override
     * this to prove the database value is the one that wins.
     */
    resolve = jest.fn().mockResolvedValue({
      status: 'ACTIVE',
      branchId: BRANCH_ID,
      roles: ['BRANCH_ADMIN'],
      permissions: ['dashboard.view'],
    });

    const reflector = {
      getAllAndOverride: () => isPublic,
    } as unknown as Reflector;
    const jwtService = { verifyAsync } as unknown as JwtService;
    const config = {
      get: () => 'a-test-secret-at-least-32-characters-long',
    } as unknown as ConfigService;
    const sessions = { validateForRequest } as unknown as SessionService;
    const audit = { record } as unknown as AuditService;
    const authorization = { resolve } as unknown as AuthorizationService;

    guard = new JwtAuthGuard(
      reflector,
      jwtService,
      config,
      sessions,
      audit,
      authorization,
    );
  });

  /** The single message every denial uses, whatever the underlying cause. */
  async function expectDenied(request: FakeRequest): Promise<void> {
    await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
      UnauthorizedException,
    );
  }

  function auditedActions(): string[] {
    const calls = record.mock.calls as Array<[{ action: string }]>;
    return calls.map(([input]) => input.action);
  }

  describe('successful authentication', () => {
    it('admits a request whose session is ACTIVE', async () => {
      const request = buildRequest();

      await expect(guard.canActivate(buildContext(request))).resolves.toBe(
        true,
      );

      expect(validateForRequest).toHaveBeenCalledWith(ORG_ID, SESSION_ID);
      expect(request.user?.userId).toBe(USER_ID);
      expect(record).not.toHaveBeenCalled();
    });

    it('skips both token and session checks on a @Public() route', async () => {
      isPublic = true;

      await expect(
        guard.canActivate(buildContext(buildRequest({ cookies: {} }))),
      ).resolves.toBe(true);

      expect(verifyAsync).not.toHaveBeenCalled();
      expect(validateForRequest).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 6: a logged-out session cannot access protected resources', () => {
    it('rejects immediately rather than waiting for the token to expire', async () => {
      validateForRequest.mockResolvedValue({
        state: 'LOGGED_OUT',
        userId: USER_ID,
        branchId: BRANCH_ID,
      });

      await expectDenied(buildRequest());

      expect(auditedActions()).toContain(
        AuditAction.SESSION_REJECTED_LOGGED_OUT,
      );
    });

    it('does not populate request.user when the session is terminated', async () => {
      validateForRequest.mockResolvedValue({
        state: 'LOGGED_OUT',
        userId: USER_ID,
        branchId: BRANCH_ID,
      });
      const request = buildRequest();

      await expectDenied(request);

      // Nothing downstream can mistake the caller for authenticated.
      expect(request.user).toBeUndefined();
    });
  });

  describe('Scenarios 11 and 12: an expired session cannot read or write', () => {
    it('rejects an expired session and audits the expiry', async () => {
      validateForRequest.mockResolvedValue({
        state: 'EXPIRED',
        userId: USER_ID,
        branchId: BRANCH_ID,
      });

      await expectDenied(buildRequest());

      expect(auditedActions()).toContain(AuditAction.SESSION_REJECTED_EXPIRED);
    });
  });

  describe('Scenarios 13 and 29: a revoked session cannot be used or replayed', () => {
    it('rejects a revoked session', async () => {
      validateForRequest.mockResolvedValue({
        state: 'REVOKED',
        userId: USER_ID,
        branchId: BRANCH_ID,
      });

      await expectDenied(buildRequest());

      expect(auditedActions()).toContain(AuditAction.SESSION_REJECTED_REVOKED);
    });

    it('keeps rejecting the same credential when it is presented again', async () => {
      validateForRequest.mockResolvedValue({
        state: 'REVOKED',
        userId: USER_ID,
        branchId: BRANCH_ID,
      });

      await expectDenied(buildRequest());
      await expectDenied(buildRequest());

      // No path reinstates a revoked session; every replay is denied afresh.
      expect(validateForRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('Scenario 28: an invalid session identifier is rejected', () => {
    it('denies when the session resolves to nothing', async () => {
      validateForRequest.mockResolvedValue(null);

      await expectDenied(buildRequest());

      expect(auditedActions()).toContain(AuditAction.SESSION_REJECTED_UNKNOWN);
    });

    it('records no actor for an unresolvable session', async () => {
      validateForRequest.mockResolvedValue(null);

      await expectDenied(buildRequest());

      // The user reference is unverified, and the audit FK would reject it.
      const [input] = record.mock.calls[0] as [{ actorUserId: string | null }];
      expect(input.actorUserId).toBeNull();
    });

    it('denies a token whose signature does not verify', async () => {
      verifyAsync.mockRejectedValue(new Error('invalid signature'));

      await expectDenied(buildRequest());

      expect(validateForRequest).not.toHaveBeenCalled();
    });

    it('denies when no access cookie is present at all', async () => {
      await expectDenied(buildRequest({ cookies: {} }));

      expect(verifyAsync).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 36: the session store is unavailable', () => {
    it('fails closed — a store outage denies rather than admits', async () => {
      validateForRequest.mockRejectedValue(new Error('connection refused'));

      await expectDenied(buildRequest());
    });

    it('audits the outage as an operational alarm', async () => {
      validateForRequest.mockRejectedValue(new Error('connection refused'));

      await expectDenied(buildRequest());

      expect(auditedActions()).toContain(AuditAction.SESSION_STORE_UNAVAILABLE);
    });

    it('does not populate request.user when the store cannot be read', async () => {
      validateForRequest.mockRejectedValue(new Error('connection refused'));
      const request = buildRequest();

      await expectDenied(request);

      expect(request.user).toBeUndefined();
    });
  });

  describe('Scenario 39: validation fails unexpectedly', () => {
    it('denies rather than bypassing validation when auditing also fails', async () => {
      validateForRequest.mockRejectedValue(new Error('connection refused'));
      record.mockRejectedValue(new Error('audit store down'));

      // A failed audit write must not convert a denial into an allow.
      await expectDenied(buildRequest());
    });

    it('still denies a revoked session when the audit write fails', async () => {
      validateForRequest.mockResolvedValue({
        state: 'REVOKED',
        userId: USER_ID,
        branchId: BRANCH_ID,
      });
      record.mockRejectedValue(new Error('audit store down'));

      await expectDenied(buildRequest());
    });
  });

  describe('Scenarios 21, 22 and 27: scope cannot be changed by the client', () => {
    it('derives organization and branch from the token, never the request body', async () => {
      const request = buildRequest({
        body: {
          orgId: OTHER_ORG_ID,
          branchId: '99999999-9999-9999-9999-999999999999',
          userId: '88888888-8888-8888-8888-888888888888',
          permissions: ['loans.approve'],
        },
      });

      await guard.canActivate(buildContext(request));

      expect(request.user?.orgId).toBe(ORG_ID);
      expect(request.user?.branchId).toBe(BRANCH_ID);
      expect(request.user?.userId).toBe(USER_ID);
      expect(request.user?.permissions).toEqual(['dashboard.view']);
    });

    it('looks the session up under the token organization, not a submitted one', async () => {
      await guard.canActivate(
        buildContext(buildRequest({ body: { orgId: OTHER_ORG_ID } })),
      );

      expect(validateForRequest).toHaveBeenCalledWith(ORG_ID, SESSION_ID);
    });
  });

  describe('Scenario 17: a deactivated account is revalidated', () => {
    it('denies once the account event has revoked the session', async () => {
      // Deactivation revokes the user's sessions; the next request sees that.
      validateForRequest.mockResolvedValue({
        state: 'REVOKED',
        userId: USER_ID,
        branchId: BRANCH_ID,
      });

      await expectDenied(buildRequest());
    });
  });

  describe('audit content', () => {
    it('records the session id but never a token or its hash', async () => {
      validateForRequest.mockResolvedValue({
        state: 'REVOKED',
        userId: USER_ID,
        branchId: BRANCH_ID,
      });

      await expectDenied(buildRequest());

      const [input] = record.mock.calls[0] as [Record<string, unknown>];
      expect(input.entityId).toBe(SESSION_ID);
      expect(input.entityType).toBe('USER_SESSION');
      expect(JSON.stringify(input)).not.toContain('signed.access.token');
    });
  });

  /**
   * Module 03 — live authorization.
   *
   * Everything above proves the *session* is still valid. These prove the
   * *account* is, and that what it may do is read from the database rather than
   * trusted from the token. Without them a deactivation, a role change or a
   * permission revocation would take effect only at the next sign-in, which
   * Rules 24, 26, 45, 49 and 57 explicitly forbid.
   */
  describe('Module 03 Scenarios 9 and 45: account status is revalidated', () => {
    it.each(['INACTIVE', 'LOCKED', 'SUSPENDED', 'PENDING'])(
      'denies a %s account holding a valid token and a live session',
      async (status) => {
        // Note the session is deliberately still ACTIVE. This is the case the
        // session lookup alone cannot catch: nothing revoked the session, the
        // account itself stopped being usable.
        resolve.mockResolvedValue({
          status,
          branchId: BRANCH_ID,
          roles: ['BRANCH_ADMIN'],
          permissions: ['dashboard.view'],
        });

        await expectDenied(buildRequest());

        expect(auditedActions()).toContain(
          AuditAction.AUTHZ_DENIED_ACCOUNT_STATUS,
        );
      },
    );

    it('records the refused status so the trail says why', async () => {
      resolve.mockResolvedValue({
        status: 'INACTIVE',
        branchId: BRANCH_ID,
        roles: [],
        permissions: [],
      });

      await expectDenied(buildRequest());

      const [input] = record.mock.calls[0] as [
        { metadata?: { status?: string }; entityType?: string },
      ];
      expect(input.metadata?.status).toBe('INACTIVE');
      expect(input.entityType).toBe('USER');
    });

    it('denies when the user row no longer exists', async () => {
      resolve.mockResolvedValue(null);

      await expectDenied(buildRequest());

      expect(auditedActions()).toContain(AuditAction.AUTHZ_USER_MISSING);
    });

    it('does not name the vanished user as the audit actor', async () => {
      // actorUserId carries a composite FK to users; naming a row that is gone
      // would have the audit write itself rejected.
      resolve.mockResolvedValue(null);

      await expectDenied(buildRequest());

      const [input] = record.mock.calls[0] as [{ actorUserId: unknown }];
      expect(input.actorUserId).toBeNull();
    });
  });

  describe('Module 03 Scenario 61: authorization failure fails closed', () => {
    it('denies when the authorization query throws', async () => {
      resolve.mockRejectedValue(new Error('connection refused'));

      await expectDenied(buildRequest());

      expect(auditedActions()).toContain(AuditAction.AUTHZ_RESOLUTION_FAILED);
    });

    it('still denies when the audit write also fails', async () => {
      resolve.mockRejectedValue(new Error('connection refused'));
      record.mockRejectedValue(new Error('audit store down'));

      // Neither failure may be allowed to produce an admitted request.
      await expectDenied(buildRequest());
    });

    it('does not fall back to the token permissions when resolution fails', async () => {
      resolve.mockRejectedValue(new Error('connection refused'));

      const request = buildRequest();
      await expectDenied(request);

      expect(request.user).toBeUndefined();
    });
  });

  describe('Module 03 Scenarios 46 and 47: the database is authoritative', () => {
    it('uses the resolved permissions, not the token claims', async () => {
      // The token was issued when the user could approve loans; the role has
      // since lost that permission. The request must see the current set.
      resolve.mockResolvedValue({
        status: 'ACTIVE',
        branchId: BRANCH_ID,
        roles: ['BRANCH_ADMIN'],
        permissions: ['dashboard.view'],
      });
      verifyAsync.mockResolvedValue({
        ...TOKEN_PAYLOAD,
        permissions: ['dashboard.view', 'loans.approve'],
        roles: ['SUPER_ADMIN'],
      });

      const request = buildRequest();
      await guard.canActivate(buildContext(request));

      expect(request.user?.permissions).toEqual(['dashboard.view']);
      expect(request.user?.roles).toEqual(['BRANCH_ADMIN']);
    });

    it('grants a permission added since the token was issued', async () => {
      // The reverse direction: re-resolution must not only take access away.
      resolve.mockResolvedValue({
        status: 'ACTIVE',
        branchId: BRANCH_ID,
        roles: ['BRANCH_ADMIN'],
        permissions: ['dashboard.view', 'users.view'],
      });

      const request = buildRequest();
      await guard.canActivate(buildContext(request));

      expect(request.user?.permissions).toContain('users.view');
    });

    it('resolves against the token organization and subject', async () => {
      await guard.canActivate(
        buildContext(buildRequest({ body: { orgId: OTHER_ORG_ID } })),
      );

      expect(resolve).toHaveBeenCalledWith(ORG_ID, USER_ID);
    });
  });

  /**
   * The narrowing rule. Rule 50 says a reassignment must not widen a session
   * already in flight; Rules 3, 5 and 33 say branch scope must be current. The
   * guard takes whichever is narrower, and these two cases are what stop that
   * being "simplified" to just reading the database value.
   */
  describe('Module 03 Rule 50: branch scope narrows but never widens', () => {
    it('applies a demotion to a branch immediately', async () => {
      verifyAsync.mockResolvedValue({ ...TOKEN_PAYLOAD, branchId: null });
      resolve.mockResolvedValue({
        status: 'ACTIVE',
        branchId: BRANCH_ID,
        roles: ['BRANCH_ADMIN'],
        permissions: ['dashboard.view'],
      });

      const request = buildRequest();
      await guard.canActivate(buildContext(request));

      expect(request.user?.branchId).toBe(BRANCH_ID);
    });

    it('does not apply a promotion to organization-wide until re-authentication', async () => {
      verifyAsync.mockResolvedValue({
        ...TOKEN_PAYLOAD,
        branchId: BRANCH_ID,
      });
      resolve.mockResolvedValue({
        status: 'ACTIVE',
        branchId: null,
        roles: ['SUPER_ADMIN'],
        permissions: ['dashboard.view'],
      });

      const request = buildRequest();
      await guard.canActivate(buildContext(request));

      expect(request.user?.branchId).toBe(BRANCH_ID);
    });

    it('leaves an organization-wide session organization-wide', async () => {
      verifyAsync.mockResolvedValue({ ...TOKEN_PAYLOAD, branchId: null });
      resolve.mockResolvedValue({
        status: 'ACTIVE',
        branchId: null,
        roles: ['SUPER_ADMIN'],
        permissions: ['dashboard.view'],
      });

      const request = buildRequest();
      await guard.canActivate(buildContext(request));

      expect(request.user?.branchId).toBeNull();
    });
  });
});
