import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { SyncItemStatus, SyncQueueListResult } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { EnqueueSyncItemDto, ListSyncItemsDto } from './dto/offline-sync.dto';
import {
  FIELD_COLLECTIONS_RECORD_PERMISSION,
  FIELD_COLLECTIONS_VIEW_PERMISSION,
  OfflineSyncService,
} from './offline-sync.service';

/**
 * Module 12 — the offline sync queue.
 *
 * Nothing here posts money. These routes record and act on what a device says
 * it is holding; the capture itself posts through
 * `POST /field/collections/sync`, which carries the replay, fingerprint and
 * conflict machinery. Gating on the collection permissions rather than minting
 * new ones reflects that: a queue entry is a claim about a field collection,
 * and whoever may record one may report that they are holding one.
 */
@Controller('field/sync-items')
export class OfflineSyncController {
  constructor(private readonly sync: OfflineSyncService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  @Get()
  @RequirePermissions(FIELD_COLLECTIONS_VIEW_PERMISSION)
  list(
    @CurrentUser() user: AuthContext,
    @Query() dto: ListSyncItemsDto,
    @Req() req: Request,
  ): Promise<SyncQueueListResult> {
    return this.sync.list(user, dto, this.meta(req));
  }

  /**
   * Report that a device is holding a capture.
   *
   * 200 rather than 201: the unique client transaction id makes a re-report an
   * update, so a second call creates nothing.
   */
  @Post()
  @HttpCode(200)
  @RequirePermissions(FIELD_COLLECTIONS_RECORD_PERMISSION)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  enqueue(
    @CurrentUser() user: AuthContext,
    @Body() dto: EnqueueSyncItemDto,
    @Req() req: Request,
  ): Promise<{ syncItemId: string; status: SyncItemStatus }> {
    return this.sync.enqueue(user, dto, this.meta(req));
  }

  /** Re-queue a failed item so it can be submitted again. */
  @Post(':syncItemId/retry')
  @HttpCode(200)
  @RequirePermissions(FIELD_COLLECTIONS_RECORD_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  retry(
    @CurrentUser() user: AuthContext,
    @Param('syncItemId', new ParseUUIDPipe({ version: '4' }))
    syncItemId: string,
    @Req() req: Request,
  ): Promise<{ syncItemId: string; status: SyncItemStatus }> {
    return this.sync.retry(user, syncItemId, this.meta(req));
  }
}
