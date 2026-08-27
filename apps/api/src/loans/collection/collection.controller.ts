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
  AllocationPreview,
  CollectionDetail,
  CollectionReadiness,
  CollectionSummary,
  LedgerEntryDetail,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  COLLECTIONS_POST_PERMISSION,
  COLLECTIONS_REVERSE_PERMISSION,
  COLLECTIONS_SYNC_PERMISSION,
  COLLECTIONS_VIEW_PERMISSION,
  CollectionService,
} from './collection.service';
import {
  ListCollectionsDto,
  PostCollectionDto,
  PreviewAllocationDto,
  ReverseCollectionDto,
  SyncCollectionDto,
} from './dto/collection.dto';

/**
 * Module 11 — EMI collection.
 *
 * # Route order is load-bearing
 *
 * Every literal segment — `readiness`, `preview-allocation`, `sync` — is
 * declared before any `:collectionId` route. Nest matches in declaration order,
 * so a parameter route placed first would capture the literal and then fail
 * `ParseUUIDPipe` with a confusing 400. `app.e2e-spec.ts` asserts this
 * ordering, which is that file's whole purpose.
 *
 * # Permissions grant actions, not reach
 *
 * Confinement to the caller's organization and branch is the service's job —
 * `findInScope` on every path, 404 rather than 403. A Branch Admin holding
 * `collections.view` sees only their own branch, and there is deliberately no
 * request parameter through which that could be widened (Scenarios 1, 37-39).
 *
 * # Why reverse is its own permission
 *
 * Taking a payment and posting it is the branch's daily work. Reversing one
 * unwinds a committed financial posting and re-opens a settled obligation,
 * which is the approval authority's act — the same split as
 * `disbursements.confirm`. The seed grants `post` to a Branch Admin and
 * withholds `reverse`, which is what Scenario 36 asserts.
 *
 * # There is no edit or delete route
 *
 * Not an omission. A posted collection is immutable (Rules 21, 22) and
 * financial records are retained (Rule 44); the `collections_append_only`
 * trigger refuses both at the database. An *unposted* collection exists only on
 * a device until it syncs, so there is nothing here to edit — see the service's
 * class comment on Scenario 24.
 *
 * # Throttling
 *
 * Posting is the tightest limit in the module. Not rate limiting for load —
 * idempotency already makes a retry safe — but a brake on a client stuck in a
 * retry loop against a money-moving endpoint.
 */
