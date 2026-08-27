import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { AuthContext } from '../auth-context';
import { PermissionsGuard } from './permissions.guard';

/**
 * PermissionsGuard — the point at which a permission a role does not grant
 * becomes a refusal, and the point at which that refusal becomes a record.
 *
 * The audit half is Module 03 Rule 39 ("permission-denied attempts must be audit
 * logged") and Scenarios 40 and 53. Before it, services logged their own
 * refusals but a route the caller simply lacked the permission for was refused
 * silently — the most common denial in the system left no trail at all.
 *
 * The load-bearing case is the last one: a failed audit write must not turn a
 * refusal into an allow. Getting that wrong would mean a database problem
 * silently opens every guarded route.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const REQUEST_ID = '33333333-3333-3333-3333-333333333333';

function authContext(permissions: string[]): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: '44444444-4444-4444-4444-444444444444',
    branchId: null,
    roles: ['BRANCH_ADMIN'],
    permissions,
  };
}

function buildContext(user?: AuthContext): ExecutionContext {
  const request = {
    user,
    method: 'POST',
    path: '/api/v1/roles',
    route: { path: '/roles' },
    ip: '203.0.113.7',
    requestId: REQUEST_ID,
    header: () => 'jest-agent',
  };

  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let record: jest.Mock;
  let required: string[] | undefined;
  let guard: PermissionsGuard;

  beforeEach(() => {
    record = jest.fn().mockResolvedValue(undefined);
    required = undefined;

    const reflector = {
      getAllAndOverride: () => required,
    } as unknown as Reflector;
    const audit = { record } as unknown as AuditService;

    guard = new PermissionsGuard(reflector, audit);
  });

  describe('routes with no permission requirement', () => {
    it('admits the request', async () => {
      await expect(
        guard.canActivate(buildContext(authContext([]))),
      ).resolves.toBe(true);
    });

    it('writes no audit record — a permitted request is not an event here', async () => {
      await guard.canActivate(buildContext(authContext([])));

      expect(record).not.toHaveBeenCalled();
    });

    it('admits when the metadata is an empty array', async () => {
      required = [];

      await expect(
        guard.canActivate(buildContext(authContext([]))),
      ).resolves.toBe(true);
    });
  });

  describe('when the caller holds what the route requires', () => {
    it('admits and records nothing', async () => {
      required = ['roles.view'];

      await expect(
        guard.canActivate(buildContext(authContext(['roles.view']))),
      ).resolves.toBe(true);
      expect(record).not.toHaveBeenCalled();
    });

    it('requires all of several permissions, not any', async () => {
      required = ['roles.view', 'roles.update'];

      await expect(
        guard.canActivate(buildContext(authContext(['roles.view']))),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Rule 39: a denial is recorded', () => {
    it('refuses with an opaque message', async () => {
      required = ['roles.create'];

      await expect(
        guard.canActivate(buildContext(authContext(['roles.view']))),
      ).rejects.toThrow('Insufficient permissions');
    });

    it('records the action, the actor and the tenant', async () => {
      required = ['roles.create'];

      await expect(
        guard.canActivate(buildContext(authContext(['roles.view']))),
      ).rejects.toThrow(ForbiddenException);

      const [input] = record.mock.calls[0] as [Record<string, unknown>];
      expect(input.action).toBe(AuditAction.AUTHZ_PERMISSION_DENIED);
      expect(input.orgId).toBe(ORG_ID);
      expect(input.actorUserId).toBe(USER_ID);
      expect(input.entityType).toBe('USER');
      expect(input.entityId).toBe(USER_ID);
    });

    it('records what was required and what was missing', async () => {
      required = ['roles.create', 'roles.assign_permissions'];

      await expect(
        guard.canActivate(buildContext(authContext(['roles.create']))),
      ).rejects.toThrow(ForbiddenException);

      const [input] = record.mock.calls[0] as [
        {
          metadata: {
            requiredPermissions: string[];
            missingPermissions: string[];
            method: string;
            route: string;
          };
        },
      ];
      expect(input.metadata.requiredPermissions).toEqual([
        'roles.create',
        'roles.assign_permissions',
      ]);
      // Only the ones actually absent, so the log says what to grant.
      expect(input.metadata.missingPermissions).toEqual([
        'roles.assign_permissions',
      ]);
      expect(input.metadata.method).toBe('POST');
      expect(input.metadata.route).toBe('/roles');
    });

    it('carries the request id, ip and user agent for correlation', async () => {
      required = ['roles.create'];

      await expect(
        guard.canActivate(buildContext(authContext([]))),
      ).rejects.toThrow(ForbiddenException);

      const [input] = record.mock.calls[0] as [Record<string, unknown>];
      expect(input.requestId).toBe(REQUEST_ID);
      expect(input.ipAddress).toBe('203.0.113.7');
      expect(input.userAgent).toBe('jest-agent');
    });

    it('still refuses when the audit write fails', async () => {
      // The load-bearing case. A broken audit store must not open the route.
      required = ['roles.create'];
      record.mockRejectedValue(new Error('audit store down'));

      await expect(
        guard.canActivate(buildContext(authContext([]))),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses without an audit attempt when there is no authenticated user', async () => {
      // Unreachable in practice — JwtAuthGuard runs first — but AuditLog needs an
      // orgId for its composite key, so there would be nothing valid to write.
      required = ['roles.create'];

      await expect(guard.canActivate(buildContext(undefined))).rejects.toThrow(
        ForbiddenException,
      );
      expect(record).not.toHaveBeenCalled();
    });
  });
});
