import { ForbiddenException } from '@nestjs/common';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import type { RequestMeta } from './auth.service';
import { SessionManagementService } from './session-management.service';
import { SESSION_REVOKE_REASON } from './session-state';
import { SessionService } from './session.service';

/**
 * Active Sessions — viewing and revoking.
 *
 * Covers Scenarios 1, 3, 7, 15, 21, 22, 23, 24, 33, 34 and 44. The scope tests
 * matter most: they are the ones that fail loudly if a where clause is ever
 * relaxed.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TARGET_USER_ID = '77777777-7777-7777-7777-777777777777';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const TARGET_SESSION_ID = '44444444-4444-4444-4444-444444444444';
const BRANCH_A = '55555555-5555-5555-5555-555555555555';
const BRANCH_B = '66666666-6666-6666-6666-666666666666';

const META: RequestMeta = {
  requestId: '88888888-8888-8888-8888-888888888888',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

function authContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: SESSION_ID,
    branchId: BRANCH_A,
    roles: ['BRANCH_ADMIN'],
    permissions: ['sessions.revoke'],
    ...overrides,
  };
}

/** A Super Admin is organization-wide: no branch, so no branch confinement. */
function superAdminContext(): AuthContext {
  return authContext({ branchId: null, roles: ['SUPER_ADMIN'] });
}

