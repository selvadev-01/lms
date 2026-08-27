import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CheckInStatusResponse,
  GpsCheckInSummary,
  SubmitCheckInResponse,
} from '@lms/types';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import type { RequestMeta } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  GPS_FAILURE_REASON,
  GPS_VERIFICATION_STATUS,
  evaluateLocation,
  type GpsPolicy,
} from './gps-verification';
import type { ReportFailureDto } from './dto/report-failure.dto';
import type { SubmitCheckInDto } from './dto/submit-check-in.dto';

/** Permission to perform a GPS check-in. Held by Field Employees only. */
export const FIELD_CHECKIN_PERMISSION = 'field.checkin';
/** Permission to review somebody else's check-in history. Admins only. */
export const FIELD_CHECKIN_VIEW_PERMISSION = 'field.checkin.view';

/** The subset of a gps_check_ins row this service reads back. */
interface CheckInRow {
  checkInId: string;
  branchId: string;
  verificationStatus: string;
  permissionStatus: string;
  networkStatus: string;
  failureReason: string | null;
  latitude: unknown;
  longitude: unknown;
  accuracyMeters: unknown;
  locationTimestamp: Date | null;
  verifiedAt: Date | null;
  createdAt: Date;
}

/**
 * Prisma returns DECIMAL columns as Decimal instances, which serialize to JSON
 * as objects rather than numbers. Convert at this boundary so the wire type is
 * a plain number, matching `GpsCheckInSummary`.
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toSummary(row: CheckInRow): GpsCheckInSummary {
  return {
    checkInId: row.checkInId,
    verificationStatus:
      row.verificationStatus as GpsCheckInSummary['verificationStatus'],
    permissionStatus:
      row.permissionStatus as GpsCheckInSummary['permissionStatus'],
    networkStatus: row.networkStatus as GpsCheckInSummary['networkStatus'],
    failureReason: row.failureReason as GpsCheckInSummary['failureReason'],
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    accuracyMeters: toNumber(row.accuracyMeters),
    locationTimestamp: row.locationTimestamp?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    branchId: row.branchId,
  };
}

/**
 * Field Employee GPS check-in.
 *
 * Every method takes the caller's AuthContext rather than loose ids, following
 * SessionManagementService. That is what makes the story's scoping rules true
 * by construction rather than by validation: `orgId` and `branchId` are read
 * from the authenticated session and written to the row, so there is no request
 * field a caller could set to check in against another branch or tenant
 * (Scenarios 22, 23, 24, 26). The DTOs deliberately have no such fields, and
 * `forbidNonWhitelisted` rejects a request that invents them.
 *
 * Attempts are append-only in practice: a retry writes a new row rather than
 * updating the previous one, so a failure can never be rewritten as a success
 * (Scenarios 13-15).
 */
