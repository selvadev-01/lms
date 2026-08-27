import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  allocate,
  AllocationError,
  todayInKolkata,
  type AllocationResult,
  type AllocationTarget,
} from '@lms/emi';
import type {
  AllocationPreview,
  CollectionBlocker,
  CollectionDetail,
  CollectionListResult,
  CollectionReadiness,
  CollectionSummary,
  LedgerEntryDetail,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { TransitionTx } from '../applications/application-transition.service';
import { formatPaise } from '../../common/export/money-format';
import { LedgerService } from '../disbursal/ledger.service';
import { NotificationEventsService } from '../../notifications/ingestion/notification-events.service';
import { FIELD_AGENT_CASH_ACCOUNT_CODE } from '../disbursal/ledger-accounts';
import { LoanService } from '../shared/loan.service';
import {
  toEmiRow,
  type EmiLike,
} from '../repayment/repayment-schedule.service';
import {
  type ListCollectionsDto,
  type PostCollectionDto,
  type PreviewAllocationDto,
  type ReverseCollectionDto,
  type SyncCollectionDto,
} from './dto/collection.dto';
import { ReceiptService } from './receipt.service';
import {
  toAllocationPreview,
  toCollectionDetail,
  toCollectionSummary,
  COLLECTION_INCLUDE,
} from './collection.mapper';

export const COLLECTIONS_VIEW_PERMISSION = 'collections.view';
export const COLLECTIONS_RECORD_PERMISSION = 'collections.record';
export const COLLECTIONS_POST_PERMISSION = 'collections.post';
export const COLLECTIONS_REVERSE_PERMISSION = 'collections.reverse';
export const COLLECTIONS_SYNC_PERMISSION = 'collections.sync';

/** The device identity a synced capture carries. */
export interface OfflineContext {
  offlineTransactionUuid: string;
  deviceId: string;
  collectedAt: string;
}

/**
 * What Module 12 adds to a collection: custody and evidence.
 *
 * `gpsCaptureStatus` is what the *device reported*, written through unchanged.
 * The service never promotes it, and the caller is responsible for having
 * refused a claimed `VERIFIED` that names no verified check-in — Rule 41 and
 * Scenario 55 turn on a failed capture never later reading as a success.
 */
export interface FieldContext {
  gpsCaptureStatus: 'VERIFIED' | 'FAILED' | 'PENDING';
  gpsCheckInId?: string | undefined;
  fieldVisitId?: string | undefined;
  customerAckReference?: string | undefined;
  /** The device identity, carried even when the network was up. */
  deviceId: string;
}

const NOT_REACHABLE = 'Collection not found';
const STALE =
  'This collection has changed since you opened it. Reload and try again.';

/** Loan statuses an ordinary EMI collection may be taken against (Rule 30). */
const COLLECTABLE_LOAN_STATUSES = ['ACTIVE', 'OVERDUE'] as const;

/** The modes that settle through a bank and therefore carry a reference. */
const MODES_REQUIRING_REFERENCE: readonly string[] = ['UPI', 'BANK_TRANSFER'];

/**
 * Module 11 — EMI collection.
 *
 * # What makes a posting safe
 *
 * Five things, and each is load-bearing:
 *
 *  1. **Idempotency before anything else.** A client-minted key plus a unique
 *     index. A retry of the same request returns the original result as a
 *     success; the same key with a different body is a 409. The replay check
 *     runs *before* the eligibility gates on purpose — a retrying client is
 *     replaying a payment that already succeeded, and re-running gates against
 *     a loan that has since changed would refuse a payment that already
 *     happened.
 *  2. **The server allocates.** The client sends an amount, never a split. The
 *     allocation is recomputed from balances the server read itself, inside the
 *     transaction, by a pure function that is separately unit-tested.
 *  3. **One transaction.** Receipt, collection, allocations, EMI updates,
 *     penalty updates and the ledger entry commit together or not at all. A
 *     throw anywhere rolls back everything (Scenario 21).
 *  4. **The loan is re-read inside it.** The scope check outside the
 *     transaction is for the 404; the eligibility gates run against a fresh
 *     read, so a loan closed between the two is caught (Scenarios 29, 44).
 *  5. **Failures are audited outside the rollback.** A `COLLECTION_POSTING_FAILED`
 *     written inside the transaction would vanish with it, which is the one
 *     record most worth keeping.
 *
 * # What is deliberately not here
 *
 * **There is no edit endpoint** (Scenario 24). Online collection creates and
 * posts in a single act, so no editable server-side unposted row exists: a
 * `CREATED`/`SYNCED` collection lives on a device until it syncs, and editing
 * it there is Module 12's concern. An unposted collection is not authoritative
 * (Rule 39), so nothing financial turns on it. Scenario 25 — edit of a *posted*
 * collection is blocked — is the one with money behind it, and it is enforced
 * by the `collections_append_only` trigger rather than by a check here.
 *
 * **There is no delete endpoint.** Financial records are retained (Rule 44);
 * the trigger refuses a DELETE on any collection at all.
 */
@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly loans: LoanService,
    private readonly ledger: LedgerService,
    private readonly receipts: ReceiptService,
    // Module 16. Resolved from the @Global NotificationEventsModule, so this
    // module needs no imports entry and takes on no dependency on the
    // notification pipeline.
    private readonly events: NotificationEventsService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    actor: AuthContext,
    dto: ListCollectionsDto,
    meta: RequestMeta,
  ): Promise<CollectionListResult> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const where = {
      orgId: actor.orgId,
      // The branch spread, not a client filter. A Branch Admin sees their own
      // branch because of this line and nothing else (Scenario 1).
      ...(actor.branchId ? { branchId: actor.branchId } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.loanId ? { loanId: dto.loanId } : {}),
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
                transactionReference: {
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
              {
                customer: {
                  fullName: {
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
        include: COLLECTION_INCLUDE,
        orderBy: [{ collectionDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.collection.count({ where }),
    ]);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.COLLECTION_LISTED,
      entityType: 'COLLECTION',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { total, page, pageSize, status: dto.status ?? null },
    });

    return {
      items: rows.map((row) => toCollectionSummary(row)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * A collection the caller may reach, or a 404.
   *
   * The same four rules as `LoanService.findInScope`, copied rather than
   * abstracted for the reason stated there: each is a security property, and a
   * shared helper that grew an option to skip one would be an invisible hole.
   */
  async findInScope(
    actor: AuthContext,
    collectionId: string,
    meta: RequestMeta,
  ) {
    const row = await this.prisma.collection.findFirst({
      where: {
        orgId: actor.orgId,
        collectionId,
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
      },
      include: COLLECTION_INCLUDE,
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.COLLECTION_SCOPE_DENIED,
        entityType: 'COLLECTION',
        entityId: collectionId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { actorBranchId: actor.branchId },
      });

      // 404, never 403: a 403 would confirm the id exists in another branch.
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  async getDetail(
    actor: AuthContext,
    collectionId: string,
    meta: RequestMeta,
  ): Promise<CollectionDetail> {
    const row = await this.findInScope(actor, collectionId, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.COLLECTION_VIEWED,
      entityType: 'COLLECTION',
      entityId: collectionId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toCollectionDetail(row);
  }

  /** The posted entry behind a collection (Scenario 3). */
  async getLedger(
    actor: AuthContext,
    collectionId: string,
    meta: RequestMeta,
  ): Promise<LedgerEntryDetail> {
    const row = await this.findInScope(actor, collectionId, meta);

    if (!row.journalEntryId) {
      throw new NotFoundException('This collection has no ledger posting');
    }

    const entry = await this.ledger.getEntry(actor.orgId, row.journalEntryId);
    if (!entry)
      throw new NotFoundException('This collection has no ledger posting');

    return entry;
  }

  async listForLoan(
    actor: AuthContext,
    loanId: string,
    meta: RequestMeta,
  ): Promise<CollectionSummary[]> {
    // Through the loan, so an out-of-scope loan is a 404 before any collection
    // row is read.
    await this.loans.findInScope(actor, loanId, meta);

    const rows = await this.prisma.collection.findMany({
      where: { orgId: actor.orgId, loanId },
      include: COLLECTION_INCLUDE,
      orderBy: [{ collectionDate: 'desc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => toCollectionSummary(row));
  }

  /**
   * What a loan owes and whether it can be collected against.
   *
   * Advisory. The same gates run authoritatively inside `post`, against a
   * re-read of the loan — this exists so a form can refuse early and explain
   * why, not so the mutation can trust it.
   */
  async collectionReadiness(
    actor: AuthContext,
    loanId: string,
    meta: RequestMeta,
  ): Promise<CollectionReadiness> {
    const loan = await this.loans.findInScope(actor, loanId, meta);

    const blockers = await this.collectBlockers(this.prisma, actor.orgId, loan);
    const targets = await this.loadAllocationTargets(
      this.prisma,
      actor.orgId,
      loanId,
    );
    const emis = await this.loadEmis(this.prisma, actor.orgId, loanId);

    const today = todayInKolkata();
    const rows = emis.map((emi) => toEmiRow(emi, today));

    const sum = (pick: (t: AllocationTarget) => bigint) =>
      targets.reduce((total, target) => total + pick(target), 0n);

    const penalty = sum((t) => t.penaltyOutstandingPaise);
    const interest = sum((t) => t.interestOutstandingPaise);
    const principal = sum((t) => t.principalOutstandingPaise);
    const fees = sum((t) => t.feeOutstandingPaise);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.COLLECTION_READINESS_VIEWED,
      entityType: 'LOAN',
      entityId: loanId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { blockers: blockers.map((b) => b.key) },
    });

    const nextDue = rows.find(
      (row) =>
        row.effectiveStatus !== 'PAID' && row.effectiveStatus !== 'WAIVED',
    );

    return {
      loanId,
      loanNumber: loan.loanNumber,
      customerName: loan.customer.fullName,
      branchId: loan.branchId,
      collectable: blockers.length === 0,
      blockers,
      totalOutstandingPaise: (penalty + interest + principal + fees).toString(),
      penaltyOutstandingPaise: penalty.toString(),
      interestOutstandingPaise: interest.toString(),
      principalOutstandingPaise: principal.toString(),
      feesOutstandingPaise: fees.toString(),
      ...(nextDue ? { nextDueEmi: nextDue } : {}),
      installments: rows,
    };
  }

  /**
   * What a given amount would settle (Scenarios 6, 7, 8).
   *
   * Server-side even though `@lms/emi` is importable in the browser: the
   * preview has to agree with what posting will do, and the only way to
   * guarantee that is for both to run the same function against the same
   * balances.
   */
  async previewAllocation(
    actor: AuthContext,
    dto: PreviewAllocationDto,
    meta: RequestMeta,
  ): Promise<AllocationPreview> {
    const loan = await this.loans.findInScope(actor, dto.loanId, meta);

    const targets = await this.loadAllocationTargets(
      this.prisma,
      actor.orgId,
      dto.loanId,
    );
    const emis = await this.loadEmis(this.prisma, actor.orgId, dto.loanId);

    const result = this.allocateOrThrow(BigInt(dto.amountPaise), targets);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.COLLECTION_ALLOCATION_PREVIEWED,
      entityType: 'LOAN',
      entityId: loan.loanId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { amountPaise: dto.amountPaise },
    });

    const totalOutstanding = targets.reduce(
      (total, target) =>
        total +
        target.penaltyOutstandingPaise +
        target.interestOutstandingPaise +
        target.principalOutstandingPaise +
        target.feeOutstandingPaise,
      0n,
    );

    return toAllocationPreview(result, emis, {
      wouldCloseLoan: BigInt(dto.amountPaise) === totalOutstanding,
    });
  }

  // -------------------------------------------------------------------------
  // Posting
  // -------------------------------------------------------------------------

  /**
   * Records and posts a collection in one act.
   *
   * The step order in the body is deliberate and documented inline; see the
   * class comment for why each step is where it is.
   */
  async post(
    actor: AuthContext,
    dto: PostCollectionDto,
    meta: RequestMeta,
  ): Promise<CollectionDetail> {
    return this.postInternal(actor, dto, meta, null, null);
  }

  /**
   * Records and posts a collection taken in the field (Module 12).
   *
   * **The single integration seam between Modules 11 and 12.** Everything that
   * makes a posting safe — the replay check before the gates, the server-side
   * allocation, the one transaction, the receipt minted inside it — happens in
   * `postInternal` exactly as it does for an over-the-counter payment. Module
   * 12 adds custody and evidence metadata and changes which cash account the
   * entry debits, and nothing else.
   *
   * A separate `postField` rather than a wider `post` because the two are
   * different authorities: `collections.post` and `field.collections.record`
   * are separate permissions, and one method behind both would make the
   * distinction a runtime branch rather than a routing decision.
   */
  async postField(
    actor: AuthContext,
    dto: PostCollectionDto,
    meta: RequestMeta,
    field: FieldContext,
    offline: OfflineContext | null,
  ): Promise<CollectionDetail> {
    return this.postInternal(actor, dto, meta, offline, field);
  }

  /**
   * Posts a collection captured offline (Scenarios 41-44).
   *
   * The same transaction as `post`, with two additions: the device identity is
   * stored, and a replay is matched on the offline transaction id as well as
   * the idempotency key — a device that lost the response retries with both,
   * and either is enough to recognise it.
   */
  async sync(
    actor: AuthContext,
    dto: SyncCollectionDto,
    meta: RequestMeta,
  ): Promise<CollectionDetail> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.COLLECTION_SYNC_RECEIVED,
      entityType: 'COLLECTION',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        offlineTransactionUuid: dto.offlineTransactionUuid,
        deviceId: dto.deviceId,
        capturedAt: dto.collectedAt,
      },
    });

    return this.postInternal(
      actor,
      dto,
      meta,
      {
        offlineTransactionUuid: dto.offlineTransactionUuid,
        deviceId: dto.deviceId,
        collectedAt: dto.collectedAt,
      },
      null,
    );
  }

  private async postInternal(
    actor: AuthContext,
    dto: PostCollectionDto,
    meta: RequestMeta,
    offline: OfflineContext | null,
    field: FieldContext | null,
  ): Promise<CollectionDetail> {
    // Step 0. Scope. A loan the caller cannot reach is a 404 before anything
    // else is considered (Scenarios 37, 38, 39). The row it returns is
    // deliberately discarded — the posting reads the loan again inside the
    // transaction, and using this snapshot there would defeat the point.
    await this.loans.findInScope(actor, dto.loanId, meta);

    // Step 1. The request digest, so a reused key with a different body can be
    // told apart from an honest retry.
    const fingerprint = this.fingerprintOf(dto);

    // Step 2. Replay — before the gates, deliberately. See the class comment.
    const replay = await this.findReplay(
      actor.orgId,
      dto.idempotencyKey,
      offline?.offlineTransactionUuid ?? null,
    );

    if (replay) {
      if (
        replay.requestFingerprint &&
        replay.requestFingerprint !== fingerprint
      ) {
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.COLLECTION_IDEMPOTENCY_CONFLICT,
          entityType: 'COLLECTION',
          entityId: replay.collectionId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          // `requestFingerprint`, never `requestHash`: sanitizeMetadata drops
          // any key matching /hash/i and the trail would be silently empty.
          metadata: {
            idempotencyKey: dto.idempotencyKey,
            storedRequestFingerprint: replay.requestFingerprint,
            submittedRequestFingerprint: fingerprint,
          },
        });

        throw new ConflictException({
          message:
            'That idempotency key was already used for a different payment. The original posting is unchanged.',
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          collectionId: replay.collectionId,
        });
      }

      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.COLLECTION_DUPLICATE_IGNORED,
        entityType: 'COLLECTION',
        entityId: replay.collectionId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          idempotencyKey: dto.idempotencyKey,
          offline: offline !== null,
        },
      });

      // A success, never an error: the payment this request describes did
      // happen, and the client is entitled to its result (Scenarios 13, 42).
      return toCollectionDetail(replay);
    }

    // A conditional requirement, enforced here rather than by a decorator —
    // `@ValidateIf` on a required field skips the presence check entirely.
    if (
      MODES_REQUIRING_REFERENCE.includes(dto.paymentMode) &&
      !dto.transactionReference
    ) {
      await this.auditBlocked(actor, dto.loanId, meta, ['REFERENCE_REQUIRED']);
      throw new BadRequestException({
        message: 'Payment Reference is required for this payment mode',
        blockers: [
          {
            key: 'REFERENCE_REQUIRED',
            reason: 'A UPI or bank transfer must carry the payer reference.',
          },
        ],
      });
    }

    try {
      const collectionId = await this.prisma.$transaction(async (tx) => {
        // Step 3. Re-read inside the transaction. The step-0 snapshot proved
        // reachability; this proves current state (Scenarios 29, 44).
        const fresh = await tx.loan.findFirst({
          where: {
            orgId: actor.orgId,
            loanId: dto.loanId,
            ...(actor.branchId ? { branchId: actor.branchId } : {}),
          },
          include: { branch: { select: { code: true, status: true } } },
        });

        if (!fresh) throw new NotFoundException('Loan not found');

        // Step 4. Every eligibility gate, against the fresh row.
        const blockers = await this.collectBlockers(tx, actor.orgId, fresh);
        if (blockers.length > 0) {
          throw new ConflictException({
            message: blockers[0].reason,
            blockers,
            blockedBy: blockers.map((blocker) => ({
              entity: 'COLLECTION',
              label: blocker.reason,
              count: 1,
            })),
          });
        }

        // Step 5. Authoritative balances, read inside the transaction.
        const targets = await this.loadAllocationTargets(
          tx,
          actor.orgId,
          dto.loanId,
        );

        // Step 6. The server's own split. The client's amount, never its
        // allocation.
        const result = this.allocateOrThrow(BigInt(dto.amountPaise), targets);

        // Step 7. The receipt number, minted only here — inside the
        // transaction, so no number is issued for a posting that fails.
        const receiptNumber = await this.receipts.nextReceiptNumber(
          tx,
          actor.orgId,
          fresh.branch.code,
        );

        const collectionDate = this.civilDate(dto.collectionDate);

        // Step 8. The ledger entry, *before* the collection row.
        //
        // The order matters and is not stylistic. A POSTED collection is
        // immutable — `collections_append_only` permits only the transition to
        // REVERSED — so `journalEntryId` cannot be written back afterwards.
        // Posting the entry first means the id exists to be set at insert, and
        // the collection row is correct the moment it is created rather than
        // briefly incomplete.
        //
        // Nothing is lost by the inversion: both statements are in the same
        // transaction, so an entry whose collection then fails to insert rolls
        // back with it. The entry's `sourceId` is generated here for the same
        // reason — it must be known before either row exists.
        const collectionId = randomUUID();

        const journalEntryId = await this.ledger.postCollection(tx, {
          orgId: actor.orgId,
          loanId: dto.loanId,
          branchId: fresh.branchId,
          customerId: fresh.customerId,
          collectionId,
          receiptNumber,
          loanNumber: fresh.loanNumber,
          paymentMode: dto.paymentMode,
          entryDate: collectionDate,
          createdBy: actor.userId,
          components: {
            penaltyPaise: result.penaltyPaise,
            interestPaise: result.interestPaise,
            principalPaise: result.principalPaise,
            feesPaise: result.feesPaise,
          },
          // Module 12. Cash an agent took in the field is in their pocket, not
          // the branch drawer, so it debits 1220 rather than 1210 (Rule 18).
          // Only CASH creates custody: a UPI payment taken in front of a
          // customer settles through the bank exactly as it does at a counter.
          ...(field && dto.paymentMode === 'CASH'
            ? {
                cashAccountCode: FIELD_AGENT_CASH_ACCOUNT_CODE,
                agentUserId: actor.userId,
              }
            : {}),
        });

        // Step 9. The collection row. The (orgId, idempotencyKey) unique index
        // is the real claim; a lost race raises P2002 and the outer catch
        // routes it back through the replay path.
        const created = await tx.collection.create({
          data: {
            orgId: actor.orgId,
            collectionId,
            journalEntryId,
            loanId: dto.loanId,
            branchId: fresh.branchId,
            customerId: fresh.customerId,
            collectorUserId: actor.userId,
            collectionDate,
            // The device's capture time is retained as evidence; the
            // authoritative clock is the server's (Rules 34, 35).
            collectedAt: offline ? new Date(offline.collectedAt) : new Date(),
            paymentType: this.derivePaymentType(result, targets),
            paymentMode: dto.paymentMode,
            amountPaise: BigInt(dto.amountPaise),
            ...(dto.transactionReference
              ? { transactionReference: dto.transactionReference }
              : {}),
            idempotencyKey: dto.idempotencyKey,
            requestFingerprint: fingerprint,
            status: 'POSTED',
            // An online posting is confirmed by the act of posting it. An
            // offline capture arrives unverified — Module 12 owns that
            // transition (Rule 39).
            verificationStatus: offline ? 'PENDING_VERIFICATION' : 'CONFIRMED',
            receiptNumber,
            penaltyPaidPaise: result.penaltyPaise,
            interestPaidPaise: result.interestPaise,
            principalPaidPaise: result.principalPaise,
            feesPaidPaise: result.feesPaise,
            unallocatedAmountPaise: 0n,
            postedAt: new Date(),
            postedBy: actor.userId,
            ...(offline
              ? {
                  offlineCollected: true,
                  offlineTransactionUuid: offline.offlineTransactionUuid,
                  deviceId: offline.deviceId,
                  syncedAt: new Date(),
                }
              : {}),
            // Module 12. `custodyHandoverId` is deliberately absent: cash
            // enters the pool unclaimed and leaves it only by a handover
            // claiming it under a guarded update.
            ...(field
              ? {
                  isFieldCollection: true,
                  gpsCaptureStatus: field.gpsCaptureStatus,
                  ...(field.gpsCheckInId
                    ? { gpsCheckInId: field.gpsCheckInId }
                    : {}),
                  ...(field.fieldVisitId
                    ? { fieldVisitId: field.fieldVisitId }
                    : {}),
                  ...(field.customerAckReference
                    ? { customerAckReference: field.customerAckReference }
                    : {}),
                  // Carried even online: the device is what holds the cash
                  // trail together when the agent later goes offline.
                  ...(offline ? {} : { deviceId: field.deviceId }),
                }
              : {}),
            ...(dto.notes ? { verificationNotes: dto.notes } : {}),
          },
        });

        // Step 9. The receipt.
        await tx.receipt.create({
          data: {
            orgId: actor.orgId,
            receiptNumber,
            loanId: dto.loanId,
            collectionId: created.collectionId,
            receiptType: 'COLLECTION',
            amountPaise: BigInt(dto.amountPaise),
            generatedAt: new Date(),
          },
        });

        // Step 10. The allocation lines.
        await tx.collectionAllocation.createMany({
          data: result.lines.map((line) => ({
            orgId: actor.orgId,
            collectionId: created.collectionId,
            emiId: line.emiId.startsWith('penalty:') ? null : line.emiId,
            component: line.component,
            amountPaise: line.amountPaise,
          })),
        });

        // Step 12. The obligations this settled.
        await this.applyToObligations(tx, actor.orgId, result, targets);

        // Step 13. The audit trail, inside the transaction so it rolls back
        // with the money it describes.
        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.COLLECTION_CREATED,
            entityType: 'COLLECTION',
            entityId: created.collectionId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: { loanId: dto.loanId, amountPaise: dto.amountPaise },
          },
          tx,
        );

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.COLLECTION_POSTED,
            entityType: 'COLLECTION',
            entityId: created.collectionId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              receiptNumber,
              journalEntryId,
              amountPaise: dto.amountPaise,
              penaltyPaise: result.penaltyPaise.toString(),
              interestPaise: result.interestPaise.toString(),
              principalPaise: result.principalPaise.toString(),
              feesPaise: result.feesPaise.toString(),
              settledEmiIds: result.fullySettledEmiIds,
            },
          },
          tx,
        );

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.COLLECTION_LEDGER_POSTED,
            entityType: 'JOURNAL_ENTRY',
            entityId: journalEntryId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: { collectionId: created.collectionId, receiptNumber },
          },
          tx,
        );

        return created.collectionId;
      });

      const posted = await this.prisma.collection.findFirst({
        where: { orgId: actor.orgId, collectionId },
        include: COLLECTION_INCLUDE,
      });

      // Module 16. After commit, never inside (Rules 6, 7, 31, 60-62;
      // Scenarios 25, 31, 35). The money has moved and the ledger is posted; a
      // notification failure must not roll any of that back. This path holds no
      // `tx`, so it is structurally incapable of writing a ledger line — the
      // guarantee is in the type signature, not in review.
      //
      // Scenario 25 in particular: the emitter never calls back into a posting
      // service, so a replayed payment event cannot repost a payment.
      //
      // The payload reads already-computed authoritative values off the row.
      // Every amount is a decimal string of paise (Rule 25) and the allocation
      // follows the stored penalty → interest → principal → fees split rather
      // than being recomputed here (Rule 28, Scenario 33). The emitter formats;
      // it never calculates.
      if (posted) {
        await this.events
          .emit(
            {
              orgId: actor.orgId,
              branchId: posted.branchId,
              eventType: 'RECEIPT_POSTED',
              sourceModule: 'collection',
              sourceRecordId: posted.collectionId,
              // The payment's own idempotency key is a better natural identity
              // than anything computed: a retried posting and a replayed event
              // then share one key and cannot produce two notifications.
              deduplicationKey: dto.idempotencyKey
                ? `RECEIPT_POSTED:collection:${dto.idempotencyKey}`
                : undefined,
              payload: {
                receiptNumber: posted.receiptNumber,
                loanNumber: posted.loan?.loanNumber ?? '',
                customerName: posted.customer?.fullName ?? '',
                amountPaise: posted.amountPaise.toString(),
                // Pre-formatted here so the template never has to compute one
                // (Rules 25, 27). `formatPaise` takes and returns a string, so
                // no amount crosses `number` on the way to a message.
                amountFormatted: formatPaise(posted.amountPaise.toString()),
                penaltyPaise: posted.penaltyPaidPaise.toString(),
                interestPaise: posted.interestPaidPaise.toString(),
                principalPaise: posted.principalPaidPaise.toString(),
                feesPaise: posted.feesPaidPaise.toString(),
                // DATE-only (Rules 26, 68; Scenario 36). `collectionDate` is a
                // @db.Date column, so this cannot acquire a time component.
                collectionDate: posted.collectionDate
                  .toISOString()
                  .slice(0, 10),
                paymentMode: posted.paymentMode,
              },
            },
            meta,
          )
          .catch(() => undefined);
      }

      return toCollectionDetail(posted!);
    } catch (error) {
      // A lost race on the idempotency key: another request for the same
      // payment committed while this one was in flight. Replay it rather than
      // surfacing a unique-violation.
      if (this.isUniqueViolation(error, 'idempotency_key')) {
        const winner = await this.findReplay(
          actor.orgId,
          dto.idempotencyKey,
          offline?.offlineTransactionUuid ?? null,
        );
        if (winner) {
          await this.audit.record({
            orgId: actor.orgId,
            action: AuditAction.COLLECTION_DUPLICATE_IGNORED,
            entityType: 'COLLECTION',
            entityId: winner.collectionId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              idempotencyKey: dto.idempotencyKey,
              racedAtCommit: true,
            },
          });
          return toCollectionDetail(winner);
        }
      }

      if (this.isUniqueViolation(error, 'receipt_number')) {
        // Two postings in the same branch computed the same number. The loser
        // rolled back whole; nothing was issued (Scenarios 16, 48).
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.COLLECTION_RECEIPT_CONFLICT,
          entityType: 'COLLECTION',
          entityId: dto.loanId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { idempotencyKey: dto.idempotencyKey },
        });

        throw new ConflictException(
          'Another collection took the next receipt number. Nothing was posted — please try again.',
        );
      }

      if (this.isUniqueViolation(error, 'offline_transaction_uuid')) {
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.COLLECTION_SYNC_CONFLICT,
          entityType: 'COLLECTION',
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            offlineTransactionUuid: offline?.offlineTransactionUuid ?? null,
          },
        });

        throw new ConflictException({
          message:
            'This offline transaction conflicts with a payment already on the server. Nothing was overwritten.',
          code: 'OFFLINE_SYNC_CONFLICT',
        });
      }

      // Recorded outside the rolled-back transaction, so the one record most
      // worth keeping survives the failure it describes.
      await this.audit
        .record({
          orgId: actor.orgId,
          action: offline
            ? AuditAction.COLLECTION_SYNC_REJECTED_STALE
            : AuditAction.COLLECTION_POSTING_FAILED,
          entityType: 'COLLECTION',
          entityId: dto.loanId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            idempotencyKey: dto.idempotencyKey,
            amountPaise: dto.amountPaise,
            reason: error instanceof Error ? error.message : 'unknown',
          },
        })
        .catch((auditError: unknown) => {
          // Fire-and-forget: the caller must see the posting failure, not an
          // audit-write failure that replaced it.
          this.logger.error(
            `Failed to audit collection posting failure: ${String(auditError)}`,
          );
        });

      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Reversal
  // -------------------------------------------------------------------------

  /**
   * Reverses a posted collection (Scenarios 31-34).
   *
   * Full reversal only. The original row is preserved and marked REVERSED — the
   * one transition `collections_append_only` permits — a mirror row is created
   * pointing at it, the obligations it settled are unwound, and an opposite
   * ledger entry is posted. Nothing is edited or deleted.
   */
  async reverse(
    actor: AuthContext,
    collectionId: string,
    dto: ReverseCollectionDto,
    meta: RequestMeta,
  ): Promise<CollectionDetail> {
    const before = await this.findInScope(actor, collectionId, meta);

    this.assertVersion(
      before.updatedAt,
      dto.expectedVersion,
      actor,
      meta,
      collectionId,
    );

    if (before.status !== 'POSTED') {
      throw new ConflictException(
        before.status === 'REVERSED'
          ? 'This collection has already been reversed.'
          : 'Only a posted collection can be reversed.',
      );
    }

    // Module 12, Scenario 41. The cash has already left the agent and been
    // banked by the branch. Reversing the customer side alone would credit
    // 1220 for money the agent no longer holds, driving their derived balance
    // negative — the inconsistent custody state Rule 38 forbids. The handover
    // must be reversed first, which releases the claim and puts the cash back
    // in the agent's pool where a reversal can act on it.
    if (before.custodyHandoverId) {
      const handover = await this.prisma.cashHandover.findFirst({
        where: { orgId: actor.orgId, handoverId: before.custodyHandoverId },
        select: { handoverNumber: true },
      });

      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.FIELD_COLLECTION_REVERSAL_BLOCKED_HANDED_OVER,
        entityType: 'COLLECTION',
        entityId: collectionId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          custodyHandoverId: before.custodyHandoverId,
          handoverNumber: handover?.handoverNumber ?? null,
        },
      });

      throw new ConflictException({
        message: handover
          ? `This cash was handed over on ${handover.handoverNumber}. Reverse that handover before reversing the collection.`
          : 'This cash has been handed over. Reverse the handover before reversing the collection.',
        code: 'COLLECTION_HANDED_OVER',
        custodyHandoverId: before.custodyHandoverId,
        blockedBy: [
          {
            entity: 'CASH_HANDOVER',
            label: handover?.handoverNumber ?? 'Cash handover',
            count: 1,
          },
        ],
      });
    }

    const reversalId = await this.prisma.$transaction(async (tx) => {
      // The guarded claim. `status` and `updatedAt` in the WHERE make a
      // concurrent reversal or edit lose rather than double-apply.
      const guard = await tx.collection.updateMany({
        where: {
          orgId: actor.orgId,
          collectionId,
          status: 'POSTED',
          updatedAt: before.updatedAt,
        },
        data: {
          status: 'REVERSED',
          reversedAt: new Date(),
          reversedBy: actor.userId,
          reversalReason: dto.reversalReason,
        },
      });

      if (guard.count === 0) throw new ConflictException(STALE);

      // The opposite entry, posted before the row that carries it — a REVERSED
      // collection is frozen by `collections_append_only` the moment it exists,
      // so its `journalEntryId` cannot be written back afterwards. Same
      // inversion, same reason, as the posting path.
      const reversalCollectionId = randomUUID();

      const journalEntryId = await this.ledger.postCollectionReversal(tx, {
        orgId: actor.orgId,
        loanId: before.loanId,
        branchId: before.branchId,
        customerId: before.customerId,
        reversalCollectionId,
        originalReceiptNumber: before.receiptNumber ?? '(none)',
        loanNumber: before.loan.loanNumber,
        paymentMode: before.paymentMode,
        entryDate: before.collectionDate,
        createdBy: actor.userId,
        reversalReason: dto.reversalReason,
        components: {
          penaltyPaise: before.penaltyPaidPaise,
          interestPaise: before.interestPaidPaise,
          principalPaise: before.principalPaidPaise,
          feesPaise: before.feesPaidPaise,
        },
        // Module 12. Credit back the account the original debited. Reversing a
        // field collection against 1210 would take cash out of a drawer it
        // never entered and leave 1220 permanently overstated. The condition
        // mirrors the posting side exactly, so Scenario 39 is a mirror of
        // Scenario 7 by construction rather than by a second decision.
        ...(before.isFieldCollection && before.paymentMode === 'CASH'
          ? {
              cashAccountCode: FIELD_AGENT_CASH_ACCOUNT_CODE,
              agentUserId: before.collectorUserId,
            }
          : {}),
      });

      // The mirror row. The unique index on reversal_of_collection_id is what
      // makes a second reversal a database error rather than a check
      // (Scenario 33). No receipt number: a reversal is not a receipt, and
      // Rule 20 forbids reusing one.
      const reversal = await tx.collection.create({
        data: {
          orgId: actor.orgId,
          collectionId: reversalCollectionId,
          journalEntryId,
          loanId: before.loanId,
          branchId: before.branchId,
          customerId: before.customerId,
          collectorUserId: actor.userId,
          collectionDate: before.collectionDate,
          collectedAt: new Date(),
          paymentType: before.paymentType,
          paymentMode: before.paymentMode,
          amountPaise: before.amountPaise,
          idempotencyKey: `REVERSAL:${collectionId}`,
          status: 'REVERSED',
          verificationStatus: 'CONFIRMED',
          penaltyPaidPaise: before.penaltyPaidPaise,
          interestPaidPaise: before.interestPaidPaise,
          principalPaidPaise: before.principalPaidPaise,
          feesPaidPaise: before.feesPaidPaise,
          unallocatedAmountPaise: before.unallocatedAmountPaise,
          reversalOfCollectionId: collectionId,
          reversalReason: dto.reversalReason,
          reversedAt: new Date(),
          reversedBy: actor.userId,
        },
      });

      // Unwind what the original settled, from its own allocation rows —
      // recomputing would risk unwinding a different split than was applied.
      const allocations = await tx.collectionAllocation.findMany({
        where: { orgId: actor.orgId, collectionId },
      });

      await this.unwindObligations(tx, actor.orgId, allocations);

      // Mark the original entry reversed. `status` is the ONLY column touched:
      // `journal_entries_append_only` permits exactly this and nothing more,
      // and the original's lines were never mutable at all (Scenario 32).
      if (before.journalEntryId) {
        await tx.journalEntry.update({
          where: {
            orgId_journalEntryId: {
              orgId: actor.orgId,
              journalEntryId: before.journalEntryId,
            },
          },
          data: { status: 'REVERSED' },
        });
      }

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.COLLECTION_REVERSED,
          entityType: 'COLLECTION',
          entityId: collectionId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            reversalCollectionId: reversal.collectionId,
            reversalReason: dto.reversalReason,
            originalReceiptNumber: before.receiptNumber,
            amountPaise: before.amountPaise.toString(),
          },
        },
        tx,
      );

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.COLLECTION_LEDGER_REVERSED,
          entityType: 'JOURNAL_ENTRY',
          entityId: journalEntryId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            originalJournalEntryId: before.journalEntryId,
            collectionId,
          },
        },
        tx,
      );

      return reversal.collectionId;
    });

    const reversal = await this.prisma.collection.findFirst({
      where: { orgId: actor.orgId, collectionId: reversalId },
      include: COLLECTION_INCLUDE,
    });

    // Module 16, Scenario 34. A previously notified receipt has been reversed,
    // so the configured *corrective* notification is raised here. The original
    // notification is never edited or deleted — Rules 9 and 71 keep it
    // traceable, and silently rewriting it would erase the record that the
    // original event happened at all.
    //
    // After commit, for the same reason as the posting above: the reversal has
    // already moved money back.
    if (reversal) {
      await this.events
        .emit(
          {
            orgId: actor.orgId,
            branchId: reversal.branchId,
            eventType: 'RECEIPT_REVERSED',
            sourceModule: 'collection',
            sourceRecordId: reversalId,
            payload: {
              receiptNumber: before.receiptNumber,
              reversalReceiptNumber: reversal.receiptNumber,
              loanNumber: reversal.loan?.loanNumber ?? '',
              customerName: reversal.customer?.fullName ?? '',
              amountPaise: before.amountPaise.toString(),
              amountFormatted: formatPaise(before.amountPaise.toString()),
              reversalReason: dto.reversalReason ?? '',
              reversedOn: reversal.collectionDate.toISOString().slice(0, 10),
            },
          },
          meta,
        )
        .catch(() => undefined);
    }

    return toCollectionDetail(reversal!);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Every reason a loan cannot take an ordinary EMI collection right now.
   *
   * Shared by the advisory readiness read and the authoritative posting path,
   * so the form's explanation and the mutation's refusal can never disagree.
   * `OVERDUE` is deliberately collectable — an overdue loan is precisely the
   * one being collected on.
   */
  private async collectBlockers(
    tx: Pick<
      PrismaService,
      'repaymentSchedule' | 'emi' | 'penalty' | 'branch' | 'account'
    >,
    orgId: string,
    loan: {
      loanId: string;
      status: string;
      branchId: string;
      /**
       * The posting path selects `status` deliberately. The readiness path
       * reaches a loan through `LOAN_INCLUDE`, which carries the branch's name
       * but not its status — so the status is optional here and looked up below
       * when absent, rather than the readiness path silently skipping the gate.
       */
      branch?: { status?: string; name?: string } | null;
    },
  ): Promise<CollectionBlocker[]> {
    const blockers: CollectionBlocker[] = [];

    if (loan.status === 'CLOSED' || loan.status === 'CLOSURE_PENDING') {
      blockers.push({
        key: 'LOAN_CLOSED',
        reason:
          'This loan is closed and cannot take an ordinary EMI collection.',
        details: { status: loan.status },
      });
    } else if (loan.status === 'WRITTEN_OFF') {
      blockers.push({
        key: 'LOAN_WRITTEN_OFF',
        reason:
          'This loan is written off. Recovery is handled by a separate workflow.',
        details: { status: loan.status },
      });
    } else if (!COLLECTABLE_LOAN_STATUSES.includes(loan.status as never)) {
      blockers.push({
        key: 'LOAN_NOT_ACTIVE',
        reason: `A loan in ${loan.status} cannot take an EMI collection.`,
        details: { status: loan.status },
      });
    }

    const branch =
      loan.branch?.status !== undefined
        ? loan.branch
        : await tx.branch.findFirst({
            where: { orgId, branchId: loan.branchId },
            select: { status: true },
          });

    if (branch && branch.status !== 'ACTIVE') {
      blockers.push({
        key: 'BRANCH_INACTIVE',
        reason: 'The branch this loan belongs to is inactive.',
      });
    }

    const schedule = await tx.repaymentSchedule.findFirst({
      where: { orgId, loanId: loan.loanId, status: 'ACTIVE' },
      select: { repaymentScheduleId: true },
    });

    if (!schedule) {
      blockers.push({
        key: 'NO_ACTIVE_SCHEDULE',
        reason:
          'This loan has no active repayment schedule to collect against.',
      });
      // Without a schedule there is nothing to total, so stop here rather than
      // reporting a misleading "nothing outstanding" as well.
      return blockers;
    }

    const [emiTotals, penaltyTotals] = await Promise.all([
      tx.emi.aggregate({
        where: {
          orgId,
          repaymentScheduleId: schedule.repaymentScheduleId,
          status: { notIn: ['PAID', 'WAIVED', 'CANCELLED'] },
        },
        _sum: { outstandingAmountPaise: true },
      }),
      tx.penalty.aggregate({
        where: {
          orgId,
          loanId: loan.loanId,
          status: { in: ['ASSESSED', 'PARTIALLY_PAID'] },
        },
        _sum: { outstandingAmountPaise: true },
      }),
    ]);

    const outstanding =
      (emiTotals._sum.outstandingAmountPaise ?? 0n) +
      (penaltyTotals._sum.outstandingAmountPaise ?? 0n);

    if (outstanding === 0n) {
      blockers.push({
        key: 'NOTHING_OUTSTANDING',
        reason:
          'This loan has no remaining balance. A further EMI collection would be a duplicate.',
      });
    }

    return blockers;
  }

  /**
   * The authoritative outstanding balances, as allocation targets.
   *
   * Penalties are *consumed*, never accrued: Module 11 allocates what already
   * exists as a `Penalty` row and never computes one. Module 13 owns
   * assessment. A penalty attached to an installment rides on that
   * installment's target so the two settle in the same pass; a loan-level
   * penalty gets a synthetic target of its own, ordered by its assessment date.
   */
  private async loadAllocationTargets(
    tx: Pick<PrismaService, 'repaymentSchedule' | 'emi' | 'penalty'>,
    orgId: string,
    loanId: string,
  ): Promise<AllocationTarget[]> {
    const schedule = await tx.repaymentSchedule.findFirst({
      where: { orgId, loanId, status: 'ACTIVE' },
      select: { repaymentScheduleId: true },
    });

    if (!schedule) return [];

    const [emis, penalties] = await Promise.all([
      tx.emi.findMany({
        where: {
          orgId,
          repaymentScheduleId: schedule.repaymentScheduleId,
          status: { notIn: ['PAID', 'WAIVED', 'CANCELLED'] },
        },
        orderBy: { installmentNumber: 'asc' },
      }),
      tx.penalty.findMany({
        where: {
          orgId,
          loanId,
          status: { in: ['ASSESSED', 'PARTIALLY_PAID'] },
        },
        orderBy: { assessedDate: 'asc' },
      }),
    ]);

    const penaltyByEmi = new Map<string, bigint>();
    const loanLevelPenalties: typeof penalties = [];

    for (const penalty of penalties) {
      if (penalty.emiId) {
        penaltyByEmi.set(
          penalty.emiId,
          (penaltyByEmi.get(penalty.emiId) ?? 0n) +
            penalty.outstandingAmountPaise,
        );
      } else {
        loanLevelPenalties.push(penalty);
      }
    }

    const targets: AllocationTarget[] = emis.map((emi) => {
      // The interest portion is settled before the principal portion, so what
      // remains of each is derived from how much of this installment has been
      // paid so far rather than stored separately.
      const paid = emi.paidAmountPaise;
      const interestPaid =
        paid < emi.interestDuePaise ? paid : emi.interestDuePaise;
      const principalPaid = paid - interestPaid;

      return {
        emiId: emi.emiId,
        dueDate: emi.dueDate.toISOString().slice(0, 10),
        installmentNumber: emi.installmentNumber,
        penaltyOutstandingPaise: penaltyByEmi.get(emi.emiId) ?? 0n,
        interestOutstandingPaise: emi.interestDuePaise - interestPaid,
        principalOutstandingPaise: emi.principalDuePaise - principalPaid,
        feeOutstandingPaise: 0n,
      };
    });

    // Loan-level penalties, as synthetic targets. The `penalty:` prefix is what
    // `applyToObligations` and the allocation writer use to tell them from an
    // installment, and it is why `CollectionAllocation.emiId` is nullable.
    for (const penalty of loanLevelPenalties) {
      targets.push({
        emiId: `penalty:${penalty.penaltyId}`,
        dueDate: penalty.assessedDate.toISOString().slice(0, 10),
        installmentNumber: 0,
        penaltyOutstandingPaise: penalty.outstandingAmountPaise,
        interestOutstandingPaise: 0n,
        principalOutstandingPaise: 0n,
        feeOutstandingPaise: 0n,
      });
    }

    return targets;
  }

  private async loadEmis(
    tx: Pick<PrismaService, 'repaymentSchedule' | 'emi'>,
    orgId: string,
    loanId: string,
  ): Promise<EmiLike[]> {
    const schedule = await tx.repaymentSchedule.findFirst({
      where: { orgId, loanId, status: 'ACTIVE' },
      select: { repaymentScheduleId: true },
    });

    if (!schedule) return [];

    return tx.emi.findMany({
      where: { orgId, repaymentScheduleId: schedule.repaymentScheduleId },
      orderBy: { installmentNumber: 'asc' },
    });
  }

  /**
   * Applies an allocation to the installments and penalties it settled.
   *
   * The contractual columns — `totalDuePaise`, `principalDuePaise`,
   * `interestDuePaise` on an EMI, `amountPaise` on a penalty — are never
   * touched. A part payment moves the paid/outstanding pair only (Rules 16, 17;
   * Scenarios 22, 23).
   */
  private async applyToObligations(
    tx: Pick<TransitionTx, 'emi' | 'penalty'>,
    orgId: string,
    result: AllocationResult,
    targets: AllocationTarget[],
  ): Promise<void> {
    const penaltyByLine = new Map<string, bigint>();

    for (const line of result.lines) {
      if (line.emiId.startsWith('penalty:')) {
        const penaltyId = line.emiId.slice('penalty:'.length);
        penaltyByLine.set(
          penaltyId,
          (penaltyByLine.get(penaltyId) ?? 0n) + line.amountPaise,
        );
        continue;
      }

      if (line.component === 'PENALTY') {
        // An installment-attached penalty. Resolved below against the penalty
        // rows for that EMI, oldest first.
        continue;
      }
    }

    // Installments.
    for (const [emiId, amount] of result.perEmiPaise) {
      if (emiId.startsWith('penalty:')) continue;

      const target = targets.find((candidate) => candidate.emiId === emiId);
      const penaltyPortion = result.lines
        .filter((line) => line.emiId === emiId && line.component === 'PENALTY')
        .reduce((sum, line) => sum + line.amountPaise, 0n);

      // Only the EMI's own components count toward its paid amount — a penalty
      // is a separate obligation that happens to be attached to it.
      const towardEmi = amount - penaltyPortion;

      if (towardEmi > 0n) {
        const emi = await tx.emi.findFirst({
          where: { orgId, emiId },
          select: {
            paidAmountPaise: true,
            outstandingAmountPaise: true,
          },
        });

        if (emi) {
          const paid = emi.paidAmountPaise + towardEmi;
          const outstanding = emi.outstandingAmountPaise - towardEmi;

          await tx.emi.update({
            where: { orgId_emiId: { orgId, emiId } },
            data: {
              paidAmountPaise: paid,
              outstandingAmountPaise: outstanding,
              status: outstanding === 0n ? 'PAID' : 'PARTIALLY_PAID',
              ...(outstanding === 0n
                ? { paidAt: new Date() }
                : { paidAt: null }),
            },
          });
        }
      }

      if (penaltyPortion > 0n && target) {
        await this.applyToEmiPenalties(tx, orgId, emiId, penaltyPortion);
      }
    }

    // Loan-level penalties.
    for (const [penaltyId, amount] of penaltyByLine) {
      await this.applyToPenalty(tx, orgId, penaltyId, amount);
    }
  }

  /** Settles a payment across the penalties attached to one installment, oldest first. */
  private async applyToEmiPenalties(
    tx: Pick<TransitionTx, 'penalty'>,
    orgId: string,
    emiId: string,
    amountPaise: bigint,
  ): Promise<void> {
    const penalties = await tx.penalty.findMany({
      where: { orgId, emiId, status: { in: ['ASSESSED', 'PARTIALLY_PAID'] } },
      orderBy: { assessedDate: 'asc' },
    });

    let remaining = amountPaise;

    for (const penalty of penalties) {
      if (remaining === 0n) break;
      const applied =
        penalty.outstandingAmountPaise < remaining
          ? penalty.outstandingAmountPaise
          : remaining;
      await this.applyToPenalty(tx, orgId, penalty.penaltyId, applied);
      remaining -= applied;
    }
  }

  private async applyToPenalty(
    tx: Pick<TransitionTx, 'penalty'>,
    orgId: string,
    penaltyId: string,
    amountPaise: bigint,
  ): Promise<void> {
    const penalty = await tx.penalty.findFirst({
      where: { orgId, penaltyId },
      select: { paidAmountPaise: true, outstandingAmountPaise: true },
    });

    if (!penalty) return;

    const paid = penalty.paidAmountPaise + amountPaise;
    const outstanding = penalty.outstandingAmountPaise - amountPaise;

    await tx.penalty.update({
      where: { orgId_penaltyId: { orgId, penaltyId } },
      data: {
        paidAmountPaise: paid,
        outstandingAmountPaise: outstanding,
        status: outstanding === 0n ? 'PAID' : 'PARTIALLY_PAID',
      },
    });
  }

  /**
   * Puts back what a reversed collection had settled.
   *
   * Driven from the stored allocation rows rather than a recomputation: the
   * balances have moved since, and recomputing would unwind a different split
   * than was applied.
   */
  private async unwindObligations(
    tx: Pick<TransitionTx, 'emi' | 'penalty'>,
    orgId: string,
    allocations: {
      emiId: string | null;
      component: string;
      amountPaise: bigint;
    }[],
  ): Promise<void> {
    const perEmi = new Map<string, bigint>();

    for (const allocation of allocations) {
      if (!allocation.emiId) continue;
      if (allocation.component === 'PENALTY') continue;
      perEmi.set(
        allocation.emiId,
        (perEmi.get(allocation.emiId) ?? 0n) + allocation.amountPaise,
      );
    }

    for (const [emiId, amount] of perEmi) {
      const emi = await tx.emi.findFirst({
        where: { orgId, emiId },
        select: { paidAmountPaise: true, outstandingAmountPaise: true },
      });

      if (!emi) continue;

      const paid = emi.paidAmountPaise - amount;
      const outstanding = emi.outstandingAmountPaise + amount;

      await tx.emi.update({
        where: { orgId_emiId: { orgId, emiId } },
        data: {
          paidAmountPaise: paid,
          outstandingAmountPaise: outstanding,
          // Back to PENDING when nothing remains paid; the read-time derivation
          // decides whether that renders as DUE or OVERDUE.
          status: paid === 0n ? 'PENDING' : 'PARTIALLY_PAID',
          paidAt: null,
        },
      });
    }

    // Penalties settled by this collection, back to open.
    const penaltyTotal = allocations
      .filter((allocation) => allocation.component === 'PENALTY')
      .reduce((sum, allocation) => sum + allocation.amountPaise, 0n);

    if (penaltyTotal > 0n) {
      const penalties = await tx.penalty.findMany({
        where: { orgId, paidAmountPaise: { gt: 0n } },
        orderBy: { assessedDate: 'desc' },
      });

      let remaining = penaltyTotal;
      for (const penalty of penalties) {
        if (remaining === 0n) break;
        const undo =
          penalty.paidAmountPaise < remaining
            ? penalty.paidAmountPaise
            : remaining;

        await tx.penalty.update({
          where: { orgId_penaltyId: { orgId, penaltyId: penalty.penaltyId } },
          data: {
            paidAmountPaise: penalty.paidAmountPaise - undo,
            outstandingAmountPaise: penalty.outstandingAmountPaise + undo,
            status:
              penalty.paidAmountPaise - undo === 0n
                ? 'ASSESSED'
                : 'PARTIALLY_PAID',
          },
        });

        remaining -= undo;
      }
    }
  }

  /** Translates an `AllocationError` into the right HTTP status. */
  private allocateOrThrow(
    amountPaise: bigint,
    targets: AllocationTarget[],
  ): AllocationResult {
    try {
      return allocate(amountPaise, targets);
    } catch (error) {
      if (error instanceof AllocationError) {
        if (error.code === 'OVERPAYMENT') {
          // A 400 rather than a 409: the client sent more than is owed, which
          // is a bad request, and the maximum is returned so the form can say
          // exactly what to tender.
          throw new BadRequestException({
            message: error.message,
            code: 'OVERPAYMENT',
            maxCollectablePaise: error.maxCollectablePaise?.toString(),
          });
        }

        if (error.code === 'NO_OUTSTANDING') {
          throw new ConflictException({
            message: error.message,
            blockers: [{ key: 'NOTHING_OUTSTANDING', reason: error.message }],
          });
        }

        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  /**
   * Which of the three payment types this posting was.
   *
   * Derived after the fact rather than accepted from the client: a client that
   * mislabelled a partial payment as full would put a wrong word on a financial
   * record.
   */
  private derivePaymentType(
    result: AllocationResult,
    targets: AllocationTarget[],
  ): 'FULL_PAYMENT' | 'PARTIAL_PAYMENT' | 'PENALTY_ONLY' {
    const totalOutstanding = targets.reduce(
      (total, target) =>
        total +
        target.penaltyOutstandingPaise +
        target.interestOutstandingPaise +
        target.principalOutstandingPaise +
        target.feeOutstandingPaise,
      0n,
    );

    if (result.totalAllocatedPaise === totalOutstanding) return 'FULL_PAYMENT';

    if (
      result.penaltyPaise > 0n &&
      result.interestPaise === 0n &&
      result.principalPaise === 0n &&
      result.feesPaise === 0n
    ) {
      return 'PENALTY_ONLY';
    }

    return 'PARTIAL_PAYMENT';
  }

  /**
   * A digest of the parts of a request that make it a distinct payment.
   *
   * `notes` and `deviceId` are excluded deliberately: a corrected typo in a
   * note is not "a materially different payment request" (Rule 9), and
   * treating it as one would refuse an honest retry.
   */
  private fingerprintOf(dto: PostCollectionDto): string {
    const canonical = JSON.stringify({
      amountPaise: dto.amountPaise,
      collectionDate: dto.collectionDate,
      loanId: dto.loanId,
      paymentMode: dto.paymentMode,
      transactionReference: dto.transactionReference ?? null,
    });

    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * The authoritative row for a request that may already have been posted.
   *
   * Matched on the idempotency key, and for an offline sync on the device's
   * transaction id as well — a device that lost the response retries with
   * both, and either is enough to recognise it (Scenario 42).
   */
  private async findReplay(
    orgId: string,
    idempotencyKey: string,
    offlineTransactionUuid: string | null,
  ) {
    return this.prisma.collection.findFirst({
      where: {
        orgId,
        status: { in: ['POSTED', 'REVERSED'] },
        ...(offlineTransactionUuid
          ? { OR: [{ idempotencyKey }, { offlineTransactionUuid }] }
          : { idempotencyKey }),
      },
      include: COLLECTION_INCLUDE,
    });
  }

  private assertVersion(
    actual: Date,
    expectedVersion: string,
    actor: AuthContext,
    meta: RequestMeta,
    collectionId: string,
  ): void {
    const expected = new Date(expectedVersion);

    if (
      Number.isNaN(expected.getTime()) ||
      actual.getTime() !== expected.getTime()
    ) {
      void this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.COLLECTION_CONCURRENT_ATTEMPT_REJECTED,
          entityType: 'COLLECTION',
          entityId: collectionId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            expectedVersion,
            actualVersion: actual.toISOString(),
          },
        })
        .catch(() => {});

      throw new ConflictException(STALE);
    }
  }

  private async auditBlocked(
    actor: AuthContext,
    loanId: string,
    meta: RequestMeta,
    blockerKeys: string[],
  ): Promise<void> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.COLLECTION_BLOCKED,
      entityType: 'LOAN',
      entityId: loanId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { blockers: blockerKeys },
    });
  }

  /**
   * A DATE-only value, parsed at Kolkata midday.
   *
   * Midday rather than midnight so no timezone shift can move the date across a
   * day boundary — the same reasoning `kolkataDate` in the schedule service
   * documents.
   */
  private civilDate(value: string): Date {
    return new Date(`${value}T12:00:00+05:30`);
  }

  /**
   * Whether an error is a unique-constraint violation on a given column.
   *
   * Matches on the message as well as the code because `meta.target` is
   * unreliable under Prisma 7 with the pg adapter — the same reason
   * `isUniqueViolation` in the schedule service does.
   */
  private isUniqueViolation(error: unknown, column: string): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as { code?: unknown; message?: unknown };
    if (candidate.code !== 'P2002') return false;
    const message =
      typeof candidate.message === 'string' ? candidate.message : '';
    return message.includes(column);
  }
}
