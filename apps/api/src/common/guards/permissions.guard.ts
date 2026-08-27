import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AuthContext } from '../auth-context';
import { AuditAction, AuditService } from '../../audit/audit.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

/**
 * The matched-route shape Express's router attaches but does not declare.
 *
 * `path` is `unknown` rather than `string` because nothing type-checks what the
 * router put there; narrowing it at the read site is what keeps the value out of
 * an audit record if it is ever something else.
 */
interface RoutedRequest {
  route?: { path?: unknown };
}

/**
 * Enforces `@RequirePermissions(...)`.
 *
 * Scenario 17: a user who authenticated successfully still has no access to a
 * module their role does not grant. Authentication establishes *who* the caller
 * is; this guard decides *what* they may do.
 *
 * The permissions it checks are the ones `JwtAuthGuard` resolved from the
 * database for this request, not the ones the token was issued with. That is what
 * makes Module 03 Scenarios 31, 32 and 47 hold: a permission removed from a role
 * is refused on the very next request, and a client that hides or forges UI state
 * changes nothing about the decision.
 *
 * Every denial is recorded (Rule 39, Scenarios 40, 53). A bare 403 with no trail
 * was the gap here: services logged their own refusals, but a route the caller
 * simply lacked the permission for was refused silently.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthContext }>();

    const granted = new Set(request.user?.permissions ?? []);
    const missing = required.filter((permission) => !granted.has(permission));

    if (missing.length > 0) {
      await this.recordDenial(request, required, missing);
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }

  /**
   * Records the denial without letting the recording decide the outcome.
   *
   * The throw lives in the caller, outside this method's error handling, so a
   * failed audit write can never turn a refusal into an allow. The log line is
   * the fallback trail when the database is itself the thing that is broken.
   *
   * Skipped entirely when there is no authenticated user. `AuditLog` requires an
   * `orgId` for its composite primary key and `actorUserId` carries a composite
   * foreign key, so there is nothing valid to write — and in practice this cannot
   * happen, because `JwtAuthGuard` runs first and has already resolved a real
   * user row.
   */
  private async recordDenial(
    request: Request & { user?: AuthContext },
    required: string[],
    missing: string[],
  ): Promise<void> {
    const user = request.user;
    if (!user) return;

    try {
      await this.audit.record({
        orgId: user.orgId,
        action: AuditAction.AUTHZ_PERMISSION_DENIED,
        entityType: 'USER',
        entityId: user.userId,
        actorUserId: user.userId,
        requestId: (request as Request & { requestId?: string }).requestId,
        ipAddress: request.ip ?? null,
        userAgent: request.header('user-agent') ?? null,
        metadata: {
          // Named `requiredPermissions` / `missingPermissions` rather than
          // `required` / `missing` so the keys read unambiguously in a log
          // alongside other modules' metadata.
          requiredPermissions: required,
          missingPermissions: missing,
          method: request.method,
          // The route pattern ('/roles/:roleId') rather than the resolved path,
          // so denials aggregate per endpoint instead of per record id. Express
          // does not type `route`, hence the narrowing.
          route: this.routePattern(request),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to audit ${AuditAction.AUTHZ_PERMISSION_DENIED}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /**
   * The matched route pattern, falling back to the concrete path.
   *
   * `Request.route` is populated by Express's router but is absent from its
   * type definitions, so it is narrowed here rather than asserted at the call
   * site.
   */
  private routePattern(request: Request): string {
    const { route } = request as unknown as RoutedRequest;
    return typeof route?.path === 'string' ? route.path : request.path;
  }
}
