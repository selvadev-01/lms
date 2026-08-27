import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  FieldCollectionDetail,
  FieldCollectionListResult,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CollectionService,
  type FieldContext,
} from '../../loans/collection/collection.service';
import {
  FIELD_COLLECTION_INCLUDE,
  toFieldCollectionDetail,
  toFieldCollectionSummary,
  type FieldCollectionRow,
} from './field-collection.mapper';
import type {
  ListFieldCollectionsDto,
  RecordFieldCollectionDto,
  SyncFieldCollectionDto,
  VerifyCollectionDto,
} from './dto/field-collection.dto';

export const FIELD_COLLECTIONS_VIEW_PERMISSION = 'field.collections.view';
export const FIELD_COLLECTIONS_RECORD_PERMISSION = 'field.collections.record';
export const FIELD_COLLECTIONS_VERIFY_PERMISSION = 'field.collections.verify';

const NOT_REACHABLE = 'Field collection not found';
const STALE =
  'This collection has changed since you opened it. Reload and try again.';

/**
 * Module 12 — field collection.
 *
 * # What this service does and does not do
 *
 * It does **not** post money. Every field collection goes through
 * `CollectionService.postField`, which is `postInternal` — the same replay
 * check, the same server-side allocation, the same single transaction, the same
 * receipt minted inside it. Re-implementing any of that here is how two paths
 * that must agree come to disagree.
 *
 * What it owns is everything around the posting: who may see which collections,
 * the evidence contract, and the verification decision on an offline capture
 * that Module 11's docblock explicitly hands over.
 *
 * # Two scopes, not one
 *
 * Every other module in this codebase applies one scope: the branch. This one
 * applies two. A Field Employee sees only their own collections — Rule 4 says
 * an agent acts "within the employee's authorized assignment scope", and
 * Scenario 2 requires that collections of other agents are not returned.
 *
 * The narrowing keys off `field.collections.verify` rather than off the role
 * name. Roles are data and can be reshaped by an administrator; the permission
 * is what the guard actually checks, so keying on it means a custom role that
 * reviews captures sees what it needs without a code change, and one that does
 * not stays confined.
 */
