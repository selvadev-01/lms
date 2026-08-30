import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type {
  AuthUser,
  RevokeSessionsResponse,
  SessionListResponse,
} from '@lms/types';

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from '../config/auth.config';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthContext } from '../common/auth-context';
import { AuthService, type RequestMeta } from './auth.service';
import { RecoveryService } from './recovery.service';
import {
  SESSIONS_REVOKE_PERMISSION,
  SessionManagementService,
} from './session-management.service';
import { SignUpService, type SignUpResult } from './sign-up.service';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/**
 * Returned verbatim for every Forgot Password request, whatever happened.
 *
 * Constant rather than built per-branch so no future edit can accidentally make
 * the wording depend on whether the account exists (Scenarios 8, 22).
 */
const RECOVERY_ACCEPTED =
  'If an account exists for that mobile number, a recovery code has been sent.';

/**
 * The recovery endpoints select a named throttler rather than declaring a
 * literal limit, because their limits are configurable and `@Throttle`'s
 * arguments are evaluated before ConfigModule has loaded `.env`. The buckets
 * themselves are defined in AppModule via `ThrottlerModule.forRootAsync`.
 */
const RECOVERY_REQUEST_THROTTLE = {
  recoveryRequest: {},
  // Buckets are additive, so without this the `default` limit would apply on
  // top of the configured one and silently cap anything set above it.
  //
  // This is one half of the problem; the other half — every *named* bucket
  // applying to every *other* route, so the signup limit of 3/min throttled the
  // whole application — is closed by `skipIf` where the buckets are defined in
  // AppModule. A route cannot fix that from here, which is why it is fixed
  // there.
  default: { limit: Number.MAX_SAFE_INTEGER, ttl: 60_000 },
};
const RECOVERY_VERIFY_THROTTLE = {
  recoveryVerify: {},
  default: { limit: Number.MAX_SAFE_INTEGER, ttl: 60_000 },
};

/** Sign-in, configurable for the same reason — see `auth.signInRateLimit`. */
const SIGN_IN_THROTTLE = {
  signIn: {},
  default: { limit: Number.MAX_SAFE_INTEGER, ttl: 60_000 },
};

/**
 * Signup, far stricter than sign-in. Creating an organization is a
 * once-per-lifetime act, and each one writes several hundred rows and burns an
 * argon2 hash — see `signup.rateLimit`.
 */
