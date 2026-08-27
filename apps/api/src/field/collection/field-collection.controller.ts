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
import type {
  FieldCollectionDetail,
  FieldCollectionListResult,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  ListFieldCollectionsDto,
  RecordFieldCollectionDto,
  SyncFieldCollectionDto,
  VerifyCollectionDto,
} from './dto/field-collection.dto';
import {
  FIELD_COLLECTIONS_RECORD_PERMISSION,
  FIELD_COLLECTIONS_VERIFY_PERMISSION,
  FIELD_COLLECTIONS_VIEW_PERMISSION,
  FieldCollectionService,
} from './field-collection.service';

/**
 * Module 12 — field collections.
 *
 * # Why POST returns 200, not 201
 *
 * A retry with the same idempotency key returns the collection that already
 * exists. A 201 would claim something was created when nothing was, and a
 * client distinguishing the two on status code would be wrong exactly when it
 * mattered. Module 11 does the same, for the same reason.
 *
 * # Route order
 *
 * `sync` before `:collectionId`, or a POST to `/field/collections/sync` would
 * match the parameter route and try to verify a collection whose id is the
 * literal string "sync". The API's own e2e spec asserts this ordering across
 * every controller.
 *
 * # No edit route, no delete route
 *
 * A posted collection is immutable (Scenario 32) and cannot be deleted
 * (Scenario 34); `collections_append_only` enforces both. `verify` is not an
 * edit — it records a review decision and touches no financial column.
 */
@Controller('field/collections')
export class FieldCollectionController {
  constructor(private readonly collections: FieldCollectionService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /**
   * Post a collection captured offline.
   *
   * Literal route, declared before `:collectionId` below.
   */
  @Post('sync')
  @HttpCode(200)
  @RequirePermissions(FIELD_COLLECTIONS_RECORD_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  sync(
    @CurrentUser() user: AuthContext,
    @Body() dto: SyncFieldCollectionDto,
    @Req() req: Request,
  ): Promise<FieldCollectionDetail> {
    return this.collections.sync(user, dto, this.meta(req));
  }

  @Get()
  @RequirePermissions(FIELD_COLLECTIONS_VIEW_PERMISSION)
  list(
    @CurrentUser() user: AuthContext,
    @Query() dto: ListFieldCollectionsDto,
    @Req() req: Request,
  ): Promise<FieldCollectionListResult> {
    return this.collections.list(user, dto, this.meta(req));
  }

  /** Record a collection taken in the field, online. */
  @Post()
  @HttpCode(200)
  @RequirePermissions(FIELD_COLLECTIONS_RECORD_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  record(
    @CurrentUser() user: AuthContext,
    @Body() dto: RecordFieldCollectionDto,
    @Req() req: Request,
  ): Promise<FieldCollectionDetail> {
    return this.collections.record(user, dto, this.meta(req));
  }

  @Get(':collectionId')
  @RequirePermissions(FIELD_COLLECTIONS_VIEW_PERMISSION)
  detail(
    @CurrentUser() user: AuthContext,
    @Param('collectionId', new ParseUUIDPipe({ version: '4' }))
    collectionId: string,
    @Req() req: Request,
  ): Promise<FieldCollectionDetail> {
    return this.collections.getDetail(user, collectionId, this.meta(req));
  }

  /**
   * Confirm or reject a collection captured offline.
   *
   * Held by supervisors, not agents: an agent who could confirm their own
   * capture could launder a fabricated one.
   */
  @Post(':collectionId/verify')
  @HttpCode(200)
  @RequirePermissions(FIELD_COLLECTIONS_VERIFY_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verify(
    @CurrentUser() user: AuthContext,
    @Param('collectionId', new ParseUUIDPipe({ version: '4' }))
    collectionId: string,
    @Body() dto: VerifyCollectionDto,
    @Req() req: Request,
  ): Promise<FieldCollectionDetail> {
    return this.collections.verify(user, collectionId, dto, this.meta(req));
  }
}
