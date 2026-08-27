import { Injectable, NotFoundException } from '@nestjs/common';
import type { SyncItemStatus, SyncQueueListResult } from '@lms/types';

import type { Prisma } from '../../generated/prisma/client';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  EnqueueSyncItemDto,
  ListSyncItemsDto,
} from './dto/offline-sync.dto';

export const FIELD_COLLECTIONS_VIEW_PERMISSION = 'field.collections.view';
export const FIELD_COLLECTIONS_RECORD_PERMISSION = 'field.collections.record';

/**
 * Module 12 — the server's record of what devices are holding.
 *
 * # What this is, and what it is not
 *
 * This is **not** where an offline collection is posted — that is
 * `FieldCollectionService.sync`, which carries the full replay, fingerprint and
 * conflict machinery. This table records that a device *claims* to be holding
 * a capture, so an operator can see unflushed work and drive a retry.
 *
 * The distinction matters because the two have opposite trust properties. A
 * synced collection is authoritative the moment it posts. A queue item is a
 * device's assertion about its own state, and nothing financial turns on it.
 *
 * # Why a device queue is not built here
 *
 * This is a server-rendered admin application. Every route calls
 * `requirePermissions()`, which calls the API, so a page cannot render at all
 * without a network. A localStorage or IndexedDB queue in this app would be a
 * queue that could never be flushed from a page that could never load. The
 * honest surface is the one below: the server knows what a device says it has,
 * and an operator can act on it.
 *
 * A real device queue needs a PWA shell and belongs with the mobile client.
 * That is deferred, not forgotten.
 */
