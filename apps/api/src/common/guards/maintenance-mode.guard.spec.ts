import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type {
  MaintenanceModeService,
  MaintenanceState,
} from '../../maintenance/maintenance-mode.service';
import type { AuthContext } from '../auth-context';
import { MaintenanceModeGuard } from './maintenance-mode.guard';

/**
 * Module 17 — maintenance mode enforcement.
 *
 * The property this file exists to protect is ORDERING, and it is easy to break
 * by accident. `MaintenanceModeGuard` is registered last in `app.module.ts`, so
 * `PermissionsGuard` has already refused an unauthorized caller by the time this
 * runs. Moving it up the providers array looks cosmetic and would let
 * maintenance mode short-circuit authorization — violating Rule 78 and making
 * Scenario 33 false.
 *
 * That ordering cannot be asserted from inside a unit test of one guard, so this
 * file asserts the two things that follow from it and would break with it:
 *
 *  * the guard NEVER inspects whether the caller may perform the action, only
 *    whether maintenance is on; and
 *  * `allowedPermissions` is consulted only to EXEMPT an already-authorized
 *    caller, never to grant.
 *
 * A separate assertion pins the registration position itself.
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const BRANCH_A = '44444444-4444-4444-4444-444444444444';
const BRANCH_B = '55555555-5555-5555-5555-555555555555';

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    orgCode: 'DEMO',
    sessionId: 'session',
    branchId: null,
    roles: ['BRANCH_ADMIN'],
    permissions: ['settings.view'],
    ...overrides,
  };
}

function contextFor(
  method: string,
  path: string,
  user?: AuthContext,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, path, url: path, user }),
    }),
  } as unknown as ExecutionContext;
}

function stateWith(
  overrides: Partial<MaintenanceState> = {},
): MaintenanceState {
  return { orgWide: null, branches: new Map(), ...overrides };
}

function harness(state: MaintenanceState = stateWith()) {
  const maintenance = { resolveState: jest.fn().mockResolvedValue(state) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const guard = new MaintenanceModeGuard(
    maintenance as unknown as MaintenanceModeService,
    audit as unknown as AuditService,
  );

  return { guard, maintenance, audit };
}

const ENABLED = {
  enabled: true,
  userMessage: 'Back at 6pm.',
  allowedPermissions: [] as string[],
};

describe('MaintenanceModeGuard', () => {
  describe('it can only subtract access (Rule 78, Scenario 33)', () => {
    it('never inspects what the caller is authorized to do', async () => {
      const { guard } = harness(stateWith({ orgWide: ENABLED }));

      // A caller with NO permissions and one with many are refused identically:
      // this guard has no opinion about authorization, which is what keeps a
      // 403 a 403 rather than becoming a 503.
      const withNone = guard.canActivate(
        contextFor('POST', '/settings', actor({ permissions: [] })),
      );
      guard.invalidate();
      const withMany = guard.canActivate(
        contextFor(
          'POST',
          '/settings',
          actor({ permissions: ['settings.manage', 'settings.view'] }),
        ),
      );

      await expect(withNone).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(withMany).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('treats allowedPermissions as an exemption, not a grant', async () => {
      const { guard } = harness(
        stateWith({
          orgWide: { ...ENABLED, allowedPermissions: ['collections.record'] },
        }),
      );

      // The caller already holds it — PermissionsGuard let them through — so the
      // exemption applies.
      await expect(
        guard.canActivate(
          contextFor(
            'POST',
            '/collections',
            actor({ permissions: ['collections.record'] }),
          ),
        ),
      ).resolves.toBe(true);

      guard.invalidate();

      // A caller who does NOT hold it is refused here too. The allow-list did
      // not give it to them; only PermissionsGuard could have.
      await expect(
        guard.canActivate(
          contextFor('POST', '/collections', actor({ permissions: [] })),
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('is registered after PermissionsGuard in AppModule', async () => {
      // The ordering itself. A unit test cannot observe Nest's guard pipeline,
      // so this reads the registration and asserts the position — the thing a
      // careless reorder would change.
      const source = await import('node:fs').then((fs) =>
        fs.readFileSync(require.resolve('../../app.module.ts'), 'utf8'),
      );

      const permissionsAt = source.indexOf('useClass: PermissionsGuard');
      const maintenanceAt = source.indexOf('useClass: MaintenanceModeGuard');

      expect(permissionsAt).toBeGreaterThan(-1);
      expect(maintenanceAt).toBeGreaterThan(-1);
      expect(maintenanceAt).toBeGreaterThan(permissionsAt);
    });
  });

  describe('what it blocks', () => {
    it('blocks a mutation with the configured message (Rule 79)', async () => {
      const { guard } = harness(stateWith({ orgWide: ENABLED }));

      await expect(
        guard.canActivate(contextFor('POST', '/settings', actor())),
      ).rejects.toThrow('Back at 6pm.');
    });

    it('falls back to a default message when none is configured', async () => {
      const { guard } = harness(
        stateWith({ orgWide: { ...ENABLED, userMessage: null } }),
      );

      await expect(
        guard.canActivate(contextFor('POST', '/settings', actor())),
      ).rejects.toThrow(/temporarily unavailable/i);
    });

    it('leaves reads open', async () => {
      const { guard } = harness(stateWith({ orgWide: ENABLED }));

      await expect(
        guard.canActivate(contextFor('GET', '/settings', actor())),
      ).resolves.toBe(true);
    });

    it('keeps auth and the mode endpoint reachable', async () => {
      const { guard } = harness(stateWith({ orgWide: ENABLED }));

      await expect(
        guard.canActivate(contextFor('POST', '/auth/sign-in', actor())),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(contextFor('POST', '/maintenance/mode', actor())),
      ).resolves.toBe(true);
    });

    it('lets whoever can disable it keep working', async () => {
      const { guard } = harness(stateWith({ orgWide: ENABLED }));

      // Otherwise enabling maintenance would lock out the only people who can
      // turn it off.
      await expect(
        guard.canActivate(
          contextFor(
            'POST',
            '/settings',
            actor({ permissions: ['maintenance.mode.manage'] }),
          ),
        ),
      ).resolves.toBe(true);
    });

    it('allows everything when maintenance is off', async () => {
      const { guard } = harness();

      await expect(
        guard.canActivate(contextFor('POST', '/settings', actor())),
      ).resolves.toBe(true);
    });

    it('audits the blocked operation', async () => {
      const { guard, audit } = harness(stateWith({ orgWide: ENABLED }));

      await guard
        .canActivate(contextFor('POST', '/settings', actor()))
        .catch(() => undefined);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.MAINTENANCE_MODE_BLOCKED_OPERATION,
        }),
      );
    });

    it('strips the api prefix before matching the allow-list', async () => {
      const { guard } = harness(stateWith({ orgWide: ENABLED }));

      await expect(
        guard.canActivate(contextFor('POST', '/api/v1/auth/sign-in', actor())),
      ).resolves.toBe(true);
    });
  });

  describe('branch scoping (Scenario 34)', () => {
    it('blocks only the branch it was enabled for', async () => {
      const branches = new Map([[BRANCH_A, ENABLED]]);
      const { guard } = harness(stateWith({ branches }));

      await expect(
        guard.canActivate(
          contextFor('POST', '/settings', actor({ branchId: BRANCH_A })),
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      guard.invalidate();

      // Branch B is governed by its own state, which is not enabled.
      await expect(
        guard.canActivate(
          contextFor('POST', '/settings', actor({ branchId: BRANCH_B })),
        ),
      ).resolves.toBe(true);
    });

    it('applies the organization row to a branch with no row of its own', async () => {
      const { guard } = harness(stateWith({ orgWide: ENABLED }));

      await expect(
        guard.canActivate(
          contextFor('POST', '/settings', actor({ branchId: BRANCH_B })),
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('prefers the branch row over the organization one', async () => {
      // Org-wide is on, but this branch is explicitly configured and not
      // enabled — the narrower row wins.
      const branches = new Map([
        [
          BRANCH_A,
          { enabled: false, userMessage: null, allowedPermissions: [] },
        ],
      ]);
      const { guard } = harness(stateWith({ orgWide: ENABLED, branches }));

      await expect(
        guard.canActivate(
          contextFor('POST', '/settings', actor({ branchId: BRANCH_A })),
        ),
      ).resolves.toBe(true);
    });
  });

  describe('caching', () => {
    it('reads the state once per organization within the TTL', async () => {
      const { guard, maintenance } = harness();

      await guard.canActivate(contextFor('POST', '/settings', actor()));
      await guard.canActivate(contextFor('POST', '/settings', actor()));

      expect(maintenance.resolveState).toHaveBeenCalledTimes(1);
    });

    it('re-reads after invalidation', async () => {
      const { guard, maintenance } = harness();

      await guard.canActivate(contextFor('POST', '/settings', actor()));
      guard.invalidate();
      await guard.canActivate(contextFor('POST', '/settings', actor()));

      expect(maintenance.resolveState).toHaveBeenCalledTimes(2);
    });

    it('does not query at all for a read', async () => {
      const { guard, maintenance } = harness();

      await guard.canActivate(contextFor('GET', '/settings', actor()));

      expect(maintenance.resolveState).not.toHaveBeenCalled();
    });
  });
});