const SIGN_UP_THROTTLE = {
  signup: {},
  default: { limit: Number.MAX_SAFE_INTEGER, ttl: 60_000 },
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly recovery: RecoveryService,
    private readonly sessionManagement: SessionManagementService,
    private readonly signUpService: SignUpService,
    private readonly config: ConfigService,
  ) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /**
   * Tokens are delivered exclusively as httpOnly cookies and never in the
   * response body, so client-side JavaScript cannot read them (rule 18).
   */
  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): void {
    const secure = this.config.get<boolean>('auth.cookieSecure') ?? false;
    const domain = this.config.get<string>('auth.cookieDomain');

    res.cookie(ACCESS_COOKIE, accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      domain,
      // Derived from AUTH_ACCESS_TTL, not restated: a literal here silently
      // desyncs from the token's own lifetime the moment that is changed.
      maxAge:
        this.config.get<number>('auth.accessTokenTtlMs') ?? 15 * 60 * 1000,
    });

    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      // Scoped so the refresh token never rides along on ordinary API calls.
      path: REFRESH_COOKIE_PATH,
      domain,
      expires: refreshExpiresAt,
    });
  }

  private clearAuthCookies(res: Response): void {
    const secure = this.config.get<boolean>('auth.cookieSecure') ?? false;
    const domain = this.config.get<string>('auth.cookieDomain');
    res.clearCookie(ACCESS_COOKIE, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      domain,
    });
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      domain,
    });
  }

  @Public()
  // Per-IP ceiling against distributed guessing across many accounts, which the
  // per-account lockout cannot see. Kept well above the 5-attempt lockout so a
  // legitimate user meets the account lock, not the rate limiter.
  @Throttle(SIGN_IN_THROTTLE)
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body() dto: SignInDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUser }> {
    const result = await this.auth.signIn(dto, this.meta(req));
    this.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      result.refreshExpiresAt,
    );
    return { user: result.user };
  }

  /**
   * Creates an organization and its first Super Admin (Q-ACT-1, Q-ACT-2).
   *
   * 404s unless `ALLOW_PUBLIC_SIGNUP` is on. Deliberately does not set auth
   * cookies — the response names the organization code so the client can send
   * the user to a pre-filled sign-in form.
   */
  @Public()
  @Throttle(SIGN_UP_THROTTLE)
  @Post('sign-up')
  @HttpCode(HttpStatus.CREATED)
  async signUp(
    @Body() dto: SignUpDto,
    @Req() req: Request,
  ): Promise<SignUpResult> {
    return await this.signUpService.signUp(dto, this.meta(req));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUser }> {
    const cookies = req.cookies as Record<string, string | undefined>;
    const token = cookies[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('Invalid session');

    const result = await this.auth.refresh(token, this.meta(req));
    this.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      result.refreshExpiresAt,
    );
    return { user: result.user };
  }

  /** Terminates the session created at sign-in (Scenario 36). */
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.signOut(
      user.orgId,
      user.sessionId,
      user.userId,
      this.meta(req),
    );
    this.clearAuthCookies(res);
  }

  /**
   * Replaces the caller's own password (Change Password story).
   *
   * No `@Public()`, so the global JwtAuthGuard authenticates it — which is
   * Scenario 2: an unauthenticated request never reaches this handler, and
   * Scenario 41's denial is logged by the guard layer.
   *
   * No `@RequirePermissions` either. The story's "permission to manage their
   * password" is satisfied by authentication itself: every user may change
   * their own credential, and gating it would lock people out of the one screen
   * that secures their account. If Module 3 later defines such a permission it
   * attaches here, via the existing PermissionsGuard.
   *
   * Returns 204 with no body, ever — Scenarios 26 and 27 ("the hash is never
   * returned to the client") hold because there is nothing to return.
   */
  // Bounds current-password guessing from a session that is already
  // authenticated. Deliberately not backed by a failedLoginAttempts increment:
  // see the reasoning in AuthService.changePassword.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthContext,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // Cookies are cleared only once the change has committed: a thrown
    // exception skips this line, so a failed attempt leaves the session intact
    // and the user stays on the form.
    await this.auth.changePassword(user, dto, this.meta(req));
    this.clearAuthCookies(res);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthContext): Promise<{ user: AuthUser }> {
    const profile = await this.auth.loadProfile(
      user.orgId,
      user.userId,
      user.orgCode,
    );
    return { user: profile.user };
  }

  // ---------------------------------------------------------------------------
  // Active Sessions / Session Management
  // ---------------------------------------------------------------------------

  /**
   * The caller's own active sessions (Scenario 1).
   *
   * Takes no user or organization parameter: the scope is whoever the session
   * says the caller is. There is nowhere in this signature to put someone
   * else's identifier, so Scenario 24 holds structurally.
   */
  @Get('sessions')
  async listSessions(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
  ): Promise<SessionListResponse> {
    const sessions = await this.sessionManagement.listOwnSessions(
      user,
      this.meta(req),
    );
    return { sessions };
  }

  /**
   * Ends every session except this one — "sign out everywhere else".
   *
   * Declared before `sessions/:sessionId` because Nest matches routes in
   * declaration order, and a literal segment must win over a parameter that
   * would otherwise swallow it.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('sessions/revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAllSessions(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
  ): Promise<RevokeSessionsResponse> {
    return this.sessionManagement.revokeAllOtherSessions(user, this.meta(req));
  }

  /**
   * Ends one of the caller's own sessions.
   *
   * Cookies are cleared only when the caller ended the session they are using,
   * which is a logout in everything but name; revoking another device leaves
   * this session untouched.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @CurrentUser() user: AuthContext,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RevokeSessionsResponse> {
    const result = await this.sessionManagement.revokeOwnSession(
      user,
      sessionId,
      this.meta(req),
    );
    if (result.currentSessionRevoked) this.clearAuthCookies(res);
    return result;
  }

  /**
   * Administrative revocation of another user's session (Scenario 23).
   *
   * `@RequirePermissions` is the authorization gate; being authenticated is
   * never enough. Branch and organization scope are enforced inside the
   * service, because a permission cannot express "only within my own branch".
   */
  @RequirePermissions(SESSIONS_REVOKE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete('users/:userId/sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  async revokeUserSession(
    @CurrentUser() user: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Req() req: Request,
  ): Promise<RevokeSessionsResponse> {
    return this.sessionManagement.revokeUserSession(
      user,
      userId,
      sessionId,
      this.meta(req),
    );
  }

  // ---------------------------------------------------------------------------
  // Password recovery
  // ---------------------------------------------------------------------------

  /**
   * Step 1 — request a recovery code.
   *
   * Always 202 with the same body. An unknown mobile number, an inactive
   * account and a successful send are indistinguishable to the caller, which is
   * what stops this endpoint being an account-enumeration oracle (Scenarios 8,
   * 9, 10, 22, 26).
   *
   * The per-IP limit is tighter than sign-in's because, unlike a sign-in
   * attempt, every accepted request can cost an SMS. Per-account throttling
   * lives in RecoveryService, since an IP limit alone does nothing against a
   * distributed attempt to flood one user (Q-REC-17).
   */
  @Public()
  @Throttle(RECOVERY_REQUEST_THROTTLE)
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.recovery.requestRecovery(dto, this.meta(req));
    return { message: RECOVERY_ACCEPTED };
  }

  /**
   * Step 2 — exchange a verified OTP for a single-use reset authorization.
   *
   * The token is returned in the body rather than as a cookie: it authorizes
   * one operation, is not a session, and the web tier holds it only for the
   * lifetime of the reset form.
   */
  @Public()
  @Throttle(RECOVERY_VERIFY_THROTTLE)
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
  ): Promise<{ resetToken: string }> {
    return this.recovery.verifyOtp(dto, this.meta(req));
  }

  /**
   * Step 3 — establish the new password.
   *
   * No session is issued. The user must sign in again with the new credential
   * before any protected route is reachable (Scenario 28).
   */
  @Public()
  @Throttle(RECOVERY_VERIFY_THROTTLE)
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.recovery.resetPassword(dto, this.meta(req));
  }
}
