import { createHash } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  JournalDetail,
  JournalIssue,
  JournalSummary,
  JournalValidation,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { nextEntryNumber } from '../accounting-numbering';
import {
  type ActorNames,
  JOURNAL_INCLUDE,
  type JournalRow,
  toJournalDetail,
  toJournalSummary,
} from './journal.mapper';
import type {
  CreateJournalDto,
  JournalLineDto,
  ListJournalsDto,
  PostJournalDto,
  ReverseJournalDto,
  UpdateJournalDto,
  ValidateJournalDto,
} from './dto/journal.dto';

export const JOURNALS_VIEW_PERMISSION = 'accounting.journals.view';
export const JOURNALS_CREATE_PERMISSION = 'accounting.journals.create';
export const JOURNALS_POST_PERMISSION = 'accounting.journals.post';
export const JOURNALS_REVERSE_PERMISSION = 'accounting.journals.reverse';

/** One message whether the journal belongs to another scope or does not exist. */
const NOT_REACHABLE = 'Journal entry not found';

const STALE =
  'This journal has changed since you opened it. Reload and try again.';

/**
 * Manual journals and reversals (Module 14 Scenarios 12-18, 28-45, 57).
 *
 * # Where each rule is actually enforced
 *
 * This service produces messages an operator can act on. The database is what
 * guarantees the invariants, and the two are deliberately duplicated:
 *
 * | Rule                        | Here                 | Database                      |
 * |-----------------------------|----------------------|-------------------------------|
 * | Line is one-sided, non-zero | `collectIssues`      | `journal_lines_shape`         |
 * | Debits equal credits        | `collectIssues`      | `assert_entry_postable`       |
 * | One debit and one credit    | `collectIssues`      | `assert_entry_postable`       |
 * | Posted entry is immutable   | no route exists      | `journal_entries_append_only` |
 * | A journal reverses once     | `canReverse` + check | partial unique index          |
 *
 * If the two ever disagree the database wins and the transaction rolls back,
 * which is the safe direction: a message that is merely wrong beats a posting
 * that is wrong.
 *
 * # Branch scope
 *
 * Reads confine to `actor.branchId` when the actor has one. Writes stamp the
 * actor's branch onto the entry rather than accepting one — there is no
 * `branchId` field on any DTO, so Scenario 53 is structural.
 *
 * A Super Admin has `branchId === null` and is organization-wide. A manual
 * journal they post carries no branch, which is correct: an organization-level
 * adjustment does not belong to a branch, and forcing one would put it in an
 * arbitrary branch's ledger.
 */
@Injectable()
export class JournalService {
  private readonly logger = new Logger(JournalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthContext,
    dto: ListJournalsDto,
  ): Promise<{ items: JournalSummary[]; total: number }> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 25;

