import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { formatIsoDate, todayInKolkata } from '@lms/emi';
import type {
  CashHandoverDetail,
  CashHandoverListResult,
  CashHandoverReadiness,
  CashHandoverBlocker,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../../loans/disbursal/ledger.service';
import { CashCustodyService } from './cash-custody.service';
import { nextHandoverNumber } from './cash-numbering';
import {
  CASH_HANDOVER_INCLUDE,
  toCashHandoverDetail,
  toCashHandoverSummary,
  type CashHandoverRow,
} from './cash-handover.mapper';
import type {
  CreateCashHandoverDto,
  ListCashHandoversDto,
  ReceiveCashHandoverDto,
  ReverseCashHandoverDto,
  SubmitCashHandoverDto,
} from './dto/cash-handover.dto';

export const CASH_HANDOVERS_VIEW_PERMISSION = 'cash.handovers.view';
export const CASH_HANDOVERS_SUBMIT_PERMISSION = 'cash.handovers.submit';
export const CASH_HANDOVERS_RECEIVE_PERMISSION = 'cash.handovers.receive';
export const CASH_HANDOVERS_REVERSE_PERMISSION = 'cash.handovers.reverse';

const NOT_REACHABLE = 'Cash handover not found';
const STALE =
  'This handover has changed since you opened it. Reload and try again.';

/**
 * Module 12 — cash handover.
 *
 * # What makes receiving cash safe
 *
 * Four things, in this order, inside one transaction:
 *
 *  1. **A guarded claim on the collections themselves.** This is the one that
 *     matters. Two users receiving the same agent's cash contend on the
 *     collection rows, not on the handover — see `CashCustodyService.claim`.
 *     There is no window in which both succeed (Scenario 49).
 *  2. **The balance re-derived inside the transaction**, against rows the claim
 *     has locked. A balance read outside and trusted inside is a balance that
 *     can be stale at the only moment it matters (Scenario 25).
 *  3. **The ledger entry**, before the row is marked received.
 *  4. **A guarded status claim carrying the journal id**, so the row is never
 *     RECEIVED without its entry — `status` and `updatedAt` in the WHERE make a
 *     concurrent receive or a stale form lose (Scenarios 33, 50).
 *
 * Steps 3 and 4 are in that order because `cash_handovers_received_is_complete`
 * refuses a RECEIVED row with a null `journal_entry_id`, and Postgres evaluates
 * a CHECK per statement. Marking the row first and filling the id afterwards
 * puts it momentarily in the state that constraint exists to forbid. Everything
 * still rolls back together, so a refusal anywhere leaves no journal behind.
 *
 * # Two idempotency keys
 *
 * Creating a handover and receiving one are two money-adjacent acts on one row,
 * and each needs its own retry identity. The create key is a body field, minted
 * by the agent's form; the receive key is an `Idempotency-Key` header, because
 * it identifies a retry of an operation against a row that already exists. That
 * is the split Modules 09/11 and Module 14 already draw between them.
 *
 * # What is deliberately not here
 *
 * **No amount is editable after creation.** The balance check and the custody
 * claim must run against one number; letting it change at submit would mean one
 * gate ran against one figure and the claim against another.
 *
 * **No delete endpoint.** `cash_handovers_append_only` refuses a delete on
 * anything past CREATED, and the custody trail is retained (Rules 28, 29).
 */
@Injectable()
export class CashHandoverService {
  private readonly logger = new Logger(CashHandoverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly custody: CashCustodyService,
    private readonly ledger: LedgerService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * The scope every read applies.
   *
   * Branch, as everywhere. Plus the agent's own confinement: a caller who
   * cannot receive cash is an agent, and sees only their own handovers.
   * Deciding on the permission rather than the role means a custom role behaves
   * predictably without a code change.
   */
  private scopeWhere(actor: AuthContext) {
    return {
      orgId: actor.orgId,
      ...(actor.branchId ? { branchId: actor.branchId } : {}),
      ...(actor.permissions.includes(CASH_HANDOVERS_RECEIVE_PERMISSION)
        ? {}
        : { fieldAgentId: actor.userId }),
    };
  }

  async list(
    actor: AuthContext,
    dto: ListCashHandoversDto,
    meta: RequestMeta,
  ): Promise<CashHandoverListResult> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const where = {
      ...this.scopeWhere(actor),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.fromDate || dto.toDate
        ? {
            businessDate: {
              ...(dto.fromDate ? { gte: this.civilDate(dto.fromDate) } : {}),
              ...(dto.toDate ? { lte: this.civilDate(dto.toDate) } : {}),
            },
          }
        : {}),
      ...(dto.search
        ? {
            handoverNumber: {
              contains: dto.search,
              mode: 'insensitive' as const,
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.cashHandover.findMany({
        where,
        include: CASH_HANDOVER_INCLUDE,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.cashHandover.count({ where }),
    ]);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CASH_HANDOVER_LISTED,
      entityType: 'CASH_HANDOVER',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { total },
    });

    return {
      items: rows.map((row) =>
        toCashHandoverSummary(row as unknown as CashHandoverRow),
      ),
      total,
      page,
      pageSize,
    };
  }

  /** A handover the caller may reach, or a 404 — never a 403 (Scenario 46). */
  private async findInScope(
    actor: AuthContext,
    handoverId: string,
    meta: RequestMeta,
  ): Promise<CashHandoverRow> {
    const row = await this.prisma.cashHandover.findFirst({
      where: { ...this.scopeWhere(actor), handoverId },
      include: CASH_HANDOVER_INCLUDE,
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CASH_HANDOVER_SCOPE_DENIED,
        entityType: 'CASH_HANDOVER',
        entityId: handoverId,
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
    handoverId: string,
    meta: RequestMeta,
  ): Promise<CashHandoverDetail> {
    const row = await this.findInScope(actor, handoverId, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CASH_HANDOVER_VIEWED,
      entityType: 'CASH_HANDOVER',
      entityId: handoverId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toCashHandoverDetail(row);
  }

  /**
   * Whether the caller can hand over cash right now, and of what.
   *
   * Advisory, in the way `CollectionReadiness` is: the same checks run
   * authoritatively inside the create and receive transactions against a
   * re-derived balance. This exists so the form can refuse early and explain
   * why, not so a mutation can trust it.
   */
  async readiness(
    actor: AuthContext,
    meta: RequestMeta,
  ): Promise<CashHandoverReadiness> {
    const agent = await this.prisma.user.findFirst({
      where: { orgId: actor.orgId, userId: actor.userId },
      select: { name: true, branchId: true },
    });

    const unclaimed = await this.custody.unclaimedCollections(
      this.prisma,
      actor.orgId,
      actor.userId,
    );
    const expected = unclaimed.reduce((sum, row) => sum + row.amountPaise, 0n);

    const blockers: CashHandoverBlocker[] = [];

    if (expected === 0n) {
      blockers.push({
        key: 'NO_CASH_IN_HAND',
        reason: 'You are not holding any collected cash to hand over.',
      });
    }

    const open = await this.prisma.cashHandover.findFirst({
      where: {
        orgId: actor.orgId,
        fieldAgentId: actor.userId,
        status: { in: ['CREATED', 'SUBMITTED'] },
      },
      select: { handoverNumber: true },
    });

    if (open) {
      // One open handover at a time. Two drafts against the same pool would
      // both pass their own balance check and then contend on the claim, which
      // is a confusing way to discover the second was never possible.
      blockers.push({
        key: 'HANDOVER_ALREADY_OPEN',
        reason: `Handover ${open.handoverNumber} is still open. Complete or cancel it first.`,
        details: { handoverNumber: open.handoverNumber },
      });
    }

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CASH_BALANCE_VIEWED,
      entityType: 'CASH_CUSTODY',
      entityId: actor.userId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      fieldAgentId: actor.userId,
      agentName: agent?.name ?? 'Unknown',
      branchId: agent?.branchId ?? '',
      canHandOver: blockers.length === 0,
      blockers,
      expectedCashPaise: expected.toString(),
      unclaimedCollections: [],
      handoverableAmounts: this.custody
        .handoverableAmounts(unclaimed)
        .map((amount) => amount.toString()),
    };
  }

  // -------------------------------------------------------------------------
  // Create and submit
  // -------------------------------------------------------------------------

  /**
   * Creates a draft handover.
   *
   * The amount must equal the sum of an oldest-first prefix of the agent's
   * unclaimed collections. See `CashCustodyService` for why cash leaves the
   * pool by whole rows being claimed rather than by an amount being subtracted.
   */
  async create(
    actor: AuthContext,
    dto: CreateCashHandoverDto,
    meta: RequestMeta,
  ): Promise<CashHandoverDetail> {
    const fingerprint = this.fingerprintOf(dto);

    // Replay before the gates, for the reason Module 11 documents: a retrying
    // client is replaying a request that already succeeded, and re-running
    // gates against a balance that has since moved would refuse it.
    const replay = await this.findReplay(actor.orgId, dto.idempotencyKey);
    if (replay) {
      if (replay.requestFingerprint !== fingerprint) {
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.CASH_HANDOVER_IDEMPOTENCY_CONFLICT,
          entityType: 'CASH_HANDOVER',
          entityId: replay.handoverId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            idempotencyKey: dto.idempotencyKey,
            storedRequestFingerprint: replay.requestFingerprint,
            submittedRequestFingerprint: fingerprint,
          },
        });

        throw new ConflictException({
          message:
            'That idempotency key was already used for a different handover. The original is unchanged.',
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          handoverId: replay.handoverId,
        });
      }

      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CASH_HANDOVER_DUPLICATE_IGNORED,
        entityType: 'CASH_HANDOVER',
        entityId: replay.handoverId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return this.getDetail(actor, replay.handoverId, meta);
    }

    const amountPaise = BigInt(dto.handedOverCashPaise);

    const handoverId = await this.prisma.$transaction(async (tx) => {
      const agent = await tx.user.findFirst({
        where: { orgId: actor.orgId, userId: actor.userId },
        select: {
          name: true,
          branchId: true,
          branch: { select: { code: true, status: true } },
        },
      });

      // The branch is the agent's own, never the client's (Scenarios 46, 48).
      if (!agent?.branchId || !agent.branch) {
        throw new ConflictException(
          'You are not assigned to a branch and cannot hand over cash.',
        );
      }

      if (agent.branch.status !== 'ACTIVE') {
        throw new ConflictException({
          message: 'This branch is inactive and cannot receive cash.',
          blockers: [
            { key: 'BRANCH_INACTIVE', reason: 'This branch is inactive.' },
          ],
        });
      }

      const unclaimed = await this.custody.unclaimedCollections(
        tx,
        actor.orgId,
        actor.userId,
      );
      const expected = unclaimed.reduce(
        (sum, row) => sum + row.amountPaise,
        0n,
      );

      if (amountPaise > expected) {
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.CASH_HANDOVER_EXCEEDS_BALANCE,
          entityType: 'CASH_HANDOVER',
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            requestedPaise: amountPaise.toString(),
            expectedPaise: expected.toString(),
          },
        });

        // Scenario 25. No journal is posted and no draft is created.
        throw new ConflictException({
          message: `You are holding ${expected.toString()} paise. A handover cannot exceed it.`,
          code: 'AMOUNT_EXCEEDS_BALANCE',
          blockers: [
            {
              key: 'AMOUNT_EXCEEDS_BALANCE',
              reason: 'The amount exceeds the cash you are holding.',
              details: { expectedCashPaise: expected.toString() },
            },
          ],
        });
      }

      if (this.custody.selectCollectionsFor(amountPaise, unclaimed) === null) {
        throw new ConflictException({
          message:
            'A handover must cover whole collections, oldest first. Choose one of the offered amounts.',
          code: 'AMOUNT_NOT_A_PREFIX',
          blockers: [
            {
              key: 'AMOUNT_NOT_A_PREFIX',
              reason: 'The amount does not match a whole set of collections.',
              details: {
                handoverableAmounts: this.custody
                  .handoverableAmounts(unclaimed)
                  .map((value) => value.toString()),
              },
            },
          ],
        });
      }

      const handoverNumber = await nextHandoverNumber(
        tx,
        actor.orgId,
        agent.branch.code,
      );

      const created = await tx.cashHandover.create({
        data: {
          orgId: actor.orgId,
          handoverNumber,
          branchId: agent.branchId,
          fieldAgentId: actor.userId,
          // The server's Asia/Kolkata date. Client device time is not
          // authoritative for financial posting (Rules 14, 15), and no endpoint
          // accepts a business date, so backdating is not representable.
          businessDate: this.civilDate(formatIsoDate(todayInKolkata())),
          expectedCashPaise: expected,
          handedOverCashPaise: amountPaise,
          differencePaise: 0n,
          status: 'CREATED',
          idempotencyKey: dto.idempotencyKey,
          requestFingerprint: fingerprint,
          ...(dto.notes ? { notes: dto.notes } : {}),
          createdBy: actor.userId,
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CASH_HANDOVER_CREATED,
          entityType: 'CASH_HANDOVER',
          entityId: created.handoverId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            handoverNumber,
            handedOverCashPaise: amountPaise.toString(),
            expectedCashPaise: expected.toString(),
          },
        },
        tx,
      );

      return created.handoverId;
    });

    return this.getDetail(actor, handoverId, meta);
  }

  /** Submits a draft for the branch to receive. */
  async submit(
    actor: AuthContext,
    handoverId: string,
    dto: SubmitCashHandoverDto,
    meta: RequestMeta,
  ): Promise<CashHandoverDetail> {
    const before = await this.findInScope(actor, handoverId, meta);

    this.assertVersion(before.updatedAt, dto.expectedVersion);

    if (before.status !== 'CREATED') {
      throw new ConflictException('Only a draft handover can be submitted.');
    }

    await this.prisma.$transaction(async (tx) => {
      // Re-derive at submit: the agent may have collected more since drafting,
      // and the snapshot is what the branch will be shown.
      const expected = await this.custody.expectedCashPaise(
        tx,
        actor.orgId,
        before.fieldAgentId,
      );

      if (before.handedOverCashPaise > expected) {
        throw new ConflictException({
          message:
            'The cash you are holding has changed. Reload the handover and try again.',
          code: 'AMOUNT_EXCEEDS_BALANCE',
        });
      }

      const guard = await tx.cashHandover.updateMany({
        where: {
          orgId: actor.orgId,
          handoverId,
          status: 'CREATED',
          updatedAt: before.updatedAt,
        },
        data: {
          status: 'SUBMITTED',
          expectedCashPaise: expected,
          ...(dto.acknowledgmentReference
            ? { acknowledgmentReference: dto.acknowledgmentReference }
            : {}),
        },
      });

      if (guard.count === 0) throw new ConflictException(STALE);

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CASH_HANDOVER_SUBMITTED,
          entityType: 'CASH_HANDOVER',
          entityId: handoverId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: { status: 'CREATED' },
          newData: { status: 'SUBMITTED' },
        },
        tx,
      );
    });

    return this.getDetail(actor, handoverId, meta);
  }

  // -------------------------------------------------------------------------
  // Receive
  // -------------------------------------------------------------------------

  /**
   * Receives the cash at the branch — the act that moves custody
   * (Scenarios 23, 24).
   *
   * The four steps of the class comment, in order. The claim in step 2 is what
   * makes Scenario 49 structural: it is the exclusive lock, so no
   * `SELECT ... FOR UPDATE` and no agent-day row are needed.
   */
  async receive(
    actor: AuthContext,
    handoverId: string,
    dto: ReceiveCashHandoverDto,
    idempotencyKey: string,
    meta: RequestMeta,
  ): Promise<CashHandoverDetail> {
    const before = await this.findInScope(actor, handoverId, meta);

    // A retry of a receive that already succeeded replays as a success.
    if (before.receiveIdempotencyKey === idempotencyKey) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CASH_HANDOVER_DUPLICATE_IGNORED,
        entityType: 'CASH_HANDOVER',
        entityId: handoverId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { receiveIdempotencyKey: idempotencyKey },
      });

      return toCashHandoverDetail(before);
    }

    this.assertVersion(before.updatedAt, dto.expectedVersion);

    if (before.status !== 'SUBMITTED') {
      throw new ConflictException(
        before.status === 'RECEIVED' || before.status === 'RECONCILED'
          ? 'This handover has already been received.'
          : 'Only a submitted handover can be received.',
      );
    }

    const receivedPaise = BigInt(dto.receivedCashPaise);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Step 1. Which collections this handover carries, then the claim.
        //
        // The claim comes before the status change because it is the real
        // concurrency guard: two receives contend on these rows, not on the
        // handover. The loser's whole transaction rolls back, so nothing it did
        // above survives (Scenario 49).
        const unclaimed = await this.custody.unclaimedCollections(
          tx,
          actor.orgId,
          before.fieldAgentId,
        );

        const chosen = this.custody.selectCollectionsFor(
          before.handedOverCashPaise,
          unclaimed,
        );

        if (chosen === null) {
          // The pool changed under the handover — a collection was reversed, or
          // another handover claimed part of it between submit and receive.
          throw new ConflictException({
            message:
              'The cash behind this handover has changed. Reload and try again.',
            code: 'CASH_ALREADY_HANDED_OVER',
          });
        }

        await this.custody.claim(tx, actor.orgId, chosen, handoverId);

        // Step 2. Re-derive, inside the transaction, against the locked rows.
        // Scenario 25: an amount that exceeded the balance never reaches the
        // ledger, whatever the form believed when it was submitted.
        const remaining = await this.custody.expectedCashPaise(
          tx,
          actor.orgId,
          before.fieldAgentId,
        );

        if (remaining < 0n) {
          throw new ConflictException(
            'This handover would leave a negative cash balance. Nothing was received.',
          );
        }

        // Step 3. The custody transfer, posted **before** the row is marked
        // received.
        //
        // The ordering is forced by `cash_handovers_received_is_complete`,
        // which refuses a RECEIVED row whose `journal_entry_id` is null — the
        // database's way of saying Scenario 53's "not falsely marked received".
        // Writing the status first and the entry id afterwards leaves the row
        // momentarily in exactly the state that CHECK forbids, and Postgres
        // evaluates it per statement rather than at commit.
        //
        // So the entry is created first and its id goes into the same guarded
        // update that flips the status. This is the same inversion Module 11
        // documents for its collection posting, arrived at from the opposite
        // direction: there the trigger freezes the row afterwards, here the
        // constraint refuses it beforehand.
        const journalEntryId = await this.ledger.postCashHandover(tx, {
          orgId: actor.orgId,
          branchId: before.branchId,
          fieldAgentId: before.fieldAgentId,
          handoverId,
          handoverNumber: before.handoverNumber,
          agentName: before.fieldAgent?.name ?? 'Field agent',
          // The counted amount, not the declared one: the ledger records the
          // cash the branch actually took (Scenario 24).
          amountPaise: receivedPaise,
          entryDate: before.businessDate,
          createdBy: actor.userId,
        });

        // Step 4. The guarded status claim, carrying the journal id with it
        // (Scenarios 33, 50). One statement, so the row is never RECEIVED
        // without its entry.
        const guard = await tx.cashHandover.updateMany({
          where: {
            orgId: actor.orgId,
            handoverId,
            status: 'SUBMITTED',
            updatedAt: before.updatedAt,
          },
          data: {
            status: 'RECEIVED',
            receivedCashPaise: receivedPaise,
            differencePaise: receivedPaise - before.handedOverCashPaise,
            receivedBy: actor.userId,
            receivedAt: new Date(),
            receiveIdempotencyKey: idempotencyKey,
            journalEntryId,
            ...(dto.notes ? { notes: dto.notes } : {}),
          },
        });

        if (guard.count === 0) throw new ConflictException(STALE);

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.CASH_HANDOVER_RECEIVED,
            entityType: 'CASH_HANDOVER',
            entityId: handoverId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: { status: 'SUBMITTED' },
            newData: {
              status: 'RECEIVED',
              receivedCashPaise: receivedPaise.toString(),
              differencePaise: (
                receivedPaise - before.handedOverCashPaise
              ).toString(),
            },
            metadata: {
              handoverNumber: before.handoverNumber,
              claimedCollectionCount: chosen.length,
            },
          },
          tx,
        );

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.CASH_HANDOVER_LEDGER_POSTED,
            entityType: 'CASH_HANDOVER',
            entityId: handoverId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: { journalEntryId },
          },
          tx,
        );
      });
    } catch (error) {
      // Outside the rolled-back transaction, so the record of the failure
      // survives it — the same reason Module 11 audits its posting failures
      // here rather than inside (Scenario 53).
      await this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.CASH_HANDOVER_POSTING_FAILED,
          entityType: 'CASH_HANDOVER',
          entityId: handoverId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { reason: this.messageOf(error) },
        })
        .catch((auditError) => {
          this.logger.error(
            `Failed to audit cash handover failure: ${String(auditError)}`,
          );
        });

      throw error;
    }

    return this.getDetail(actor, handoverId, meta);
  }

  // -------------------------------------------------------------------------
  // Reverse
  // -------------------------------------------------------------------------

  /**
   * Reverses a received handover, returning the cash to the agent's custody.
   *
   * Releases the claim — which is what makes the agent's derived balance come
   * back on its own — and posts the opposite entry. The original entry's lines
   * are never touched.
   *
   * Refused when a reconciliation has already closed over the handover: the
   * counted figures would then describe cash that had moved back, and Rule 29
   * blocks a change whose downstream references exist.
   */
  async reverse(
    actor: AuthContext,
    handoverId: string,
    dto: ReverseCashHandoverDto,
    meta: RequestMeta,
  ): Promise<CashHandoverDetail> {
    const before = await this.findInScope(actor, handoverId, meta);

    this.assertVersion(before.updatedAt, dto.expectedVersion);

    if (before.status !== 'RECEIVED') {
      throw new ConflictException(
        before.status === 'REVERSED'
          ? 'This handover has already been reversed.'
          : 'Only a received handover can be reversed.',
      );
    }

    const closing = await this.prisma.cashReconciliation.findFirst({
      where: {
        orgId: actor.orgId,
        handoverId,
        status: { in: ['MATCHED', 'DISCREPANCY_PENDING', 'RESOLVED'] },
      },
      select: { reconciliationNumber: true },
    });

    if (closing) {
      throw new ConflictException({
        message: `Reconciliation ${closing.reconciliationNumber} covers this handover. It cannot be reversed.`,
        code: 'HANDOVER_RECONCILED',
        blockedBy: [
          {
            entity: 'CASH_RECONCILIATION',
            label: closing.reconciliationNumber,
            count: 1,
          },
        ],
      });
    }

    const reversalId = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.cashHandover.updateMany({
        where: {
          orgId: actor.orgId,
          handoverId,
          status: 'RECEIVED',
          updatedAt: before.updatedAt,
        },
        data: {
          status: 'REVERSED',
          reversalReason: dto.reversalReason,
          reversedAt: new Date(),
          reversedBy: actor.userId,
        },
      });

      if (guard.count === 0) throw new ConflictException(STALE);

      // The cash goes back into the agent's pool. One update, and the balance
      // moves on its own — the derivation needs no correcting entry.
      await this.custody.release(tx, actor.orgId, handoverId);

      const reversalHandoverId = randomUUID();

      const journalEntryId = await this.ledger.postCashHandoverReversal(tx, {
        orgId: actor.orgId,
        branchId: before.branchId,
        fieldAgentId: before.fieldAgentId,
        reversalHandoverId,
        originalHandoverNumber: before.handoverNumber,
        agentName: before.fieldAgent?.name ?? 'Field agent',
        amountPaise: before.receivedCashPaise ?? before.handedOverCashPaise,
        entryDate: before.businessDate,
        createdBy: actor.userId,
        reversalReason: dto.reversalReason,
      });

      // The mirror row. `@@unique([orgId, reversalOfHandoverId])` is what makes
      // a second reversal a database error rather than a check two concurrent
      // requests could both pass.
      await tx.cashHandover.create({
        data: {
          orgId: actor.orgId,
          handoverId: reversalHandoverId,
          handoverNumber: `${before.handoverNumber}-R`,
          branchId: before.branchId,
          fieldAgentId: before.fieldAgentId,
          businessDate: before.businessDate,
          expectedCashPaise: 0n,
          handedOverCashPaise:
            before.receivedCashPaise ?? before.handedOverCashPaise,
          receivedCashPaise:
            before.receivedCashPaise ?? before.handedOverCashPaise,
          differencePaise: 0n,
          status: 'REVERSED',
          reversalOfHandoverId: handoverId,
          reversalReason: dto.reversalReason,
          reversedAt: new Date(),
          reversedBy: actor.userId,
          receivedBy: actor.userId,
          receivedAt: new Date(),
          journalEntryId,
          idempotencyKey: `REVERSAL:${handoverId}`,
          createdBy: actor.userId,
        },
      });

      // The one column the journal append-only trigger permits.
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
          action: AuditAction.CASH_HANDOVER_REVERSED,
          entityType: 'CASH_HANDOVER',
          entityId: handoverId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: { status: 'RECEIVED' },
          newData: { status: 'REVERSED' },
          metadata: { reason: dto.reversalReason, reversalHandoverId },
        },
        tx,
      );

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CASH_HANDOVER_LEDGER_REVERSED,
          entityType: 'CASH_HANDOVER',
          entityId: reversalHandoverId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { journalEntryId },
        },
        tx,
      );

      return handoverId;
    });

    return this.getDetail(actor, reversalId, meta);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * The request digest, so a reused key with a different body is detectable.
   *
   * Excludes `notes` for the reason Module 11's does: a corrected typo in a
   * note is not a different handover.
   */
  private fingerprintOf(dto: CreateCashHandoverDto): string {
    return createHash('sha256')
      .update(JSON.stringify({ handedOverCashPaise: dto.handedOverCashPaise }))
      .digest('hex');
  }

  private async findReplay(
    orgId: string,
    idempotencyKey: string,
  ): Promise<{
    handoverId: string;
    requestFingerprint: string | null;
  } | null> {
    return this.prisma.cashHandover.findFirst({
      where: { orgId, idempotencyKey },
      select: { handoverId: true, requestFingerprint: true },
    });
  }

  private assertVersion(current: Date, expected: string): void {
    if (current.toISOString() !== expected) {
      throw new ConflictException(STALE);
    }
  }

  private messageOf(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  private civilDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }
}