@Injectable()
export class GpsCheckInService {
  private readonly logger = new Logger(GpsCheckInService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private policy(): GpsPolicy {
    return {
      maxAccuracyMeters: this.config.get<number>(
        'field.gpsMaxAccuracyMeters',
        100,
      ),
      maxLocationAgeSeconds: this.config.get<number>(
        'field.gpsMaxLocationAgeSeconds',
        120,
      ),
      maxClockSkewSeconds: this.config.get<number>(
        'field.gpsMaxClockSkewSeconds',
        60,
      ),
    };
  }

  private validityHours(): number {
    return this.config.get<number>('field.checkInValidityHours', 12);
  }

  /**
   * A caller with no branch has nothing to check in against.
   *
   * This is a provisioning problem rather than an attack — an org-wide account
   * reaching a field-only screen — so it is recorded, then refused. It cannot
   * be handled by defaulting to some branch: inventing a scope is exactly what
   * Scenario 24 forbids.
   */
  private async requireBranch(
    user: AuthContext,
    meta: RequestMeta,
  ): Promise<string> {
    if (user.branchId === null) {
      await this.audit.record({
        orgId: user.orgId,
        action: AuditAction.CHECKIN_DENIED_NO_BRANCH,
        entityType: 'GPS_CHECK_IN',
        actorUserId: user.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      throw new ForbiddenException(
        'A branch assignment is required for field check-in',
      );
    }

    return user.branchId;
  }

  /**
   * Returns an existing attempt for this `clientAttemptId`, if any.
   *
   * The idempotency guard (Scenario 37). A retried fetch or a double submit
   * must not create a second authoritative check-in, and must not be reported
   * as a failure either — replaying the original outcome is the correct answer.
   */
  private async findExistingAttempt(
    orgId: string,
    clientAttemptId: string,
  ): Promise<CheckInRow | null> {
    return await this.prisma.gpsCheckIn.findUnique({
      where: { orgId_clientAttemptId: { orgId, clientAttemptId } },
    });
  }

  /**
   * Records one check-in attempt and returns its outcome (Scenarios 4, 6-12).
   *
   * The verdict is computed before anything is written, and the row is written
   * with that verdict — there is no path that persists a PENDING row and then
   * promotes it, so a crash between the two cannot leave a check-in that reads
   * as verified without having been verified.
   */
  async submitCheckIn(
    user: AuthContext,
    dto: SubmitCheckInDto,
    meta: RequestMeta,
  ): Promise<SubmitCheckInResponse> {
    const branchId = await this.requireBranch(user, meta);

    const existing = await this.findExistingAttempt(
      user.orgId,
      dto.clientAttemptId,
    );

    if (existing) {
      await this.audit.record({
        orgId: user.orgId,
        action: AuditAction.CHECKIN_DUPLICATE_IGNORED,
        entityType: 'GPS_CHECK_IN',
        entityId: existing.checkInId,
        actorUserId: user.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { verificationStatus: existing.verificationStatus },
      });

      return {
        checkIn: toSummary(existing),
        verified:
          existing.verificationStatus === GPS_VERIFICATION_STATUS.VERIFIED,
        duplicate: true,
      };
    }

    // The server clock decides. A device timestamp is attacker-controlled, so
    // it is evidence to be judged, never the authority (Q-GPS-11).
    const now = new Date();

    const outcome = evaluateLocation(
      {
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracyMeters: dto.accuracyMeters,
        locationTimestamp: dto.locationTimestamp
          ? new Date(dto.locationTimestamp)
          : undefined,
        permissionStatus: dto.permissionStatus,
        networkStatus: dto.networkStatus,
      },
      this.policy(),
      now,
    );

    const verified = outcome.status === GPS_VERIFICATION_STATUS.VERIFIED;

    try {
      // The row and its audit entry commit together: an audited check-in that
      // did not persist, or a persisted one with no audit trail, would each
      // make the log describe something other than what happened.
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.gpsCheckIn.create({
          data: {
            orgId: user.orgId,
            userId: user.userId,
            // From the session, never the request — this is what stops GPS
            // from moving a user between branches or tenants.
            branchId,
            sessionId: user.sessionId,
            clientAttemptId: dto.clientAttemptId,
            latitude: dto.latitude ?? null,
            longitude: dto.longitude ?? null,
            accuracyMeters: dto.accuracyMeters ?? null,
            locationTimestamp: dto.locationTimestamp
              ? new Date(dto.locationTimestamp)
              : null,
            verificationStatus: outcome.status,
            permissionStatus: dto.permissionStatus,
            networkStatus: dto.networkStatus,
            failureReason: verified ? null : outcome.reason,
            verifiedAt: verified ? now : null,
            ipAddress: meta.ipAddress ?? null,
            userAgent: meta.userAgent ?? null,
          },
        });

        await this.audit.record(
          {
            orgId: user.orgId,
            action: verified
              ? AuditAction.CHECKIN_VERIFIED
              : AuditAction.CHECKIN_FAILED,
            entityType: 'GPS_CHECK_IN',
            entityId: created.checkInId,
            actorUserId: user.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            // Coordinates are deliberately absent: they are already on the row,
            // and duplicating location data into the audit log would spread it
            // across a second store with a different retention story.
            metadata: {
              failureReason: verified ? null : outcome.reason,
              accuracyMeters: dto.accuracyMeters ?? null,
              permissionStatus: dto.permissionStatus,
              networkStatus: dto.networkStatus,
              branchId,
            },
          },
          tx,
        );

        return created;
      });

      return { checkIn: toSummary(row), verified, duplicate: false };
    } catch (error) {
      // Scenario 35: the verdict was reached but nothing durably recorded. The
      // caller must not be told the check-in succeeded, and this is logged
      // outside the rolled-back transaction so the attempt is not lost.
      this.logger.error(
        `GPS check-in persistence failed for user ${user.userId}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.audit
        .record({
          orgId: user.orgId,
          action: AuditAction.CHECKIN_PERSISTENCE_FAILED,
          entityType: 'GPS_CHECK_IN',
          actorUserId: user.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { intendedStatus: outcome.status },
        })
        .catch(() => {
          // The store is already failing; a second failure here must not mask
          // the original error the caller needs to see.
        });

      throw error;
    }
  }

  /**
   * Records a failure the browser reported before any position existed —
   * a denied permission, a timeout, or a provider error (Scenarios 6-8, 11, 12).
   *
   * Kept separate from submitCheckIn because the client genuinely has nothing
   * to send but a cause. Forcing it through the coordinate path would mean
   * inventing empty fields for a record whose whole point is that no location
   * was obtained.
   */
  async reportFailure(
    user: AuthContext,
    dto: ReportFailureDto,
    meta: RequestMeta,
  ): Promise<SubmitCheckInResponse> {
    const branchId = await this.requireBranch(user, meta);

    const existing = await this.findExistingAttempt(
      user.orgId,
      dto.clientAttemptId,
    );

    if (existing) {
      return {
        checkIn: toSummary(existing),
        verified:
          existing.verificationStatus === GPS_VERIFICATION_STATUS.VERIFIED,
        duplicate: true,
      };
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.gpsCheckIn.create({
        data: {
          orgId: user.orgId,
          userId: user.userId,
          branchId,
          sessionId: user.sessionId,
          clientAttemptId: dto.clientAttemptId,
          verificationStatus: GPS_VERIFICATION_STATUS.FAILED,
          permissionStatus: dto.permissionStatus,
          networkStatus: dto.networkStatus,
          failureReason: dto.failureReason,
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
        },
      });

      await this.audit.record(
        {
          orgId: user.orgId,
          action: AuditAction.CHECKIN_FAILED,
          entityType: 'GPS_CHECK_IN',
          entityId: created.checkInId,
          actorUserId: user.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            failureReason: dto.failureReason,
            permissionStatus: dto.permissionStatus,
            networkStatus: dto.networkStatus,
            clientReported: true,
            branchId,
          },
        },
        tx,
      );

      return created;
    });

    return { checkIn: toSummary(row), verified: false, duplicate: false };
  }

  /**
   * Whether the caller may proceed into field operations right now (Scenario 5).
   *
   * Scoped to the current session as well as the user, so signing in on a new
   * device requires a new check-in: a verified location proves where someone
   * was, and a different device is a different claim.
   *
   * Fails closed — an expired check-in is indistinguishable from never having
   * checked in, because both mean there is no current evidence of location.
   */
  async getCurrentStatus(user: AuthContext): Promise<CheckInStatusResponse> {
    const validityHours = this.validityHours();
    const cutoff = new Date(Date.now() - validityHours * 60 * 60 * 1000);

    const row = (await this.prisma.gpsCheckIn.findFirst({
      where: {
        orgId: user.orgId,
        userId: user.userId,
        sessionId: user.sessionId,
        verificationStatus: GPS_VERIFICATION_STATUS.VERIFIED,
        verifiedAt: { gte: cutoff },
      },
      orderBy: { verifiedAt: 'desc' },
    })) as CheckInRow | null;

    return {
      verified: row !== null,
      checkIn: row ? toSummary(row) : null,
      validityHours,
    };
  }

  /**
   * Check-in history for the caller, or for another user with the viewing
   * permission (Q-GPS-14).
   *
   * The permission grants the action; this enforces the reach it cannot
   * express. A branch-scoped administrator sees only their own branch; a
   * caller with no branch (Super Admin) is organization-wide. `orgId` is part
   * of the query, so a cross-tenant target is not found rather than
   * found-and-refused (Scenarios 25, 26).
   */
  async listHistory(
    actor: AuthContext,
    targetUserId: string | undefined,
    meta: RequestMeta,
  ): Promise<GpsCheckInSummary[]> {
    const isSelf = targetUserId === undefined || targetUserId === actor.userId;

    if (!isSelf) {
      const auditDenial = (reason: string) =>
        this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.CHECKIN_HISTORY_DENIED,
          entityType: 'GPS_CHECK_IN',
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { reason, targetUserId },
        });

      if (!actor.permissions.includes(FIELD_CHECKIN_VIEW_PERMISSION)) {
        await auditDenial('MISSING_PERMISSION');
        throw new ForbiddenException('Check-in history cannot be viewed');
      }

      const target = await this.prisma.user.findUnique({
        where: { orgId_userId: { orgId: actor.orgId, userId: targetUserId } },
        select: { branchId: true },
      });

      // Unknown, out-of-tenant and out-of-branch all answer identically, so the
      // endpoint cannot be used to discover which user ids are real.
      if (!target) {
        await auditDenial('NOT_FOUND_OR_OUT_OF_SCOPE');
        throw new ForbiddenException('Check-in history cannot be viewed');
      }

      if (actor.branchId !== null && target.branchId !== actor.branchId) {
        await auditDenial('BRANCH_SCOPE');
        throw new ForbiddenException('Check-in history cannot be viewed');
      }
    }

    const userId = isSelf ? actor.userId : targetUserId;

    const rows = (await this.prisma.gpsCheckIn.findMany({
      where: { orgId: actor.orgId, userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })) as CheckInRow[];

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CHECKIN_HISTORY_VIEWED,
      entityType: 'GPS_CHECK_IN',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { targetUserId: userId, self: isSelf, count: rows.length },
    });

    return rows.map(toSummary);
  }
}

/** Re-exported so the controller can name the reasons it maps. */
export { GPS_FAILURE_REASON };
