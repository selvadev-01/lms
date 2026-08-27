import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';

import { AuditAction, AuditService } from '../../audit/audit.service';
import {
  MAINTENANCE_MODE_MANAGE_PERMISSION,
  MAINTENANCE_STATE_TTL_MS,
  MaintenanceModeService,
  type MaintenanceState,
} from '../../maintenance/maintenance-mode.service';
import type { AuthContext } from '../auth-context';

/** Route prefixes that stay reachable so a locked-out operator can recover. */
const ALWAYS_ALLOWED_PREFIXES = ['/auth', '/maintenance/mode', '/health'];

const DEFAULT_MESSAGE =
  'The system is temporarily unavailable for maintenance. Please try again shortly.';

/**
 * Refuse mutations while maintenance mode is on (Scenarios 32-35, Rules 77-79).
 *
 * # Registration order is the security property
 *
 * This guard is registered LAST in `app.module.ts`, after `JwtAuthGuard` and
 * `PermissionsGuard`. Nest applies global guards in registration order, so by
 * the time this runs the caller has already been authenticated and authorized.
 *
 * That ordering is what makes Rule 78 and Scenario 33 structural rather than a
 * check somebody has to remember: maintenance mode can only ever SUBTRACT
 * access. A caller lacking a permission gets 403 from the guard before this one
 * — never 503 — so enabling maintenance can never turn a denial into a
 * different-looking refusal, and `allowedPermissions` can never grant anything.
 *
 * Moving this line up in the providers array looks cosmetic and is not.
 * `maintenance-mode.guard.spec.ts` asserts the 403-before-503 ordering.
 *
 * # Reads stay open
 *
 * Only mutations are blocked. A maintenance window is for stopping writes; a
 * user who can still see why the system is quiet files fewer support tickets.
 *
 * # The cache is 60 seconds of deliberate staleness
 *
 * A database read per request is not acceptable on a guard that runs on every
 * request. The cost is that enabling or disabling takes up to a minute to reach
 * every replica, which is documented here because the obvious "fix" — dropping
 * the cache — adds a round trip to every authenticated call in the system.
 */
@Injectable()
export class MaintenanceModeGuard implements CanActivate {
  private cache = new Map<
    string,
    { state: MaintenanceState; expiresAt: number }
  >();

  constructor(
    private readonly maintenance: MaintenanceModeService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthContext }>();

    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }

    const actor = request.user;
    // Unauthenticated requests never reach here in practice — JwtAuthGuard has
    // already refused them. If one does, it is not this guard's refusal to make.
    if (!actor) return true;

    const path = this.pathOf(request);
    if (ALWAYS_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return true;
    }

    // Whoever can turn maintenance off must be able to act while it is on.
    if (actor.permissions.includes(MAINTENANCE_MODE_MANAGE_PERMISSION)) {
      return true;
    }

    const state = await this.stateFor(actor.orgId);

    // The branch row wins where it exists; otherwise the organization row
    // applies. A branch row does not imply an organization one (Scenario 34).
    const applicable =
      (actor.branchId ? state.branches.get(actor.branchId) : undefined) ??
      state.orgWide;

    if (!applicable?.enabled) return true;

    // An allow-list entry lets an already-authorized caller continue. It never
    // grants the permission — PermissionsGuard has already run.
    if (
      applicable.allowedPermissions.some((permission) =>
        actor.permissions.includes(permission),
      )
    ) {
      return true;
    }

    await this.audit
      .record({
        orgId: actor.orgId,
        branchId: actor.branchId,
        actorUserId: actor.userId,
        action: AuditAction.MAINTENANCE_MODE_BLOCKED_OPERATION,
        entityType: 'maintenance_mode',
        metadata: { method, path },
      })
      .catch(() => undefined);

    // An explicit, controlled refusal rather than a generic error (Rule 79).
    throw new ServiceUnavailableException(
      applicable.userMessage ?? DEFAULT_MESSAGE,
    );
  }

  /** Clears the cache — for tests and for an immediate effect after a toggle. */
  invalidate(orgId?: string): void {
    if (orgId) this.cache.delete(orgId);
    else this.cache.clear();
  }

  private async stateFor(orgId: string): Promise<MaintenanceState> {
    const cached = this.cache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) return cached.state;

    const state = await this.maintenance.resolveState(orgId);
    this.cache.set(orgId, {
      state,
      expiresAt: Date.now() + MAINTENANCE_STATE_TTL_MS,
    });
    return state;
  }

  private pathOf(request: Request): string {
    const raw = request.path ?? request.url ?? '';
    // Strip the global prefix so the allow-list reads as route paths.
    return raw.replace(/^\/api\/v\d+/, '');
  }
}