describe('SessionManagementService', () => {
  let listForUser: jest.Mock;
  let revokeOwnedSession: jest.Mock;
  let revokeAllExcept: jest.Mock;
  let findForAdmin: jest.Mock;
  let record: jest.Mock;
  let service: SessionManagementService;

  beforeEach(() => {
    listForUser = jest.fn().mockResolvedValue([]);
    revokeOwnedSession = jest.fn().mockResolvedValue(1);
    revokeAllExcept = jest.fn().mockResolvedValue(2);
    findForAdmin = jest.fn().mockResolvedValue({
      sessionId: TARGET_SESSION_ID,
      userId: TARGET_USER_ID,
      branchId: BRANCH_A,
    });
    record = jest.fn().mockResolvedValue(undefined);

    const sessions = {
      listForUser,
      revokeOwnedSession,
      revokeAllExcept,
      findForAdmin,
    } as unknown as SessionService;
    const audit = { record } as unknown as AuditService;

    service = new SessionManagementService(sessions, audit);
  });

  function auditedActions(): string[] {
    const calls = record.mock.calls as Array<[{ action: string }]>;
    return calls.map(([input]) => input.action);
  }

  describe('Scenario 1: viewing the current session', () => {
    it('lists only the caller’s own sessions, scoped by their session context', async () => {
      await service.listOwnSessions(authContext(), META);

      expect(listForUser).toHaveBeenCalledWith(ORG_ID, USER_ID, SESSION_ID);
    });

    it('audits the access', async () => {
      await service.listOwnSessions(authContext(), META);

      expect(auditedActions()).toContain(AuditAction.SESSION_VIEWED);
    });

    it('Scenario 3: takes no scope parameter, so viewing cannot widen scope', async () => {
      // The signature accepts only an AuthContext: there is no argument a
      // handler could fill from request input to reach another org or branch.
      await service.listOwnSessions(authContext({ branchId: BRANCH_A }), META);

      const [orgId, userId] = listForUser.mock.calls[0] as string[];
      expect(orgId).toBe(ORG_ID);
      expect(userId).toBe(USER_ID);
    });
  });

  describe('revoking your own session', () => {
    it('records USER_LOGOUT when the caller ends their current session', async () => {
      const result = await service.revokeOwnSession(
        authContext(),
        SESSION_ID,
        META,
      );

      expect(revokeOwnedSession).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        SESSION_ID,
        SESSION_REVOKE_REASON.USER_LOGOUT,
      );
      expect(result.currentSessionRevoked).toBe(true);
    });

    it('records USER_REVOKED when ending another of the caller’s devices', async () => {
      const result = await service.revokeOwnSession(
        authContext(),
        TARGET_SESSION_ID,
        META,
      );

      expect(revokeOwnedSession).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        TARGET_SESSION_ID,
        SESSION_REVOKE_REASON.USER_REVOKED,
      );
      expect(result.currentSessionRevoked).toBe(false);
    });

    it('Scenario 7: reports success without reactivating an already-ended session', async () => {
      revokeOwnedSession.mockResolvedValue(0);

      const result = await service.revokeOwnSession(
        authContext(),
        TARGET_SESSION_ID,
        META,
      );

      expect(result.revokedCount).toBe(0);
      expect(result.currentSessionRevoked).toBe(false);
    });

    it('audits a no-op as such, never as a termination that did not happen', async () => {
      revokeOwnedSession.mockResolvedValue(0);

      await service.revokeOwnSession(authContext(), TARGET_SESSION_ID, META);

      expect(auditedActions()).toEqual([AuditAction.SESSION_REVOKE_NOOP]);
    });

    it('audits ending the current session as a logout', async () => {
      await service.revokeOwnSession(authContext(), SESSION_ID, META);

      expect(auditedActions()).toEqual([AuditAction.LOGOUT]);
    });

    it('Scenario 24: passes the caller’s own userId, so another user’s session is unreachable', async () => {
      await service.revokeOwnSession(authContext(), TARGET_SESSION_ID, META);

      const [, userId] = revokeOwnedSession.mock.calls[0] as string[];
      expect(userId).toBe(USER_ID);
    });
  });

  describe('sign out everywhere else', () => {
    it('spares the current session', async () => {
      const result = await service.revokeAllOtherSessions(authContext(), META);

      expect(revokeAllExcept).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        SESSION_ID,
        SESSION_REVOKE_REASON.USER_REVOKED,
      );
      expect(result.currentSessionRevoked).toBe(false);
      expect(result.revokedCount).toBe(2);
    });

    it('audits how many sessions were ended', async () => {
      await service.revokeAllOtherSessions(authContext(), META);

      const [input] = record.mock.calls[0] as [
        { action: string; metadata?: Record<string, unknown> },
      ];
      expect(input.action).toBe(AuditAction.SESSION_REVOKED_ALL);
      expect(input.metadata?.revokedCount).toBe(2);
    });
  });

  describe('Scenario 23: administrative revocation', () => {
    it('revokes a session in the administrator’s own branch', async () => {
      const result = await service.revokeUserSession(
        authContext(),
        TARGET_USER_ID,
        TARGET_SESSION_ID,
        META,
      );

      expect(revokeOwnedSession).toHaveBeenCalledWith(
        ORG_ID,
        TARGET_USER_ID,
        TARGET_SESSION_ID,
        SESSION_REVOKE_REASON.ADMIN_REVOKED,
      );
      expect(result.revokedCount).toBe(1);
    });

    it('lets a Super Admin reach any branch in their organization', async () => {
      findForAdmin.mockResolvedValue({
        sessionId: TARGET_SESSION_ID,
        userId: TARGET_USER_ID,
        branchId: BRANCH_B,
      });

      await expect(
        service.revokeUserSession(
          superAdminContext(),
          TARGET_USER_ID,
          TARGET_SESSION_ID,
          META,
        ),
      ).resolves.toEqual({ revokedCount: 1, currentSessionRevoked: false });
    });

    it('Scenario 21: refuses a Branch Admin reaching into another branch', async () => {
      findForAdmin.mockResolvedValue({
        sessionId: TARGET_SESSION_ID,
        userId: TARGET_USER_ID,
        branchId: BRANCH_B,
      });

      await expect(
        service.revokeUserSession(
          authContext({ branchId: BRANCH_A }),
          TARGET_USER_ID,
          TARGET_SESSION_ID,
          META,
        ),
      ).rejects.toThrow(ForbiddenException);

      // Scenario 23: the target session remains unchanged.
      expect(revokeOwnedSession).not.toHaveBeenCalled();
    });

    it('Scenario 22: cannot reach a session in another organization', async () => {
      // findForAdmin is keyed on the caller's orgId, so a cross-tenant target
      // is simply not found.
      findForAdmin.mockResolvedValue(null);

      await expect(
        service.revokeUserSession(
          authContext({ orgId: OTHER_ORG_ID }),
          TARGET_USER_ID,
          TARGET_SESSION_ID,
          META,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(revokeOwnedSession).not.toHaveBeenCalled();
    });

    it('refuses when the session belongs to a different user than the URL claims', async () => {
      findForAdmin.mockResolvedValue({
        sessionId: TARGET_SESSION_ID,
        userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        branchId: BRANCH_A,
      });

      await expect(
        service.revokeUserSession(
          authContext(),
          TARGET_USER_ID,
          TARGET_SESSION_ID,
          META,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('reports an unknown session identically to an out-of-scope one', async () => {
      findForAdmin.mockResolvedValue(null);
      const unknown = service.revokeUserSession(
        authContext(),
        TARGET_USER_ID,
        TARGET_SESSION_ID,
        META,
      );
      await expect(unknown).rejects.toThrow('Session cannot be revoked');

      findForAdmin.mockResolvedValue({
        sessionId: TARGET_SESSION_ID,
        userId: TARGET_USER_ID,
        branchId: BRANCH_B,
      });
      const outOfScope = service.revokeUserSession(
        authContext({ branchId: BRANCH_A }),
        TARGET_USER_ID,
        TARGET_SESSION_ID,
        META,
      );
      // Identical message, so the endpoint cannot confirm which ids exist.
      await expect(outOfScope).rejects.toThrow('Session cannot be revoked');
    });
  });

  describe('Scenario 44: permission denial is audit logged', () => {
    it('audits a denial and leaves the target unchanged', async () => {
      findForAdmin.mockResolvedValue({
        sessionId: TARGET_SESSION_ID,
        userId: TARGET_USER_ID,
        branchId: BRANCH_B,
      });

      await expect(
        service.revokeUserSession(
          authContext({ branchId: BRANCH_A }),
          TARGET_USER_ID,
          TARGET_SESSION_ID,
          META,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(auditedActions()).toEqual([AuditAction.SESSION_REVOKE_DENIED]);
      expect(revokeOwnedSession).not.toHaveBeenCalled();
    });
  });

  describe('Scenarios 15, 33 and 34: session actions touch nothing but the session', () => {
    /**
     * SessionService is the only collaborator that can write, and its whole
     * surface here is session revocation. There is no path from these methods
     * to a user, role, ledger or payment write — asserted by construction
     * rather than by inspecting a fake database.
     */
    it('never writes anything but session revocations', async () => {
      await service.revokeOwnSession(authContext(), TARGET_SESSION_ID, META);
      await service.revokeAllOtherSessions(authContext(), META);
      await service.revokeUserSession(
        authContext(),
        TARGET_USER_ID,
        TARGET_SESSION_ID,
        META,
      );

      const writeCalls =
        revokeOwnedSession.mock.calls.length +
        revokeAllExcept.mock.calls.length;
      expect(writeCalls).toBe(3);
    });

    it('audits every terminal action, so session changes are traceable', async () => {
      await service.revokeOwnSession(authContext(), TARGET_SESSION_ID, META);

      expect(auditedActions()).toContain(AuditAction.SESSION_REVOKED);
    });

    it('never records a token or hash in audit metadata', async () => {
      await service.revokeOwnSession(authContext(), TARGET_SESSION_ID, META);

      const [input] = record.mock.calls[0] as [Record<string, unknown>];
      const serialized = JSON.stringify(input).toLowerCase();
      expect(serialized).not.toContain('refreshtoken');
      expect(serialized).not.toContain('hash');
    });
  });
});