@Injectable()
export class FieldCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly collections: CollectionService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * The scope every read applies.
   *
   * The branch spread is the Module 11 idiom, repeated rather than abstracted
   * for the reason `CollectionService.findInScope` documents: a shared helper
   * that grew an option to skip one would be an invisible hole.
   *
   * The agent spread is Module 12's addition. A caller who cannot verify
   * captures sees only their own.
   */
  private scopeWhere(actor: AuthContext) {
    return {
      orgId: actor.orgId,
      ...(actor.branchId ? { branchId: actor.branchId } : {}),
      isFieldCollection: true,
      ...(this.isConfinedToOwn(actor) ? { collectorUserId: actor.userId } : {}),
    };
  }

  /** Whether this caller may see only the collections they took themselves. */
  private isConfinedToOwn(actor: AuthContext): boolean {
    return !actor.permissions.includes(FIELD_COLLECTIONS_VERIFY_PERMISSION);
  }

  async list(
    actor: AuthContext,
    dto: ListFieldCollectionsDto,
    meta: RequestMeta,
  ): Promise<FieldCollectionListResult> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const where = {
      ...this.scopeWhere(actor),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.paymentMode ? { paymentMode: dto.paymentMode } : {}),
      ...(dto.gpsCaptureStatus
        ? { gpsCaptureStatus: dto.gpsCaptureStatus }
        : {}),
      ...(dto.loanId ? { loanId: dto.loanId } : {}),
      // The handover work list: cash the agent is still holding. Compared
      // against the string, because a query parameter is text — a truthiness
      // test would treat `awaitingHandover=false` as a request to filter.
      ...(dto.awaitingHandover === 'true'
        ? {
            custodyHandoverId: null,
            paymentMode: 'CASH' as const,
            status: 'POSTED' as const,
          }
        : {}),
      ...(dto.fromDate || dto.toDate
        ? {
            collectionDate: {
              ...(dto.fromDate ? { gte: this.civilDate(dto.fromDate) } : {}),
              ...(dto.toDate ? { lte: this.civilDate(dto.toDate) } : {}),
            },
          }
        : {}),
      ...(dto.search
        ? {
            OR: [
              {
                receiptNumber: {
                  contains: dto.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                loan: {
                  loanNumber: {
                    contains: dto.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.collection.findMany({
        where,
        include: FIELD_COLLECTION_INCLUDE,
        orderBy: [{ collectionDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.collection.count({ where }),
    ]);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.FIELD_COLLECTION_LISTED,
      entityType: 'FIELD_COLLECTION',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { total, confinedToOwn: this.isConfinedToOwn(actor) },
    });

    return {
      items: rows.map((row) =>
        toFieldCollectionSummary(row as unknown as FieldCollectionRow),
      ),
      total,
      page,
      pageSize,
    };
  }

  /**
   * A field collection the caller may reach, or a 404.
   *
   * Never a 403. A 403 would confirm the collection exists in another branch or
   * belongs to another agent, which is the information the scope is there to
   * withhold (Scenarios 45, 47).
   */
  private async findInScope(
    actor: AuthContext,
    collectionId: string,
    meta: RequestMeta,
  ): Promise<FieldCollectionRow> {
    const row = await this.prisma.collection.findFirst({
      where: { ...this.scopeWhere(actor), collectionId },
      include: FIELD_COLLECTION_INCLUDE,
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.FIELD_COLLECTION_SCOPE_DENIED,
        entityType: 'FIELD_COLLECTION',
        entityId: collectionId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  async getDetail(
    actor: AuthContext,
    collectionId: string,
    meta: RequestMeta,
  ): Promise<FieldCollectionDetail> {
    const row = await this.findInScope(actor, collectionId, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.FIELD_COLLECTION_VIEWED,
      entityType: 'FIELD_COLLECTION',
      entityId: collectionId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toFieldCollectionDetail(row);
  }

  // -------------------------------------------------------------------------
  // Posting
  // -------------------------------------------------------------------------

  /** Records a collection taken in the field, online. */
  async record(
    actor: AuthContext,
    dto: RecordFieldCollectionDto,
    meta: RequestMeta,
  ): Promise<FieldCollectionDetail> {
    const field = await this.resolveEvidence(actor, dto, meta);

    await this.collections.postField(actor, dto, meta, field, null);

    return this.reread(actor, dto.idempotencyKey, meta, {
      action: AuditAction.FIELD_COLLECTION_RECORDED,
      metadata: { gpsCaptureStatus: dto.gpsCaptureStatus },
    });
  }

  /** Posts a collection captured offline (Scenarios 13-17). */
  async sync(
    actor: AuthContext,
    dto: SyncFieldCollectionDto,
    meta: RequestMeta,
  ): Promise<FieldCollectionDetail> {
    const field = await this.resolveEvidence(actor, dto, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.FIELD_COLLECTION_SYNC_RECEIVED,
      entityType: 'FIELD_COLLECTION',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        offlineTransactionUuid: dto.offlineTransactionUuid,
        deviceId: dto.deviceId,
        capturedAt: dto.collectedAt,
        gpsCaptureStatus: dto.gpsCaptureStatus,
      },
    });

    await this.collections.postField(actor, dto, meta, field, {
      offlineTransactionUuid: dto.offlineTransactionUuid,
      deviceId: dto.deviceId,
      collectedAt: dto.collectedAt,
    });

    return this.reread(actor, dto.idempotencyKey, meta, {
      action: AuditAction.FIELD_COLLECTION_RECORDED,
      metadata: {
        offlineTransactionUuid: dto.offlineTransactionUuid,
        gpsCaptureStatus: dto.gpsCaptureStatus,
      },
    });
  }

  /**
   * Validates the GPS claim and builds the evidence context.
   *
   * **Scenario 55, and the reason it is structural rather than a check.** A
   * client may report `FAILED` or `PENDING` freely — Rule 40 makes GPS
   * evidence, not a gate, so a collection with no location is perfectly valid.
   * What it may not do is *claim* a success. A `VERIFIED` status must name a
   * check-in row that this organization holds and that the GPS endpoint itself
   * marked verified. Anything else is refused, so synchronization can never
   * convert a failed capture into a successful one.
   *
   * The check-in is resolved rather than trusted: a well-formed uuid belonging
   * to another organization, another user, or an attempt that failed is not
   * evidence of anything.
   */
  private async resolveEvidence(
    actor: AuthContext,
    dto: RecordFieldCollectionDto,
    meta: RequestMeta,
  ): Promise<FieldContext> {
    if (dto.gpsCaptureStatus === 'VERIFIED') {
      const checkIn = dto.gpsCheckInId
        ? await this.prisma.gpsCheckIn.findFirst({
            where: {
              orgId: actor.orgId,
              checkInId: dto.gpsCheckInId,
              userId: actor.userId,
              verificationStatus: 'VERIFIED',
            },
            select: { checkInId: true },
          })
        : null;

      if (!checkIn) {
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.FIELD_COLLECTION_GPS_EVIDENCE_REJECTED,
          entityType: 'FIELD_COLLECTION',
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { claimedCheckInId: dto.gpsCheckInId ?? null },
        });

        throw new BadRequestException({
          message:
            'A verified GPS capture must reference a check-in this user completed. Record the capture as failed instead.',
          code: 'GPS_EVIDENCE_UNVERIFIED',
        });
      }
    }

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.FIELD_COLLECTION_GPS_EVIDENCE_RECORDED,
      entityType: 'FIELD_COLLECTION',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      // Recorded for failures as loudly as for successes: a trail that logs
      // only the successes is how Rule 41 erodes without anyone noticing.
      metadata: {
        gpsCaptureStatus: dto.gpsCaptureStatus,
        gpsCheckInId: dto.gpsCheckInId ?? null,
      },
    });

    return {
      gpsCaptureStatus: dto.gpsCaptureStatus,
      gpsCheckInId: dto.gpsCheckInId,
      fieldVisitId: dto.fieldVisitId,
      customerAckReference: dto.customerAckReference,
      deviceId: dto.deviceId,
    };
  }

  /**
   * Reads back what `postField` wrote, by the idempotency key.
   *
   * The key rather than the returned id, because a replay returns the original
   * collection and both paths must render identically — a retry that produced a
   * different shape from the first attempt would defeat the point of the
   * idempotency contract.
   */
  private async reread(
    actor: AuthContext,
    idempotencyKey: string,
    meta: RequestMeta,
    audit: { action: string; metadata: Record<string, unknown> },
  ): Promise<FieldCollectionDetail> {
    const row = await this.prisma.collection.findFirst({
      where: { orgId: actor.orgId, idempotencyKey },
      include: FIELD_COLLECTION_INCLUDE,
    });

    if (!row) throw new NotFoundException(NOT_REACHABLE);

    await this.audit.record({
      orgId: actor.orgId,
      action: audit.action,
      entityType: 'FIELD_COLLECTION',
      entityId: row.collectionId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: audit.metadata,
    });

    return toFieldCollectionDetail(row);
  }

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------

  /**
   * Confirms or rejects a collection captured offline (Scenario 6 of the
   * open questions; the transition Module 11 hands to Module 12).
   *
   * # Why this does not move money
   *
   * The payment posted when the capture synced. This records a supervisor's
   * judgement about whether the capture was genuine, which is a custody
   * question, not a financial one. A rejection does **not** reverse the
   * collection — reversal is its own permission and its own act, and silently
   * reversing here would make a review click move money.
   *
   * It works on a POSTED row only because the migration relaxed
   * `reject_posted_collection_mutation` to permit a same-status update that
   * touches `verification_status` and leaves every financial column pinned.
   */
  async verify(
    actor: AuthContext,
    collectionId: string,
    dto: VerifyCollectionDto,
    meta: RequestMeta,
  ): Promise<FieldCollectionDetail> {
    const before = await this.findInScope(actor, collectionId, meta);

    if (before.updatedAt.toISOString() !== dto.expectedVersion) {
      throw new ConflictException(STALE);
    }

    if (before.verificationStatus !== 'PENDING_VERIFICATION') {
      throw new ConflictException('This collection has already been reviewed.');
    }

    await this.prisma.$transaction(async (tx) => {
      // The guarded claim: `verificationStatus` and `updatedAt` in the WHERE
      // make a concurrent review lose rather than overwrite.
      const guard = await tx.collection.updateMany({
        where: {
          orgId: actor.orgId,
          collectionId,
          verificationStatus: 'PENDING_VERIFICATION',
          updatedAt: before.updatedAt,
        },
        data: {
          verificationStatus: dto.decision,
          ...(dto.verificationNotes
            ? { verificationNotes: dto.verificationNotes }
            : {}),
        },
      });

      if (guard.count === 0) throw new ConflictException(STALE);

      await tx.collectionVerification.create({
        data: {
          orgId: actor.orgId,
          collectionId,
          status: dto.decision,
          verifiedBy: actor.userId,
          ...(dto.verificationNotes
            ? { verificationNotes: dto.verificationNotes }
            : {}),
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action:
            dto.decision === 'CONFIRMED'
              ? AuditAction.FIELD_COLLECTION_VERIFIED
              : AuditAction.FIELD_COLLECTION_VERIFICATION_REJECTED,
          entityType: 'FIELD_COLLECTION',
          entityId: collectionId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: { verificationStatus: before.verificationStatus },
          newData: { verificationStatus: dto.decision },
          metadata: { reason: dto.verificationNotes ?? null },
        },
        tx,
      );
    });

    return this.getDetail(actor, collectionId, meta);
  }

  /** A DATE-only value, parsed as a civil date rather than an instant. */
  private civilDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }
}
