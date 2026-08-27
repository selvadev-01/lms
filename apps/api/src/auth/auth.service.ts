import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '@lms/types';

import { AuditAction, AuditService, maskMobile } from '../audit/audit.service';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import {
  PasswordPolicyException,
  PasswordPolicyService,
} from './password-policy.service';
import { SESSION_REVOKE_REASON } from './session-state';
import { SessionService } from './session.service';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { SignInDto } from './dto/sign-in.dto';
import type { AccessTokenPayload, AuthContext } from '../common/auth-context';

/** Recorded on every session revoked by an authenticated password change. */
const REVOKE_REASON_PASSWORD_CHANGE = SESSION_REVOKE_REASON.PASSWORD_CHANGE;

export interface RequestMeta {
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface SignInResult {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Outcome of the credential-validation transaction.
 *
 * The transaction returns one of these rather than throwing on failure. This is
 * essential: throwing inside `$transaction` rolls the transaction back, which
 * would undo the failed-attempt increment and the lock — so the lockout in
 * Scenarios 6 and 7 would never actually engage. The exception is raised by the
 * caller once the transaction has committed.
 */
type SignInOutcome =
  | {
      status: 'SUCCESS';
      user: AuthUser;
      payload: AccessTokenPayload;
      refreshToken: string;
      refreshExpiresAt: Date;
    }
  | { status: 'INVALID_CREDENTIALS' }
  | { status: 'ACCOUNT_INACTIVE' }
  | { status: 'ACCOUNT_LOCKED' };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly policy: PasswordPolicyService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * Access-token lifetime. Cast because `jsonwebtoken` types `expiresIn` as a
   * template-literal union (`StringValue`) that a configurable string cannot
   * satisfy structurally; the value is validated by config, not by the type.
   */
  private accessTtl(): number | undefined {
    return this.config.get<string>('auth.accessTokenTtl') as unknown as
      number | undefined;
  }

  async signIn(dto: SignInDto, meta: RequestMeta): Promise<SignInResult> {
    const organization = await this.prisma.organization.findUnique({
      where: { code: dto.orgCode },
      select: { orgId: true, code: true, status: true },
    });

    // Unknown or inactive tenant. No orgId exists, so no audit row is possible
    // (orgId is part of the audit primary key); this is logged instead.
    if (!organization || organization.status !== 'ACTIVE') {
      this.audit.recordUnresolvableTenant({
        orgCode: dto.orgCode,
        maskedMobile: maskMobile(dto.mobile),
        requestId: meta.requestId,
        ipAddress: meta.ipAddress ?? undefined,
        userAgent: meta.userAgent ?? undefined,
      });
      // Keep the timing indistinguishable from a real password check.
      await this.passwords.burn(dto.password);
      throw new UnauthorizedException('Invalid credentials');
    }

    const outcome = await this.prisma.$transaction(
      async (tx): Promise<SignInOutcome> => {
        const orgId = organization.orgId;

        // Row-lock the candidate user so a concurrent deactivation cannot land
        // between validation and session creation (Scenario 16).
        const locked = await tx.$queryRaw<
          Array<{ user_id: string }>
        >`SELECT user_id FROM users WHERE org_id = ${orgId}::uuid AND mobile = ${dto.mobile} FOR UPDATE`;

        if (locked.length === 0) {
          await this.passwords.burn(dto.password);
          await this.audit.record(
            {
              orgId,
              action: AuditAction.LOGIN_FAILURE,
              entityType: 'USER',
              // Composite FK forbids referencing a user that does not exist.
              actorUserId: null,
              requestId: meta.requestId,
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
              metadata: {
                reason: 'INVALID_CREDENTIALS',
                attemptedMobileMasked: maskMobile(dto.mobile),
              },
            },
            tx,
          );
          return { status: 'INVALID_CREDENTIALS' };
        }

        const userId = locked[0].user_id;
        let user = await tx.user.findUniqueOrThrow({
          where: { orgId_userId: { orgId, userId } },
        });

        const now = new Date();
        const auditBase = {
          orgId,
          entityType: 'USER',
          entityId: user.userId,
          actorUserId: user.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        };

        // Lock state is checked before the password, so a locked account is
        // denied even when the password is correct (Scenarios 8 and 15) and
        // cannot be used as a password oracle.
        if (user.status === 'LOCKED') {
          if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
            await this.audit.record(
              {
                ...auditBase,
                action: AuditAction.LOGIN_DENIED_LOCKED,
                metadata: { lockedUntil: user.lockedUntil.toISOString() },
              },
              tx,
            );
            return { status: 'ACCOUNT_LOCKED' };
          }

          // Lock has expired — restore the account and continue.
          user = await tx.user.update({
            where: { orgId_userId: { orgId, userId } },
            data: {
              status: 'ACTIVE',
              failedLoginAttempts: 0,
              lockedUntil: null,
            },
          });
          await this.audit.record(
            {
              ...auditBase,
              action: AuditAction.ACCOUNT_UNLOCKED,
              metadata: { reason: 'LOCK_EXPIRED' },
            },
            tx,
          );
        }

        const passwordOk = await this.passwords.verify(
          user.passwordHash,
          dto.password,
        );

        if (!passwordOk) {
          const maxAttempts =
            this.config.get<number>('auth.maxFailedAttempts') ?? 5;
          const lockMinutes =
            this.config.get<number>('auth.lockDurationMinutes') ?? 15;
          const attempts = user.failedLoginAttempts + 1;
          const shouldLock = attempts >= maxAttempts;
          const lockedUntil = shouldLock
            ? new Date(now.getTime() + lockMinutes * 60_000)
            : null;

          await tx.user.update({
            where: { orgId_userId: { orgId, userId } },
            data: {
              failedLoginAttempts: attempts,
              ...(shouldLock ? { status: 'LOCKED' as const, lockedUntil } : {}),
            },
          });

          await this.audit.record(
            {
              ...auditBase,
              action: AuditAction.LOGIN_FAILURE,
              metadata: {
                reason: 'INVALID_CREDENTIALS',
                attemptNumber: attempts,
              },
            },
            tx,
          );

          if (shouldLock) {
            await this.audit.record(
              {
                ...auditBase,
                action: AuditAction.ACCOUNT_LOCKED,
                metadata: {
                  threshold: maxAttempts,
                  lockedUntil: lockedUntil?.toISOString(),
                },
              },
              tx,
            );
          }

          return { status: 'INVALID_CREDENTIALS' };
        }

        // Re-check status after the password succeeded. Combined with the row
        // lock above, this closes Scenario 16: an account deactivated mid-request
        // must not receive a session.
        if (user.status !== 'ACTIVE') {
          await this.audit.record(
            {
              ...auditBase,
              action: AuditAction.LOGIN_DENIED_INACTIVE,
              metadata: { status: user.status },
            },
            tx,
          );
          return { status: 'ACCOUNT_INACTIVE' };
        }

        // Resolved through AuthorizationService, the same call the request guard
        // makes, so what a session is issued with and what it is later enforced
        // against cannot drift. An inactive role grants nothing, which that
        // service filters in SQL.
        //
        // `tx` is passed because this read must see the same transaction as the
        // login side effects below.
        const [effective, branch] = await Promise.all([
          this.authorization.resolve(orgId, userId, tx),
          user.branchId
            ? tx.branch.findUnique({
                where: { orgId_branchId: { orgId, branchId: user.branchId } },
                select: { name: true, status: true },
              })
            : Promise.resolve(null),
        ]);

        // findUniqueOrThrow above already proved the row exists inside this
        // transaction, so a null here is impossible rather than merely unlikely.
        if (!effective) throw new Error('User vanished during sign-in');

        const roleCodes = effective.roles;
        const permissions = effective.permissions;

        await tx.user.update({
          where: { orgId_userId: { orgId, userId } },
          data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
        });

        // Created inside the transaction so a session-creation failure rolls
        // back the login side effects entirely (Scenario 30).
        const session = await this.sessions.createSession(
          {
            orgId,
            userId,
            branchId: user.branchId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          },
          tx,
        );

        await this.audit.record(
          {
            ...auditBase,
            action: AuditAction.LOGIN_SUCCESS,
            metadata: {
              sessionId: session.sessionId,
              roles: roleCodes,
              branchId: user.branchId,
            },
          },
          tx,
        );

        const authUser: AuthUser = {
          id: user.userId,
          orgId,
          orgCode: organization.code,
          name: user.name,
          mobile: user.mobile ?? dto.mobile,
          email: user.email ?? undefined,
          roles: roleCodes,
          permissions,
          branchId: user.branchId ?? undefined,
          branchName: branch?.name ?? undefined,
        };

        return {
          status: 'SUCCESS',
          user: authUser,
          payload: {
            sub: user.userId,
            orgId,
            orgCode: organization.code,
            sid: session.sessionId,
            branchId: user.branchId,
            roles: roleCodes,
          },
          refreshToken: session.refreshToken,
          refreshExpiresAt: session.expiresAt,
        };
      },
    );

    // Thrown only after the transaction commits, so failure bookkeeping sticks.
    if (outcome.status !== 'SUCCESS') {
      // Deliberately identical for invalid / inactive / locked. Distinguishing
      // them would disclose account state to an unauthenticated caller
      // (rule 15, Scenarios 3 and 22). Q-AUTH-9 remains open.
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.sessions.enforceConcurrencyLimit(
      outcome.user.orgId,
      outcome.user.id,
    );

    const accessToken = await this.jwt.signAsync(outcome.payload, {
      secret: this.config.get<string>('auth.jwtSecret'),
      expiresIn: this.accessTtl(),
    });

    return {
      user: outcome.user,
      accessToken,
      refreshToken: outcome.refreshToken,
      refreshExpiresAt: outcome.refreshExpiresAt,
    };
  }

  /** Exchanges a refresh token for a new session, rotating the old one. */
  async refresh(
    rawRefreshToken: string,
    meta: RequestMeta,
  ): Promise<SignInResult> {
    const existing =
      await this.sessions.findActiveByRefreshToken(rawRefreshToken);
    if (!existing) throw new UnauthorizedException('Invalid session');

    const user = await this.prisma.user.findUnique({
      where: {
        orgId_userId: { orgId: existing.orgId, userId: existing.userId },
      },
    });

    // A session must not outlive the account's eligibility to hold one.
    if (!user || user.status !== 'ACTIVE') {
      await this.sessions.revoke(
        existing.orgId,
        existing.sessionId,
        'ACCOUNT_INELIGIBLE',
      );
      throw new UnauthorizedException('Invalid session');
    }

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { orgId: existing.orgId },
      select: { code: true, status: true },
    });
    if (organization.status !== 'ACTIVE') {
      await this.sessions.revoke(
        existing.orgId,
        existing.sessionId,
        'ORG_INACTIVE',
      );
      throw new UnauthorizedException('Invalid session');
    }

