import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { SessionState } from '@lms/types';

import type { AccessTokenPayload, AuthContext } from '../auth-context';
import { ACCESS_COOKIE } from '../../config/auth.config';
import { AuditAction, AuditService } from '../../audit/audit.service';
import { SessionService } from '../../auth/session.service';
import {
  AuthorizationService,
  type EffectiveAuthorization,
} from '../authorization/authorization.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Maps a rejected session's derived state onto its audit action.
 *
 * ACTIVE is absent because an active session is never rejected here.
 */
const REJECTION_ACTION: Record<Exclude<SessionState, 'ACTIVE'>, string> = {
  EXPIRED: AuditAction.SESSION_REJECTED_EXPIRED,
  REVOKED: AuditAction.SESSION_REJECTED_REVOKED,
  LOGGED_OUT: AuditAction.SESSION_REJECTED_LOGGED_OUT,
};

/**
 * Global authentication guard.
 *
 * Reads the access token from an httpOnly cookie rather than an Authorization
 * header, so the token is unreachable from client-side JavaScript (Sign-In rule
 * 18 / Scenario 20). Denies by default; routes opt out with `@Public()`.
 *
 * Authentication is three checks, not one.
 *
 * The signature proves the server issued the token; it says nothing about whether
 * the session behind it still exists. Only the session lookup can answer that,
 * which is why Logout, revocation and expiry are enforced here rather than left
 * to the token's own lifetime (Active Sessions Scenarios 6, 11, 12, 13, 17, 28,
 * 29).
 *
 * And neither check says anything about whether the *account* is still active or
 * what it is still allowed to do. Module 03 added the third: authorization is
 * re-resolved from the database on every request, so deactivating a user,
 * changing their roles, or editing a role's permissions takes effect on their
 * next request rather than at their next sign-in (Rules 24, 26, 45, 49, 57;
 * Scenarios 45, 46, 47).
 *
 * Every failure path throws the same opaque message. Which of the three checks
 * refused is recorded in the audit log, where it is diagnostic, rather than in
 * the response, where it would be a hint.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthContext }>();

    const cookies = request.cookies as Record<string, string | undefined>;
    const token = cookies[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('Not authenticated');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get<string>('auth.jwtSecret'),
        /**
         * Pinned, never inferred from the token.
         *
         * Without an allow-list the library decides how to verify by reading
         * the `alg` header of the very token it is checking — which is attacker
         * input. That is the classic JWT algorithm-confusion family, and an
         * allow-list of exactly the algorithm we sign with closes it outright.
         */
        algorithms: ['HS256'],
      });
    } catch {
      // Expired or tampered — indistinguishable to the caller by design.
      throw new UnauthorizedException('Not authenticated');
    }

    await this.assertSessionActive(payload, request);

    const effective = await this.resolveAuthorization(payload, request);

    await this.assertPasswordNotBorrowed(effective, payload, request);

    // Scope comes from the verified token, never from the request body or
    // query. That is what stops a client submitting another organization or
    // branch and having it honoured (Scenarios 21, 22, 27).
    //
    // Roles and permissions come from the database, never from the token, which
    // is what makes Scenarios 33, 44, 46 and 47 structural: a permission revoked
    // a second ago is refused now, not at the next sign-in.
    //
    // The token no longer carries the permission list at all. It once did — for
    // rolling-deploy compatibility rather than for reading — and serialising a
    // Super Admin's full catalog pushed `Set-Cookie` past the 4,096-byte
    // per-cookie limit, which browsers enforce by discarding the cookie in
    // silence. See `AccessTokenPayload` for the whole story.
    request.user = {
      userId: payload.sub,
      orgId: payload.orgId,
      orgCode: payload.orgCode,
      sessionId: payload.sid,
      branchId: this.narrowerBranch(effective.branchId, payload.branchId),
      roles: effective.roles,
      permissions: effective.permissions,
    };

    return true;
  }

  /**
   * Confines an account still using a password someone else chose.
   *
   * An administrator may set a new account's first password, which means that
   * password is known to two people until the user replaces it. This is what
   * makes that window narrow: the account signs in normally and then reaches
   * nothing but the screen that ends the window.
   *
   * Enforced here rather than only in the browser because a redirect in the web
   * app is a convenience, not a control — the API is reachable directly, and a
   * borrowed credential that could drive it would make the whole flag
   * decorative.
   *
   * The allowlist is deliberately minimal, and every entry earns its place:
   * change-password is the way out, `me` is what the client reads to know it
   * must go there, and sign-out must always work — an account that could not
   * even end its own session would be trapped rather than confined.
   */
  private async assertPasswordNotBorrowed(
    effective: { mustChangePassword: boolean },
    payload: AccessTokenPayload,
    request: Request,
  ): Promise<void> {
    if (!effective.mustChangePassword) return;

    // Matched on the route path rather than the handler, so a new controller
    // cannot join the allowlist by accident.
    //
    // `?? ''` fails closed: a request whose path cannot be read matches nothing
    // in the allowlist and is refused, rather than throwing on `.replace` and
    // surfacing as a 500 that says nothing about why.
    const path = (request.path ?? '').replace(/\/+$/, '');
    const allowed =
      path.endsWith('/auth/change-password') ||
      path.endsWith('/auth/me') ||
      path.endsWith('/auth/sign-out');

    if (allowed) return;

    await this.tryAudit({
      orgId: payload.orgId,
      action: AuditAction.AUTHZ_DENIED_PASSWORD_CHANGE_REQUIRED,
      entityType: 'USER',
      entityId: payload.sub,
      actorUserId: payload.sub,
      request,
      metadata: { path },
    });

    // 403 rather than 401: the caller is authenticated, and telling them so is
    // the point — a 401 would send a browser back to sign in, which would
    // succeed and land them here again.
    throw new ForbiddenException(
      'Your password was set by an administrator and must be changed before you can continue.',
    );
  }

  /**
   * The branch scope to enforce, given what the database says now and what the
   * token said at sign-in.
   *
   * Two rules pull in opposite directions here, and the resolution is to take
   * whichever is narrower.
   *
   * Rule 50 and Scenario 43 say a branch reassignment must not widen a session
   * already in flight — `UserSession.branchId` exists precisely to record the
   * scope captured at sign-in. Rules 3, 5 and 33 say branch scope is an
   * authorization boundary that must reflect current state. So: a database value
   * that confines the user to a branch is honoured immediately, because it can
   * only tighten or move sideways; a database value of `null`, meaning the user
   * has been promoted to organization-wide, falls back to the token's branch and
   * takes effect only at their next sign-in.
   *
   * This is not the same as `effective.branchId`, and it should not be
   * "simplified" to it — that would let a promotion widen a live session.
   */
  private narrowerBranch(
    current: string | null,
    atSignIn: string | null,
  ): string | null {
    return current ?? atSignIn ?? null;
  }

  /**
   * Rejects unless the account is still ACTIVE, and returns what it may now do.
   *
   * This is what makes a deactivation effective immediately. A user with a valid
   * token and a live session row is still refused the moment their account stops
   * being ACTIVE — including LOCKED, SUSPENDED and PENDING, none of which may
   * carry authorization (Scenarios 9, 45).
   */
  private async resolveAuthorization(
    payload: AccessTokenPayload,
    request: Request,
  ): Promise<EffectiveAuthorization> {
    const denied = new UnauthorizedException('Not authenticated');

    let effective: EffectiveAuthorization | null;

    try {
      effective = await this.authorization.resolve(payload.orgId, payload.sub);
    } catch (error) {
      // Fail closed (Rule 55, Scenario 61). An authorization subsystem that
      // cannot be read is a reason to deny every protected request, never to
      // wave one through on the token's stale claims.
      this.logger.error(
        `Authorization unavailable while validating a request: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      await this.tryAudit({
        orgId: payload.orgId,
        action: AuditAction.AUTHZ_RESOLUTION_FAILED,
        entityType: 'USER',
        entityId: payload.sub,
        actorUserId: payload.sub,
        request,
      });
      throw denied;
    }

    if (!effective) {
      await this.tryAudit({
        orgId: payload.orgId,
        action: AuditAction.AUTHZ_USER_MISSING,
        entityType: 'USER',
        entityId: payload.sub,
        // The user row is gone, and actorUserId carries a composite FK to it —
        // recording the reference would be rejected by the database.
        actorUserId: null,
        request,
      });
      throw denied;
    }

    if (effective.status !== 'ACTIVE') {
      await this.tryAudit({
        orgId: payload.orgId,
        action: AuditAction.AUTHZ_DENIED_ACCOUNT_STATUS,
        entityType: 'USER',
        entityId: payload.sub,
        actorUserId: payload.sub,
        request,
        metadata: { status: effective.status },
      });
      throw denied;
    }

    return effective;
  }

  /**
   * Rejects unless the session row is still ACTIVE.
   *
   * Every failure path throws the same opaque message the signature check uses:
   * whether a session expired, was revoked, or never existed is not something
   * the caller is entitled to learn. The distinction is recorded in the audit
   * log, where it is useful, rather than in the response, where it is a hint.
   */
  private async assertSessionActive(
    payload: AccessTokenPayload,
    request: Request,
  ): Promise<void> {
    const denied = new UnauthorizedException('Not authenticated');

    let validation: Awaited<
      ReturnType<SessionService['validateForRequest']>
    > | null;

    try {
      validation = await this.sessions.validateForRequest(
        payload.orgId,
        payload.sid,
      );
    } catch (error) {
      // Fail closed (Scenario 36). A session store that cannot be read is a
      // reason to deny every protected request, never to wave them through.
      this.logger.error(
        `Session store unavailable while validating a request: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      await this.tryAudit({
        orgId: payload.orgId,
        action: AuditAction.SESSION_STORE_UNAVAILABLE,
        entityType: 'USER_SESSION',
        entityId: payload.sid,
        actorUserId: payload.sub,
        request,
      });
      throw denied;
    }

    if (!validation) {
      await this.tryAudit({
        orgId: payload.orgId,
        action: AuditAction.SESSION_REJECTED_UNKNOWN,
        entityType: 'USER_SESSION',
        entityId: payload.sid,
        // No session row means the user reference is unverified, so it is not
        // recorded as an actor — the composite FK would reject it anyway.
        actorUserId: null,
        request,
      });
      throw denied;
    }

    if (validation.state !== 'ACTIVE') {
      await this.tryAudit({
        orgId: payload.orgId,
        action: REJECTION_ACTION[validation.state],
        entityType: 'USER_SESSION',
        entityId: payload.sid,
        actorUserId: validation.userId,
        request,
      });
      throw denied;
    }
  }

  /**
   * Records a denial without letting the recording decide the outcome.
   *
   * A failed audit write must never turn a rejection into an allow, so this
   * swallows its own errors and the caller throws regardless. The log line is
   * the fallback trail when the database itself is the thing that is broken.
   */
  private async tryAudit(input: {
    orgId: string;
    action: string;
    /** 'USER_SESSION' for a session rejection, 'USER' for an authorization one. */
    entityType: string;
    entityId: string | null;
    actorUserId: string | null;
    request: Request;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.audit.record({
        orgId: input.orgId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        actorUserId: input.actorUserId,
        requestId: (input.request as Request & { requestId?: string })
          .requestId,
        ipAddress: input.request.ip ?? null,
        userAgent: input.request.header('user-agent') ?? null,
        metadata: input.metadata,
      });
    } catch (error) {
      this.logger.error(
        `Failed to audit ${input.action}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