@Injectable()
export class OfflineSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records that a device is holding a capture.
   *
   * Idempotent for free: `@@unique([orgId, clientTransactionId])` means a
   * device re-reporting the same item updates rather than duplicating. A device
   * that lost a response and re-reports must not produce two queue rows for one
   * capture — the operator would then chase a phantom.
   */
  async enqueue(
    actor: AuthContext,
    dto: EnqueueSyncItemDto,
    meta: RequestMeta,
  ): Promise<{ syncItemId: string; status: SyncItemStatus }> {
    // Prisma's `Json` input type is a recursive union that a bare
    // `Record<string, unknown>` does not satisfy. The DTO has already proved
    // this is an object; the cast is at the boundary rather than in the type,
    // so the validation stays the thing that guarantees the shape.
    const payload = dto.payload as Prisma.InputJsonValue;

    const row = await this.prisma.offlineSyncItem.upsert({
      where: {
        orgId_clientTransactionId: {
          orgId: actor.orgId,
          clientTransactionId: dto.clientTransactionId,
        },
      },
      create: {
        orgId: actor.orgId,
        userId: actor.userId,
        clientTransactionId: dto.clientTransactionId,
        entityType: dto.entityType,
        payload: payload,
        status: 'QUEUED',
        queuedAt: new Date(dto.queuedAt),
      },
      // Deliberately narrow. A re-report refreshes what the device says it is
      // holding; it never resets `attemptCount`, because the retry history is
      // what tells an operator an item is stuck rather than merely new.
      update: {
        payload: payload,
        ...(dto.queuedAt ? { queuedAt: new Date(dto.queuedAt) } : {}),
      },
      select: { syncItemId: true, status: true },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.SYNC_ITEM_QUEUED,
      entityType: 'OFFLINE_SYNC_ITEM',
      entityId: row.syncItemId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        clientTransactionId: dto.clientTransactionId,
        entityType: dto.entityType,
      },
    });

    return { syncItemId: row.syncItemId, status: row.status };
  }

  /**
   * The unflushed work list.
   *
   * Scoped to the caller's own items unless they can review captures: an agent
   * sees their own device's queue, a supervisor sees the branch's.
   */
  async list(
    actor: AuthContext,
    dto: ListSyncItemsDto,
    meta: RequestMeta,
  ): Promise<SyncQueueListResult> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const confined = !actor.permissions.includes('field.collections.verify');

    const where = {
      orgId: actor.orgId,
      ...(confined ? { userId: actor.userId } : {}),
      ...(dto.status ? { status: dto.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.offlineSyncItem.findMany({
        where,
        include: { user: { select: { name: true } } },
        orderBy: [{ queuedAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.offlineSyncItem.count({ where }),
    ]);

    // Audited like every other read in this module. A queue listing shows which
    // agents are carrying unflushed captures, which is exactly the kind of
    // question an audit trail is for (Rule 45).
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.SYNC_QUEUE_LISTED,
      entityType: 'OFFLINE_SYNC_ITEM',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { total, confinedToOwn: confined },
    });

    return {
      items: rows.map((row) => ({
        syncItemId: row.syncItemId,
        clientTransactionId: row.clientTransactionId,
        userId: row.userId,
        ...(row.user ? { userName: row.user.name } : {}),
        entityType: row.entityType,
        ...(row.entityId ? { entityId: row.entityId } : {}),
        status: row.status,
        attemptCount: row.attemptCount,
        ...(row.lastError ? { lastError: row.lastError } : {}),
        queuedAt: row.queuedAt.toISOString(),
        ...(row.syncedAt ? { syncedAt: row.syncedAt.toISOString() } : {}),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Marks an item as having succeeded, with the row it produced.
   *
   * Called by the sync path after a collection posts, so the queue reflects
   * what actually happened rather than what a device believes.
   */
  async markSynced(
    orgId: string,
    clientTransactionId: string,
    entityId: string,
  ): Promise<void> {
    await this.prisma.offlineSyncItem.updateMany({
      where: { orgId, clientTransactionId },
      data: { status: 'SYNCED', entityId, syncedAt: new Date() },
    });
  }

  /**
   * Records that a sync attempt conflicted or failed.
   *
   * Gives Scenario 16's "the conflict is audit logged" a **queryable row** as
   * well as an audit line, which is what makes the "Retry Failed Sync" action
   * have something to act on.
   *
   * `attemptCount` increments rather than being set, so an item retried five
   * times is visibly different from one that failed once — the difference
   * between a transient network problem and a capture that will never post.
   */
  async markFailed(
    actor: AuthContext,
    clientTransactionId: string,
    status: 'FAILED' | 'CONFLICT',
    reason: string,
    meta: RequestMeta,
  ): Promise<void> {
    const row = await this.prisma.offlineSyncItem.findFirst({
      where: { orgId: actor.orgId, clientTransactionId },
      select: { syncItemId: true },
    });

    if (!row) return;

    await this.prisma.offlineSyncItem.update({
      where: {
        orgId_syncItemId: {
          orgId: actor.orgId,
          syncItemId: row.syncItemId,
        },
      },
      data: {
        status,
        lastError: reason.slice(0, 1000),
        attemptCount: { increment: 1 },
      },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action:
        status === 'CONFLICT'
          ? AuditAction.SYNC_ITEM_CONFLICT
          : AuditAction.SYNC_ITEM_FAILED,
      entityType: 'OFFLINE_SYNC_ITEM',
      entityId: row.syncItemId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { clientTransactionId, reason },
    });
  }

  /**
   * Re-queues a failed item so a device or operator can try again.
   *
   * Deliberately does **not** re-post the collection itself. The payload was
   * captured by a device and this service does not trust it as a posting
   * request — replaying it here would bypass the DTO validation, the scope
   * checks and the eligibility gates that `FieldCollectionService.sync` applies.
   * Re-queuing signals "try this again"; the device or operator then submits it
   * through the sync endpoint, where all of that runs.
   */
  async retry(
    actor: AuthContext,
    syncItemId: string,
    meta: RequestMeta,
  ): Promise<{ syncItemId: string; status: SyncItemStatus }> {
    const row = await this.prisma.offlineSyncItem.findFirst({
      where: { orgId: actor.orgId, syncItemId },
      select: { syncItemId: true, status: true },
    });

    if (!row) throw new NotFoundException('Sync item not found');

    const updated = await this.prisma.offlineSyncItem.update({
      where: {
        orgId_syncItemId: { orgId: actor.orgId, syncItemId },
      },
      data: { status: 'QUEUED', lastError: null },
      select: { syncItemId: true, status: true },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.SYNC_ITEM_RETRIED,
      entityType: 'OFFLINE_SYNC_ITEM',
      entityId: syncItemId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      oldData: { status: row.status },
      newData: { status: 'QUEUED' },
    });

    return {
      syncItemId: updated.syncItemId,
      status: updated.status,
    };
  }
}