    const rotated = await this.sessions.rotate(
      existing,
      meta.ipAddress,
      meta.userAgent,
    );
    const profile = await this.loadProfile(
      existing.orgId,
      existing.userId,
      organization.code,
    );

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.userId,
        orgId: existing.orgId,
        orgCode: organization.code,
        sid: rotated.sessionId,
        branchId: user.branchId,
        roles: profile.roles,
      },
      {
        secret: this.config.get<string>('auth.jwtSecret'),
        expiresIn: this.accessTtl(),
      },
    );

    await this.audit.record({
      orgId: existing.orgId,
      action: AuditAction.SESSION_REFRESHED,
      entityType: 'USER_SESSION',
      entityId: rotated.sessionId,
      actorUserId: user.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      user: profile.user,
      accessToken,
      refreshToken: rotated.refreshToken,
      refreshExpiresAt: rotated.expiresAt,
    };
  }

  async signOut(
    orgId: string,
    sessionId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.sessions.revoke(
      orgId,
      sessionId,
      SESSION_REVOKE_REASON.USER_LOGOUT,
    );
    await this.audit.record({
      orgId,
      action: AuditAction.LOGOUT,
      entityType: 'USER_SESSION',
      entityId: sessionId,
      actorUserId: userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  /**
   * Replaces the caller's own password from an authenticated session.
   *
   * A sibling of `RecoveryService.resetPassword`: same policy checks, same
   * transaction contents, same post-commit revocation. The two differ only in
   * how the caller is authorized — a live session here, a single-use reset
   * token there — and in the extra gate this flow adds, verification of the
   * current password.
   *
   * The step ordering below is load-bearing; each numbered comment explains
   * what breaks if the step moves.
   */
  async changePassword(
    user: AuthContext,
    dto: ChangePasswordDto,
    meta: RequestMeta,
  ): Promise<void> {
    // 1. Identity comes from the verified access token and nothing else. The
    //    DTO has no user/org field to override it, so Scenario 29 ("cannot
    //    substitute another user's ID") holds by construction.
    const { orgId, userId, sessionId } = user;
    const now = new Date();
    const auditBase = {
      orgId,
      entityType: 'USER',
      entityId: userId,
      actorUserId: userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    };

    // 2. AuthContext carries no password hash, so the row has to be read. The
    //    select mirrors resetPassword's, plus the two account-state columns
    //    Scenarios 21 and 22 need.
    const account = await this.prisma.user.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: {
        name: true,
        mobile: true,
        passwordHash: true,
        status: true,
        lockedUntil: true,
        organization: { select: { code: true } },
      },
    });

    if (!account) {
      // A valid token whose user row has gone is a session problem, not a
      // credential one. No audit row: AuditLog.actorUserId is a composite
      // foreign key into users, so referencing a row that does not exist would
      // fail the insert.
      await this.passwords.burn(dto.currentPassword);
      throw new UnauthorizedException('Invalid session');
    }

    // 3. Re-validate the account before touching any password material, so a
    //    session that outlived its account's eligibility cannot be used as a
    //    password oracle (Scenarios 21 and 22). This mirrors signIn, which also
    //    checks account state ahead of the password.
    //
    //    Deliberately NOT mirrored from signIn: the expired-lock branch. There,
    //    an elapsed `lockedUntil` restores the account to ACTIVE and lets the
    //    sign-in proceed, because sign-in is where a lock is meant to be served
    //    and discharged. Doing the same here would make Change Password a way
    //    to clear a lock, which story rule 15 forbids ("must not remove a lock
    //    state unless the finalized security policy explicitly permits it") and
    //    rule 14 echoes for inactive accounts. A LOCKED account with an expired
    //    timer is therefore still refused below, by the `status !== 'ACTIVE'`
    //    clause. Do not "harmonize" this with signIn.
    const lockActive =
      account.lockedUntil != null &&
      account.lockedUntil.getTime() > now.getTime();

    if (account.status !== 'ACTIVE' || lockActive) {
      await this.passwords.burn(dto.currentPassword);
      await this.audit.record({
        ...auditBase,
        action: AuditAction.PASSWORD_CHANGE_DENIED_INELIGIBLE,
        metadata: {
          status: account.status,
          lockedUntil: account.lockedUntil?.toISOString() ?? null,
          sessionId,
        },
      });
      throw new UnauthorizedException(
        'Your session is no longer valid. Please sign in again.',
      );
    }

    // 4. Verify the current password (Scenarios 7 and 8).
    const currentOk = await this.passwords.verify(
      account.passwordHash,
      dto.currentPassword,
    );

    if (!currentOk) {
      // Timing equalization. The success path performs two argon2 operations —
      // this verify plus the hash of the new password — so returning after only
      // one would make response time a reliable oracle for "was the current
      // password correct", readable by anyone probing from a hijacked session.
      // Burning the new password costs what hashing it would have cost.
      await this.passwords.burn(dto.newPassword);
      await this.audit.record({
        ...auditBase,
        action: AuditAction.PASSWORD_CHANGE_DENIED_CREDENTIALS,
        metadata: { sessionId },
      });
      // Deliberately no failedLoginAttempts increment and no lockout. This
      // endpoint is reachable only with a live session, so feeding the sign-in
      // lockout counter from here would let anyone who reaches an open session
      // lock the real user out of signing in — handing an attacker a denial of
      // service. The protections here are the route throttle and this audit
      // trail. (Story Scenario 9 leaves the threshold policy open; this is the
      // applied answer.)
      //
      // The message is specific rather than the generic sign-in wording: the
      // caller is already authenticated as this exact user, so naming which
      // field is wrong discloses nothing they do not already know.
      throw new UnauthorizedException('Your current password is incorrect');
    }

    // 5. Policy and history (Scenarios 12-16). Identical to resetPassword's
    //    block, including the identifiers — the account values a password may
    //    not embed.
    //
    //    Scenario 15 ("new password is identical to current") needs no code of
    //    its own: assertNotReused checks the current hash before walking the
    //    history, so it is rejected here as reuse.
    try {
      this.policy.assertMeetsPolicy(dto.newPassword, [
        account.name,
        account.mobile ?? '',
        account.organization.code,
      ]);
      await this.policy.assertNotReused(
        orgId,
        userId,
        dto.newPassword,
        account.passwordHash,
      );
    } catch (error) {
      if (error instanceof PasswordPolicyException) {
        // The category is audited, never the messages: a policy message can
        // describe the rejected password closely enough to be worth omitting.
        await this.audit.record({
          ...auditBase,
          action: AuditAction.PASSWORD_CHANGE_FAILED,
          metadata: { reason: error.reason, sessionId },
        });
      }
      throw error;
    }

    // 6. Hash outside the transaction. Argon2 is deliberately slow, and holding
    //    a Postgres transaction open across it would pin a connection for the
    //    full work factor under load. If hashing throws (Scenario 32), no
    //    transaction has been opened yet, so there is no partial state to undo.
    const passwordHash = await this.passwords.hash(dto.newPassword);

    // 7. Commit (Scenarios 17, 28, 33). The credential, its history entry and
    //    the audit record share one transaction: a history row that survived a
    //    rolled-back change would forbid a password the user is still using,
    //    and a failure anywhere here leaves the old password valid.
    //
    //    Note what the update does NOT touch: status, lockedUntil,
    //    failedLoginAttempts, branchId, and every role and permission row.
    //    That omission is the entire mechanism by which Scenarios 18, 19, 20,
    //    30 and 31 hold — there is no code to point at for them, only the
    //    absence of code, so it is stated here explicitly.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { orgId_userId: { orgId, userId } },
        data: { passwordHash, passwordChangedAt: now },
      });
      await this.policy.recordAndTrim(orgId, userId, passwordHash, tx);
      await this.audit.record(
        {
          ...auditBase,
          action: AuditAction.PASSWORD_CHANGE_COMPLETED,
          metadata: { sessionId, changedAt: now.toISOString() },
        },
        tx,
      );
    });

    // 8. Revoke every session, including the one making this request
    //    (Scenarios 23, 24, 25). The controller clears this caller's cookies
    //    once this resolves, so the user re-authenticates with the new password.
    //
    //    Post-commit by necessity — revokeAllForUser takes no transaction
    //    client — and by design: Scenario 34 requires that a revocation failure
    //    does NOT roll the password change back. Reverting a committed
    //    credential change because the session table misbehaved would leave the
    //    user's new password silently non-existent while they believe it works,
    //    which is strictly worse than sessions outliving their revocation. The
    //    failure is escalated instead, and the request still succeeds.
    try {
      const revoked = await this.sessions.revokeAllForUser(
        orgId,
        userId,
        REVOKE_REASON_PASSWORD_CHANGE,
      );
      this.logger.log(
        `Revoked ${revoked} session(s) after password change for user ${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `Session revocation failed after password change for user ${userId}`,
        error as Error,
      );
      // Scenario 35: an audit-write failure on this path must not turn a
      // committed password change into a 500. Nothing sensitive is in this
      // metadata, so swallowing the write exposes nothing.
      await this.audit
        .record({
          ...auditBase,
          action: AuditAction.PASSWORD_CHANGE_REVOCATION_FAILED,
          metadata: { sessionId, sessionInvalidationStatus: 'FAILED' },
        })
        .catch(() => undefined);
    }
  }

  /** Rebuilds the caller's profile for `GET /auth/me`. */
  async loadProfile(
    orgId: string,
    userId: string,
    orgCode?: string,
  ): Promise<{ user: AuthUser; roles: string[]; permissions: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { orgId_userId: { orgId, userId } },
    });

    const code =
      orgCode ??
      (
        await this.prisma.organization.findUniqueOrThrow({
          where: { orgId },
          select: { code: true },
        })
      ).code;

    // Same resolution the request guard performs, so `GET /auth/me` reports the
    // permissions that will actually be enforced rather than a second opinion.
    const effective = await this.authorization.resolve(orgId, userId);
    // findUniqueOrThrow above already proved the row exists.
    if (!effective) throw new Error('User vanished while loading profile');

    const roles = effective.roles;
    const permissions = effective.permissions;

    const branch = user.branchId
      ? await this.prisma.branch.findUnique({
          where: { orgId_branchId: { orgId, branchId: user.branchId } },
          select: { name: true },
        })
      : null;

    return {
      user: {
        id: user.userId,
        orgId,
        orgCode: code,
        name: user.name,
        mobile: user.mobile ?? '',
        email: user.email ?? undefined,
        roles,
        permissions,
        branchId: user.branchId ?? undefined,
        branchName: branch?.name ?? undefined,
      },
      roles,
      permissions,
    };
  }
}
