import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  JournalDetail,
  JournalSummary,
  JournalValidation,
} from '@lms/types';
import type { Request } from 'express';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  JOURNALS_CREATE_PERMISSION,
  JOURNALS_POST_PERMISSION,
  JOURNALS_REVERSE_PERMISSION,
  JOURNALS_VIEW_PERMISSION,
  JournalService,
} from './journal.service';
import {
  CreateJournalDto,
  ListJournalsDto,
  PostJournalDto,
  ReverseJournalDto,
  UpdateJournalDto,
  ValidateJournalDto,
} from './dto/journal.dto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Manual journals, posting and reversal.
 *
 * # Route order
 *
 * `validate` is declared before `:journalEntryId`. Nest matches in declaration
 * order, so the reverse would bind the literal `validate` as a uuid parameter
 * and answer 400 for a route that exists. `app.e2e-spec.ts` asserts this class
 * of bug.
 *
 * # Why post and reverse take a header rather than a body field
 *
 * Creating a draft carries its idempotency key in the body, because the key
 * belongs to the thing being created. Posting and reversing act on an entity
 * that already exists, so the natural key is per-attempt and belongs to the
 * request — which is what an `Idempotency-Key` header is. Rule 16 requires one
 * for money-moving operations, and posting a journal is exactly that.
 */
@Controller('accounting/journals')
export class JournalController {
  constructor(private readonly journals: JournalService) {}

  @Get()
  @RequirePermissions(JOURNALS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListJournalsDto,
  ): Promise<{ journals: JournalSummary[]; total: number }> {
    const { items, total } = await this.journals.list(user, query);
    return { journals: items, total };
  }

  /**
   * A check, not a creation — hence 200 rather than 201, and hence the `view`
   * permission rather than `create`: nothing is written, so being able to ask
   * "would this post?" is a reading act.
   */
  @Post('validate')
  @HttpCode(200)
  @RequirePermissions(JOURNALS_VIEW_PERMISSION)
  async validate(
    @CurrentUser() user: AuthContext,
    @Body() dto: ValidateJournalDto,
  ): Promise<{ validation: JournalValidation }> {
    return { validation: await this.journals.validate(user, dto) };
  }

  /**
   * `@HttpCode(200)`, not 201.
   *
   * A replayed request returns the draft that already exists, and answering 201
   * for something that was not created this time would misdescribe it. The same
   * reasoning `POST /loans/collections` documents.
   */
  @Post()
  @HttpCode(200)
  @RequirePermissions(JOURNALS_CREATE_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateJournalDto,
    @Req() req: Request,
  ): Promise<{ journal: JournalDetail }> {
    return { journal: await this.journals.create(user, dto, this.meta(req)) };
  }

  @Get(':journalEntryId')
  @RequirePermissions(JOURNALS_VIEW_PERMISSION)
  async get(
    @CurrentUser() user: AuthContext,
    @Param('journalEntryId', new ParseUUIDPipe({ version: '4' }))
    journalEntryId: string,
  ): Promise<{ journal: JournalDetail }> {
    return { journal: await this.journals.get(user, journalEntryId) };
  }

  @Patch(':journalEntryId')
  @RequirePermissions(JOURNALS_CREATE_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('journalEntryId', new ParseUUIDPipe({ version: '4' }))
    journalEntryId: string,
    @Body() dto: UpdateJournalDto,
    @Req() req: Request,
  ): Promise<{ journal: JournalDetail }> {
    return {
      journal: await this.journals.update(
        user,
        journalEntryId,
        dto,
        this.meta(req),
      ),
    };
  }

  @Delete(':journalEntryId')
  @HttpCode(200)
  @RequirePermissions(JOURNALS_CREATE_PERMISSION)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('journalEntryId', new ParseUUIDPipe({ version: '4' }))
    journalEntryId: string,
    @Req() req: Request,
  ): Promise<{ journalEntryId: string; deleted: true }> {
    return this.journals.remove(user, journalEntryId, this.meta(req));
  }

  /**
   * The act that moves money.
   *
   * A separate permission from `create` on purpose: Rule 28 restricts manual
   * journals to explicitly authorized roles, and Scenario 44 needs an account
   * that can author a draft and is refused the posting.
   */
  @Post(':journalEntryId/post')
  @HttpCode(200)
  @RequirePermissions(JOURNALS_POST_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async post(
    @CurrentUser() user: AuthContext,
    @Param('journalEntryId', new ParseUUIDPipe({ version: '4' }))
    journalEntryId: string,
    @Body() dto: PostJournalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ): Promise<{ journal: JournalDetail }> {
    return {
      journal: await this.journals.post(
        user,
        journalEntryId,
        dto,
        this.requireIdempotencyKey(idempotencyKey),
        this.meta(req),
      ),
    };
  }

  /**
   * Returns the **new reversal entry**, not the original.
   *
   * Scenario 39's caller needs the new entry's number; the original is one
   * field away as `originalEntryNumber`.
   */
  @Post(':journalEntryId/reverse')
  @HttpCode(200)
  @RequirePermissions(JOURNALS_REVERSE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async reverse(
    @CurrentUser() user: AuthContext,
    @Param('journalEntryId', new ParseUUIDPipe({ version: '4' }))
    journalEntryId: string,
    @Body() dto: ReverseJournalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ): Promise<{ journal: JournalDetail }> {
    return {
      journal: await this.journals.reverse(
        user,
        journalEntryId,
        dto,
        this.requireIdempotencyKey(idempotencyKey),
        this.meta(req),
      ),
    };
  }

  /**
   * Rule 16: a money-posting operation requires an idempotency key.
   *
   * Validated here rather than in a DTO because it is a header, and a missing
   * or malformed one is a 400 — a retry without a key cannot be recognised as
   * a retry, so accepting it would risk the duplicate posting the key exists to
   * prevent.
   */
  private requireIdempotencyKey(value: string | undefined): string {
    if (!value || !UUID_PATTERN.test(value)) {
      throw new BadRequestException(
        'An Idempotency-Key header containing a UUID is required for this operation.',
      );
    }
    return value;
  }

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }
}