    const where = {
      orgId: actor.orgId,
      // The branch spread, not a client filter. A Branch Admin sees their own
      // branch because of this line and nothing else (Scenario 34).
      ...(actor.branchId ? { branchId: actor.branchId } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.entryType ? { entryType: dto.entryType } : {}),
      ...(dto.sourceType ? { sourceType: dto.sourceType } : {}),
      ...(dto.accountId
        ? { lines: { some: { orgId: actor.orgId, accountId: dto.accountId } } }
        : {}),
      ...(dto.fromDate || dto.toDate
        ? {
            entryDate: {
              ...(dto.fromDate
                ? { gte: new Date(`${dto.fromDate}T00:00:00Z`) }
                : {}),
              ...(dto.toDate
                ? { lte: new Date(`${dto.toDate}T00:00:00Z`) }
                : {}),
            },
          }
        : {}),
      ...(dto.search
        ? {
            OR: [
              {
                entryNumber: {
                  contains: dto.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                description: {
                  contains: dto.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: JOURNAL_INCLUDE,
        orderBy: [{ entryDate: 'desc' }, { entryNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return {
      items: (rows as unknown as JournalRow[]).map(toJournalSummary),
      total,
    };
  }

  async get(
    actor: AuthContext,
    journalEntryId: string,
  ): Promise<JournalDetail> {
    const row = await this.findInScope(actor, journalEntryId);
    return toJournalDetail(row, await this.actorNames(actor.orgId, row));
  }

  /**
   * Checks a set of lines without saving anything (Scenarios 13-15, 17, 18).
   *
   * Returns issues rather than throwing: the caller asked whether this would
   * post, and answering with a 409 would make "no, and here is why" harder to
   * render than "no".
   */
  async validate(
    actor: AuthContext,
    dto: ValidateJournalDto,
  ): Promise<JournalValidation> {
    const accounts = await this.loadAccounts(actor, dto.lines);
    const issues = this.collectIssues(dto, accounts);
    const { debit, credit } = this.totalsOf(dto.lines);

    return {
      valid: issues.length === 0,
      totalDebitPaise: debit.toString(),
      totalCreditPaise: credit.toString(),
      balanced: debit === credit,
      issues,
    };
  }

  /**
   * Creates a draft (Scenario 12).
   *
   * A draft has no ledger effect: the general ledger and the trial balance
   * filter `status: 'POSTED'`, so nothing here moves money. The lines are
   * written even when unbalanced — the whole point of the Module 14 trigger
   * rewrite is that a half-built draft is legal, and the balance decision moves
   * to the moment it is posted.
   */
  async create(
    actor: AuthContext,
    dto: CreateJournalDto,
    meta: RequestMeta,
  ): Promise<JournalDetail> {
    const fingerprint = this.fingerprintOf(dto);

    // Replay before anything else. A client retrying after a lost response is
    // asking for what it already achieved, not for a second draft.
    const replay = await this.findReplay(actor, dto.idempotencyKey);
    if (replay) {
      return this.resolveReplay(actor, replay, fingerprint, meta);
    }

    // Shape and account rules first, so a bad request never reaches a
    // transaction that would have to roll back.
    const accounts = await this.loadAccounts(actor, dto.lines);
    const issues = this.collectIssues(dto, accounts, {
      requirePostable: false,
    });
    this.assertNoBlockingIssues(issues);
    this.assertAdjustmentReason(dto);

    const created = await this.prisma
      .$transaction(async (tx) => {
        const entryNumber = await nextEntryNumber(tx, actor.orgId);

        const entry = await tx.journalEntry.create({
          data: {
            orgId: actor.orgId,
            entryNumber,
            entryDate: new Date(`${dto.entryDate}T00:00:00Z`),
            entryType: dto.entryType,
            status: 'DRAFT',
            description: dto.description,
            createdBy: actor.userId,
            ...(actor.branchId ? { branchId: actor.branchId } : {}),
            ...(dto.adjustmentReason
              ? { adjustmentReason: dto.adjustmentReason }
              : {}),
            ...(dto.approvalReference
              ? { approvalReference: dto.approvalReference }
              : {}),
            idempotencyKey: dto.idempotencyKey,
            requestFingerprint: fingerprint,
          },
        });

        await this.writeLines(tx, actor, entry.journalEntryId, dto.lines);

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.JOURNAL_DRAFT_CREATED,
            entityType: 'JOURNAL_ENTRY',
            entityId: entry.journalEntryId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              entryNumber,
              lineCount: dto.lines.length,
              // `requestFingerprint`, never `requestHash`: sanitizeMetadata
              // drops any key matching /hash/i and the trail would be empty.
              requestFingerprint: fingerprint,
            },
          },
          tx,
        );

        return entry.journalEntryId;
      })
      .catch(async (error: unknown) => {
        // The race loser on the idempotency index asked for the same thing the
        // winner got; route it back through replay rather than erroring.
        if (this.isUniqueViolation(error, 'idempotency_key')) {
          const existing = await this.findReplay(actor, dto.idempotencyKey);
          if (existing) {
            return existing.journalEntryId;
          }
        }
        throw this.translateWriteError(error);
      });

    return this.get(actor, created);
  }

  /**
   * Edits a draft (Scenarios 35, 57).
   *
   * Lines are replaced wholesale. The delete is legal only because the parent
   * is a DRAFT — `reject_journal_line_mutation` refuses the same statement
   * against a posted entry.
   */
  async update(
    actor: AuthContext,
    journalEntryId: string,
    dto: UpdateJournalDto,
    meta: RequestMeta,
  ): Promise<JournalDetail> {
    const existing = await this.findInScope(actor, journalEntryId);
    this.assertDraft(existing, 'edited');
    this.assertVersion(existing, dto.expectedVersion, actor, meta);

    const accounts = await this.loadAccounts(actor, dto.lines);
    const issues = this.collectIssues(dto, accounts, {
      requirePostable: false,
    });
    this.assertNoBlockingIssues(issues);
    this.assertAdjustmentReason(dto);

    await this.prisma
      .$transaction(async (tx) => {
        await tx.journalLine.deleteMany({
          where: { orgId: actor.orgId, journalEntryId },
        });

        await tx.journalEntry.update({
          where: {
            orgId_journalEntryId: { orgId: actor.orgId, journalEntryId },
          },
          data: {
            entryDate: new Date(`${dto.entryDate}T00:00:00Z`),
            entryType: dto.entryType,
            description: dto.description,
            adjustmentReason: dto.adjustmentReason ?? null,
            approvalReference: dto.approvalReference ?? null,
          },
        });

        await this.writeLines(tx, actor, journalEntryId, dto.lines);

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.JOURNAL_DRAFT_UPDATED,
            entityType: 'JOURNAL_ENTRY',
            entityId: journalEntryId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: {
              description: existing.description,
              lineCount: existing.lines.length,
            },
            newData: {
              description: dto.description,
              lineCount: dto.lines.length,
            },
          },
          tx,
        );
      })
      .catch((error: unknown) => {
        throw this.translateWriteError(error);
      });

    return this.get(actor, journalEntryId);
  }

  /**
   * Discards a draft (Scenario 38).
   *
   * Legal only for a DRAFT — `journal_entries_append_only` refuses the delete
   * for anything else, and there is no route that would attempt it.
   */
  async remove(
    actor: AuthContext,
    journalEntryId: string,
    meta: RequestMeta,
  ): Promise<{ journalEntryId: string; deleted: true }> {
    const existing = await this.findInScope(actor, journalEntryId);

    if (existing.status !== 'DRAFT') {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.JOURNAL_DELETE_BLOCKED,
        entityType: 'JOURNAL_ENTRY',
        entityId: journalEntryId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          status: existing.status,
          entryNumber: existing.entryNumber,
        },
      });

      throw new ConflictException(
        `Journal ${existing.entryNumber} is ${existing.status.toLowerCase()} and cannot be deleted. Post a reversing entry instead.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.journalLine.deleteMany({
        where: { orgId: actor.orgId, journalEntryId },
      });

      await tx.journalEntry.delete({
        where: { orgId_journalEntryId: { orgId: actor.orgId, journalEntryId } },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.JOURNAL_DRAFT_DELETED,
          entityType: 'JOURNAL_ENTRY',
          entityId: journalEntryId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: {
            entryNumber: existing.entryNumber,
            description: existing.description,
          },
        },
        tx,
      );
    });

    return { journalEntryId, deleted: true };
  }

  /**
   * Posts a draft to the authoritative ledger (Scenarios 28-31).
   *
   * The status flip is the whole posting: `reject_posted_journal_entry_mutation`
   * intercepts DRAFT -> POSTED and calls `assert_entry_postable`, which is what
   * refuses an unbalanced or malformed set. This method's own checks run first
   * so the caller gets a sentence rather than a trigger's exception, but the
   * trigger is the guarantee — and it reads the lines as they stand at that
   * instant, not as this method saw them.
   */
  async post(
    actor: AuthContext,
    journalEntryId: string,
    dto: PostJournalDto,
    idempotencyKey: string,
    meta: RequestMeta,
  ): Promise<JournalDetail> {
    const existing = await this.findInScope(actor, journalEntryId);

    // Replay before the version check. A client retrying after a timeout holds
    // the version from before the successful commit, so checking the version
    // first would reject the retry with a conflict instead of returning what it
    // already achieved.
    if (existing.status === 'POSTED') {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.JOURNAL_DUPLICATE_IGNORED,
        entityType: 'JOURNAL_ENTRY',
        entityId: journalEntryId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { entryNumber: existing.entryNumber, idempotencyKey },
      });

      return this.get(actor, journalEntryId);
    }

    this.assertDraft(existing, 'posted');
    this.assertVersion(existing, dto.expectedVersion, actor, meta);

    const accounts = await this.loadAccounts(
      actor,
      existing.lines.map((line) => ({
        accountId: line.accountId,
        debitPaise: line.debitPaise.toString(),
        creditPaise: line.creditPaise.toString(),
      })),
    );

    const issues = this.collectIssues(
      {
        entryType: existing.entryType,
        lines: existing.lines.map((line) => ({
          accountId: line.accountId,
          debitPaise: line.debitPaise.toString(),
          creditPaise: line.creditPaise.toString(),
        })),
      },
      accounts,
      { requirePostable: true },
    );

    if (issues.length > 0) {
      // Recorded outside any transaction so it survives — there is no
      // transaction yet, and the same reasoning applies to the catch below.
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.JOURNAL_POSTING_FAILED,
        entityType: 'JOURNAL_ENTRY',
        entityId: journalEntryId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { entryNumber: existing.entryNumber, issues },
      });

      throw new ConflictException({
        message: issues[0]?.message ?? 'This journal cannot be posted.',
        issues,
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.journalEntry.update({
          where: {
            orgId_journalEntryId: { orgId: actor.orgId, journalEntryId },
          },
          data: {
            status: 'POSTED',
            postedAt: new Date(),
            postedBy: actor.userId,
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.JOURNAL_POSTED,
            entityType: 'JOURNAL_ENTRY',
            entityId: journalEntryId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              entryNumber: existing.entryNumber,
              idempotencyKey,
              lineCount: existing.lines.length,
            },
          },
          tx,
        );
      });
    } catch (error: unknown) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.JOURNAL_POSTING_FAILED,
        entityType: 'JOURNAL_ENTRY',
        entityId: journalEntryId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          entryNumber: existing.entryNumber,
          reason: error instanceof Error ? error.message : 'unknown',
        },
      });

      throw this.translateWriteError(error);
    }

    return this.get(actor, journalEntryId);
  }

  /**
   * Reverses a posted journal (Scenarios 39-42).
   *
   * Writes a new entry whose sides are exchanged and flips the original to
   * REVERSED — the one mutation `reject_posted_journal_entry_mutation` permits.
   * The original's lines are never touched.
   *
   * Both writes are in one transaction: a reversal that marked the original
   * without posting its own entry, or the reverse, would leave the ledger
   * describing something that did not happen.
   */
  async reverse(
    actor: AuthContext,
    journalEntryId: string,
    dto: ReverseJournalDto,
    idempotencyKey: string,
    meta: RequestMeta,
  ): Promise<JournalDetail> {
    const original = await this.findInScope(actor, journalEntryId);

    // Replay: the reversal already exists and this is a retry.
    const priorReversal = await this.findReplay(actor, idempotencyKey);
    if (priorReversal) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.JOURNAL_DUPLICATE_IGNORED,
        entityType: 'JOURNAL_ENTRY',
        entityId: priorReversal.journalEntryId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { idempotencyKey, reversalOf: journalEntryId },
      });

      return this.get(actor, priorReversal.journalEntryId);
    }

    if (original.status !== 'POSTED') {
      throw new ConflictException(
        original.status === 'REVERSED'
          ? `Journal ${original.entryNumber} has already been reversed.`
          : `Journal ${original.entryNumber} is a draft and has nothing to reverse. Delete it instead.`,
      );
    }

    if ((original.reversalEntries?.length ?? 0) > 0) {
      // Scenario 41. The partial unique index is the guarantee under
      // concurrency; this is the readable refusal.
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.JOURNAL_DUPLICATE_REVERSAL_REJECTED,
        entityType: 'JOURNAL_ENTRY',
        entityId: journalEntryId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { entryNumber: original.entryNumber },
      });

      throw new ConflictException(
        `Journal ${original.entryNumber} has already been reversed.`,
      );
    }

    this.assertVersion(original, dto.expectedVersion, actor, meta);

    const entryDate = dto.entryDate ?? this.businessDate();
    const originalDate = original.entryDate.toISOString().slice(0, 10);
    if (entryDate < originalDate) {
      throw new ConflictException(
        `A reversal cannot be dated before the entry it reverses (${originalDate}).`,
      );
    }

    let reversalId: string;

    try {
      reversalId = await this.prisma.$transaction(async (tx) => {
        const entryNumber = await nextEntryNumber(tx, actor.orgId);

        const reversal = await tx.journalEntry.create({
          data: {
            orgId: actor.orgId,
            entryNumber,
            entryDate: new Date(`${entryDate}T00:00:00Z`),
            entryType: 'REVERSAL',
            status: 'POSTED',
            postedAt: new Date(),
            postedBy: actor.userId,
            description: `Reversal of ${original.entryNumber} — ${dto.reversalReason}`,
            createdBy: actor.userId,
            ...(original.branchId ? { branchId: original.branchId } : {}),
            originalJournalEntryId: journalEntryId,
            reversalReason: dto.reversalReason,
            idempotencyKey,
            requestFingerprint: this.fingerprintOfReversal(
              journalEntryId,
              dto.reversalReason,
            ),
          },
        });

        // Each line's sides exchanged. `sourceComponent` is carried across so a
        // reversal stays traceable to what it unwound rather than becoming an
        // untagged pair of amounts.
        let lineNumber = 0;
        for (const line of original.lines) {
          lineNumber += 1;
          await tx.journalLine.create({
            data: {
              orgId: actor.orgId,
              journalEntryId: reversal.journalEntryId,
              lineNumber,
              accountId: line.accountId,
              debitPaise: line.creditPaise,
              creditPaise: line.debitPaise,
              description: `Reversal — ${line.description ?? line.account.accountName}`,
              ...(line.sourceComponent
                ? { sourceComponent: line.sourceComponent }
                : {}),
            },
          });
        }

        // The one mutation the append-only trigger permits on a posted entry.
        await tx.journalEntry.update({
          where: {
            orgId_journalEntryId: { orgId: actor.orgId, journalEntryId },
          },
          data: { status: 'REVERSED' },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.JOURNAL_REVERSED,
            entityType: 'JOURNAL_ENTRY',
            entityId: journalEntryId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              originalEntryNumber: original.entryNumber,
              reversalEntryNumber: entryNumber,
              reversalReason: dto.reversalReason,
              idempotencyKey,
            },
          },
          tx,
        );

        return reversal.journalEntryId;
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error, 'idempotency_key')) {
        const existing = await this.findReplay(actor, idempotencyKey);
        if (existing) return this.get(actor, existing.journalEntryId);
      }

      // Scenario 42: the original stays posted and unchanged, and is not
      // falsely marked reversed, because both writes shared one transaction.
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.JOURNAL_REVERSAL_FAILED,
        entityType: 'JOURNAL_ENTRY',
        entityId: journalEntryId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          entryNumber: original.entryNumber,
          reason: error instanceof Error ? error.message : 'unknown',
        },
      });

      if (this.isUniqueViolation(error, 'original_journal_entry_id')) {
        throw new ConflictException(
          `Journal ${original.entryNumber} has already been reversed.`,
        );
      }

      throw this.translateWriteError(error);
    }

    // The new reversal entry, not the original: the caller needs its number,
    // and `originalEntryNumber` puts the original one field away.
    return this.get(actor, reversalId);
  }

  // --- internals -----------------------------------------------------------

  /**
   * Every rule that can be checked without writing.
   *
   * `requirePostable` separates saving a draft from posting it. A draft may be
   * unbalanced and may be mid-build — that is what the Module 14 trigger
   * rewrite made legal — so only the per-line rules apply. Posting applies all
   * of them.
   */
  private collectIssues(
    dto: {
      entryType?: string;
      adjustmentReason?: string;
      lines: Pick<JournalLineDto, 'accountId' | 'debitPaise' | 'creditPaise'>[];
    },
    accounts: Map<string, AccountForPosting>,
    options: { requirePostable?: boolean } = {},
  ): JournalIssue[] {
    const issues: JournalIssue[] = [];
    const requirePostable = options.requirePostable ?? true;

    let debitLines = 0;
    let creditLines = 0;
    const seen = new Set<string>();

    dto.lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const debit = BigInt(line.debitPaise);
      const credit = BigInt(line.creditPaise);

      if (debit > 0n && credit > 0n) {
        issues.push({
          code: 'LINE_TWO_SIDED',
          message: `Line ${lineNumber} has both a debit and a credit. A line is one side or the other.`,
          lineNumber,
        });
      } else if (debit === 0n && credit === 0n) {
        issues.push({
          code: 'LINE_ZERO',
          message: `Line ${lineNumber} moves nothing. Enter a debit or a credit amount.`,
          lineNumber,
        });
      }

      if (debit > 0n) debitLines += 1;
      if (credit > 0n) creditLines += 1;

      const account = accounts.get(line.accountId);
      if (!account) {
        issues.push({
          code: 'ACCOUNT_NOT_FOUND',
          message: `Line ${lineNumber} references an account that does not exist in this organization.`,
          lineNumber,
        });
        return;
      }

      // Scenarios 11, 30, 46: an inactive, non-postable or control account
      // stops the posting. Checked when posting rather than when drafting, so
      // an account deactivated after a draft was written is caught at the
      // moment it matters.
      if (requirePostable) {
        if (account.status !== 'ACTIVE') {
          issues.push({
            code: 'ACCOUNT_INACTIVE',
            message: `Line ${lineNumber}: the ${account.accountName} account is inactive and cannot be posted to.`,
            lineNumber,
          });
        } else if (!account.isPostable) {
          issues.push({
            code: 'ACCOUNT_NOT_POSTABLE',
            message: `Line ${lineNumber}: ${account.accountName} is a summary account and cannot be posted to.`,
            lineNumber,
          });
        } else if (!account.isManualPostingAllowed) {
          issues.push({
            code: 'ACCOUNT_NOT_MANUALLY_POSTABLE',
            message: `Line ${lineNumber}: ${account.accountName} is driven by its source module and is not open to manual posting.`,
            lineNumber,
          });
        }
      }

      const key = `${line.accountId}:${debit > 0n ? 'D' : 'C'}`;
      if (seen.has(key)) {
        issues.push({
          code: 'DUPLICATE_ACCOUNT_SIDE',
          message: `Line ${lineNumber}: ${account.accountName} already has a line on the same side.`,
          lineNumber,
        });
      }
      seen.add(key);
    });

    if (requirePostable) {
      if (debitLines === 0 || creditLines === 0) {
        issues.push({
          code: 'ONE_SIDED_ENTRY',
          message:
            'A journal needs at least one debit line and at least one credit line.',
        });
      }

      const { debit, credit } = this.totalsOf(dto.lines);
      if (debit !== credit) {
        issues.push({
          code: 'UNBALANCED',
          message: `Total debit must equal total credit. They differ by ${this.formatPaise(debit - credit)}.`,
        });
      }
    }

    return issues;
  }

  private totalsOf(
    lines: Pick<JournalLineDto, 'debitPaise' | 'creditPaise'>[],
  ): { debit: bigint; credit: bigint } {
    let debit = 0n;
    let credit = 0n;
    for (const line of lines) {
      debit += BigInt(line.debitPaise);
      credit += BigInt(line.creditPaise);
    }
    return { debit, credit };
  }

  /** Renders a signed paise difference as rupees, for a message. */
  private formatPaise(difference: bigint): string {
    const magnitude = difference < 0n ? -difference : difference;
    return `₹${(magnitude / 100n).toString()}.${(magnitude % 100n).toString().padStart(2, '0')}`;
  }

  private async loadAccounts(
    actor: AuthContext,
    lines: Pick<JournalLineDto, 'accountId'>[],
  ): Promise<Map<string, AccountForPosting>> {
    const ids = [...new Set(lines.map((line) => line.accountId))];
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.account.findMany({
      where: { orgId: actor.orgId, accountId: { in: ids } },
      select: {
        accountId: true,
        accountName: true,
        status: true,
        isPostable: true,
        isManualPostingAllowed: true,
      },
    });

    return new Map(rows.map((row) => [row.accountId, row]));
  }

  private async writeLines(
    tx: LineWriteTx,
    actor: AuthContext,
    journalEntryId: string,
    lines: JournalLineDto[],
  ): Promise<void> {
    let lineNumber = 0;
    for (const line of lines) {
      lineNumber += 1;

      // One dimension row per line, matching what LedgerService writes. The
      // branch is the actor's, never the client's.
      const dimension = await tx.accountDimension.create({
        data: {
          orgId: actor.orgId,
          accountId: line.accountId,
          ...(actor.branchId ? { branchId: actor.branchId } : {}),
        },
      });

      await tx.journalLine.create({
        data: {
          orgId: actor.orgId,
          journalEntryId,
          lineNumber,
          accountId: line.accountId,
          dimensionId: dimension.dimensionId,
          debitPaise: BigInt(line.debitPaise),
          creditPaise: BigInt(line.creditPaise),
          ...(line.description ? { description: line.description } : {}),
          sourceComponent: 'MANUAL',
        },
      });
    }
  }

  private async findInScope(
    actor: AuthContext,
    journalEntryId: string,
  ): Promise<JournalRow> {
    const row = await this.prisma.journalEntry.findFirst({
      where: {
        orgId: actor.orgId,
        journalEntryId,
        ...(actor.branchId ? { branchId: actor.branchId } : {}),
      },
      include: JOURNAL_INCLUDE,
    });

    if (!row) {
      this.logger.warn(
        `Journal ${journalEntryId} not reachable for org ${actor.orgId}`,
      );
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  private async findReplay(
    actor: AuthContext,
    idempotencyKey: string,
  ): Promise<{
    journalEntryId: string;
    requestFingerprint: string | null;
  } | null> {
    return this.prisma.journalEntry.findFirst({
      where: { orgId: actor.orgId, idempotencyKey },
      select: { journalEntryId: true, requestFingerprint: true },
    });
  }

  /**
   * Scenarios 25, 26. The same key with the same body returns what exists; the
   * same key with a materially different body is a conflict.
   */
  private async resolveReplay(
    actor: AuthContext,
    replay: { journalEntryId: string; requestFingerprint: string | null },
    fingerprint: string,
    meta: RequestMeta,
  ): Promise<JournalDetail> {
    if (
      replay.requestFingerprint &&
      replay.requestFingerprint !== fingerprint
    ) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.JOURNAL_IDEMPOTENCY_CONFLICT,
        entityType: 'JOURNAL_ENTRY',
        entityId: replay.journalEntryId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { requestFingerprint: fingerprint },
      });

      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message:
          'That idempotency key was already used for a different journal.',
        journalEntryId: replay.journalEntryId,
      });
    }

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.JOURNAL_DUPLICATE_IGNORED,
      entityType: 'JOURNAL_ENTRY',
      entityId: replay.journalEntryId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.get(actor, replay.journalEntryId);
  }

  /**
   * The canonical request, hashed.
   *
   * Only the fields that decide what the journal *is* — a corrected typo in the
   * description should not refuse an honest retry, so it is excluded for the
   * same reason `collection.service.ts` excludes `notes`.
   */
  private fingerprintOf(dto: CreateJournalDto): string {
    const canonical = JSON.stringify({
      entryDate: dto.entryDate,
      entryType: dto.entryType,
      lines: dto.lines.map((line) => ({
        accountId: line.accountId,
        debitPaise: line.debitPaise,
        creditPaise: line.creditPaise,
      })),
    });

    return createHash('sha256').update(canonical).digest('hex');
  }

  private fingerprintOfReversal(
    journalEntryId: string,
    reversalReason: string,
  ): string {
    return createHash('sha256')
      .update(JSON.stringify({ journalEntryId, reversalReason }))
      .digest('hex');
  }

  private assertDraft(row: JournalRow, verb: string): void {
    if (row.status !== 'DRAFT') {
      throw new ConflictException(
        `Journal ${row.entryNumber} is ${row.status.toLowerCase()} and cannot be ${verb}. Post a reversing entry instead.`,
      );
    }
  }

  private assertVersion(
    row: JournalRow,
    expectedVersion: string,
    actor: AuthContext,
    meta: RequestMeta,
  ): void {
    const expected = new Date(expectedVersion);

    if (
      Number.isNaN(expected.getTime()) ||
      row.updatedAt.getTime() !== expected.getTime()
    ) {
      void this.audit
        .record({
          orgId: actor.orgId,
          action: AuditAction.JOURNAL_CONCURRENT_ATTEMPT_REJECTED,
          entityType: 'JOURNAL_ENTRY',
          entityId: row.journalEntryId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            expectedVersion,
            actualVersion: row.updatedAt.toISOString(),
          },
        })
        .catch(() => {});

      throw new ConflictException(STALE);
    }
  }

  private assertAdjustmentReason(dto: {
    entryType: string;
    adjustmentReason?: string;
  }): void {
    // Scenario 43. An adjustment corrects something already posted, and a
    // correction whose reason is not recorded cannot be reviewed later.
    if (dto.entryType === 'ADJUSTMENT' && !dto.adjustmentReason) {
      throw new ConflictException('An adjustment needs a reason.');
    }
  }

  private assertNoBlockingIssues(issues: JournalIssue[]): void {
    if (issues.length > 0) {
      throw new ConflictException({
        message: issues[0]?.message ?? 'This journal is not valid.',
        issues,
      });
    }
  }

  /** Today in Asia/Kolkata — the authoritative accounting business date. */
  private businessDate(): string {
    return new Date(Date.now() + 5.5 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  private async actorNames(
    orgId: string,
    row: JournalRow,
  ): Promise<ActorNames> {
    const ids = [row.createdBy, row.postedBy].filter(
      (id): id is string => typeof id === 'string',
    );
    if (ids.length === 0) return {};

    const users = await this.prisma.user.findMany({
      where: { orgId, userId: { in: [...new Set(ids)] } },
      select: { userId: true, name: true },
    });

    const byId = new Map(users.map((user) => [user.userId, user.name]));

    return {
      ...(byId.has(row.createdBy)
        ? { createdByName: byId.get(row.createdBy)! }
        : {}),
      ...(row.postedBy && byId.has(row.postedBy)
        ? { postedByName: byId.get(row.postedBy)! }
        : {}),
    };
  }

  /**
   * Matches on the message as well as the code because `meta.target` is
   * unreliable under Prisma 7 with the pg adapter — the same reason
   * `collection.service.ts` does.
   */
  private isUniqueViolation(error: unknown, column: string): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as { code?: unknown; message?: unknown };
    if (candidate.code !== 'P2002') return false;
    const message =
      typeof candidate.message === 'string' ? candidate.message : '';
    return message.includes(column);
  }

  /**
   * Surfaces a trigger's refusal as a conflict rather than a 500.
   *
   * The database's messages are written for an operator — "Journal entry X is
   * unbalanced: debit A <> credit B" — so they are passed through rather than
   * replaced with something vaguer.
   */
  private translateWriteError(error: unknown): unknown {
    if (typeof error !== 'object' || error === null) return error;

    const message = (error as { message?: unknown }).message;
    if (typeof message !== 'string') return error;

    const triggerPhrases = [
      'is unbalanced',
      'must have at least one debit',
      'has no lines',
      'moves nothing',
      'has both a debit and a credit',
      'append-only',
      'is immutable',
      'cannot be deleted',
      'circular hierarchy',
      'cannot carry a posting timestamp',
      'without a posting timestamp',
    ];

    if (triggerPhrases.some((phrase) => message.includes(phrase))) {
      const cleaned =
        message.split('\n').find((line) => line.trim()) ?? message;
      return new ConflictException(cleaned.trim());
    }

    if ((error as { code?: unknown }).code === 'P2002') {
      return new ConflictException(
        'That journal reference is already in use. Try again.',
      );
    }

    return error;
  }
}

interface AccountForPosting {
  accountId: string;
  accountName: string;
  status: string;
  isPostable: boolean;
  isManualPostingAllowed: boolean;
}

/** The transaction surface `writeLines` needs. */
interface LineWriteTx {
  accountDimension: {
    create: (args: {
      data: Record<string, unknown>;
    }) => Promise<{ dimensionId: string }>;
  };
  journalLine: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
}