@Controller('loans/collections')
export class CollectionController {
  constructor(private readonly collections: CollectionService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /**
   * What a loan owes and whether it can be collected against.
   *
   * A literal segment, declared before `:collectionId` — see the class comment.
   * Advisory only: the same gates run authoritatively inside `post`.
   */
  @Get('readiness')
  @RequirePermissions(COLLECTIONS_VIEW_PERMISSION)
  readiness(
    @CurrentUser() user: AuthContext,
    @Query('loanId', new ParseUUIDPipe({ version: '4' })) loanId: string,
    @Req() req: Request,
  ): Promise<CollectionReadiness> {
    return this.collections.collectionReadiness(user, loanId, this.meta(req));
  }

  /**
   * What a given amount would settle (Scenarios 6, 7, 8).
   *
   * A POST because it carries a body, not because it changes anything — it
   * writes nothing, and `@HttpCode(200)` says so rather than implying a
   * creation.
   */
  @Post('preview-allocation')
  @HttpCode(200)
  @RequirePermissions(COLLECTIONS_VIEW_PERMISSION)
  previewAllocation(
    @CurrentUser() user: AuthContext,
    @Body() dto: PreviewAllocationDto,
    @Req() req: Request,
  ): Promise<AllocationPreview> {
    return this.collections.previewAllocation(user, dto, this.meta(req));
  }

  /**
   * Submit a collection captured offline (Scenarios 41-44).
   *
   * `@HttpCode(200)` rather than 201: a duplicate sync returns the collection
   * that already existed, and reporting "created" for a row this request did
   * not create would be a lie the client acts on.
   */
  @Post('sync')
  @HttpCode(200)
  @RequirePermissions(COLLECTIONS_SYNC_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  sync(
    @CurrentUser() user: AuthContext,
    @Body() dto: SyncCollectionDto,
    @Req() req: Request,
  ): Promise<CollectionDetail> {
    return this.collections.sync(user, dto, this.meta(req));
  }

  @Get()
  @RequirePermissions(COLLECTIONS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListCollectionsDto,
    @Req() req: Request,
  ): Promise<{ collections: CollectionSummary[]; total: number }> {
    const { items, total } = await this.collections.list(
      user,
      query,
      this.meta(req),
    );
    return { collections: items, total };
  }

  /**
   * Record and post a collection (Scenarios 5, 12, 19, 20).
   *
   * `@HttpCode(200)` rather than 201 for the same reason as `sync`: a retry
   * with the same idempotency key returns the original posting, and that is a
   * success rather than a creation (Scenario 13).
   */
  @Post()
  @HttpCode(200)
  @RequirePermissions(COLLECTIONS_POST_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  post(
    @CurrentUser() user: AuthContext,
    @Body() dto: PostCollectionDto,
    @Req() req: Request,
  ): Promise<CollectionDetail> {
    return this.collections.post(user, dto, this.meta(req));
  }

  @Get(':collectionId')
  @RequirePermissions(COLLECTIONS_VIEW_PERMISSION)
  detail(
    @CurrentUser() user: AuthContext,
    @Param('collectionId', new ParseUUIDPipe({ version: '4' }))
    collectionId: string,
    @Req() req: Request,
  ): Promise<CollectionDetail> {
    return this.collections.getDetail(user, collectionId, this.meta(req));
  }

  /** The posted double entry behind a collection (Scenario 3). */
  @Get(':collectionId/ledger')
  @RequirePermissions(COLLECTIONS_VIEW_PERMISSION)
  ledger(
    @CurrentUser() user: AuthContext,
    @Param('collectionId', new ParseUUIDPipe({ version: '4' }))
    collectionId: string,
    @Req() req: Request,
  ): Promise<LedgerEntryDetail> {
    return this.collections.getLedger(user, collectionId, this.meta(req));
  }

  /** Reverse a posted collection (Scenarios 31-34). */
  @Post(':collectionId/reverse')
  @HttpCode(200)
  @RequirePermissions(COLLECTIONS_REVERSE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reverse(
    @CurrentUser() user: AuthContext,
    @Param('collectionId', new ParseUUIDPipe({ version: '4' }))
    collectionId: string,
    @Body() dto: ReverseCollectionDto,
    @Req() req: Request,
  ): Promise<CollectionDetail> {
    return this.collections.reverse(user, collectionId, dto, this.meta(req));
  }
}

/**
 * The loan-keyed collection history.
 *
 * A second controller because the path is `loans/:loanId/collections`, which
 * cannot live on `@Controller('loans/collections')`. It must be registered
 * **after** `CollectionController` in `loans.module.ts`, so that the literal
 * two-segment prefix `loans/collections` is matched before `loans/:loanId`
 * — otherwise `/loans/collections` binds `collections` as a loanId.
 */
@Controller('loans')
export class LoanCollectionController {
  constructor(private readonly collections: CollectionService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  @Get(':loanId/collections')
  @RequirePermissions(COLLECTIONS_VIEW_PERMISSION)
  async forLoan(
    @CurrentUser() user: AuthContext,
    @Param('loanId', new ParseUUIDPipe({ version: '4' })) loanId: string,
    @Req() req: Request,
  ): Promise<{ collections: CollectionSummary[] }> {
    const collections = await this.collections.listForLoan(
      user,
      loanId,
      this.meta(req),
    );
    return { collections };
  }
}
