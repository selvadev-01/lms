import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AccountDetail,
  AccountSummary,
  AccountTreeNode,
} from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ACCOUNT_INCLUDE,
  type AccountRow,
  toAccountDetail,
  toAccountSummary,
  toAccountTree,
} from './account.mapper';
import type {
  ActivateAccountDto,
  CreateAccountDto,
  DeactivateAccountDto,
  ListAccountsDto,
  UpdateAccountDto,
} from './dto/account.dto';

export const ACCOUNTS_VIEW_PERMISSION = 'accounting.accounts.view';
export const ACCOUNTS_MANAGE_PERMISSION = 'accounting.accounts.manage';

/** One message whether the account belongs to another tenant or does not exist. */
const NOT_REACHABLE = 'Account not found';

const STALE =
  'This account has changed since you opened it. Reload and try again.';

/**
 * The conventional side of each account type.
 *
 * Duplicated from `packages/validation/src/accounting.ts` on purpose. That copy
 * runs in the browser and this one guards the API; a rule written only there is
 * enforced only there.
 */
const CONVENTIONAL_NORMAL_BALANCE: Record<string, string> = {
  ASSET: 'DEBIT',
  EXPENSE: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  INCOME: 'CREDIT',
};

/**
 * The chart of accounts (Module 14 Scenarios 1-11, 46-48).
 *
 * # No branch scope, deliberately
 *
 * Unlike every other Module 09-11 service, nothing here filters by
 * `actor.branchId`. Accounts are organization-wide: which branch a posting
 * belongs to is carried by `JournalEntry.branchId` and by the per-line
 * `AccountDimension`, not by owning a separate account per branch. Duplicating
 * the chart per branch would make a consolidated trial balance a join rather
 * than a sum.
 *
 * Scenario 2 asks that a Branch Admin see only permitted accounts. It is
 * satisfied because there are no branch-owned accounts to leak — every account
 * is `ORGANIZATION` scope — rather than by a filter. If `BRANCH`-scoped
 * accounts are ever created, this is the class that must gain one.
 *
 * # What this service refuses, and what the database refuses beneath it
 *
 * The hierarchy walk, the identity freeze and the delete guard all exist here
 * to produce a message an operator can act on. Each has a counterpart in the
 * database that is the actual guarantee: `accounts_hierarchy_acyclic` for
 * cycles, and the `journal_lines.account_id` foreign key for deletion. If the
 * two ever disagree, the database wins and the transaction rolls back.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthContext,
    dto: ListAccountsDto,
  ): Promise<{
    items: AccountSummary[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 50;

    const where = {
      orgId: actor.orgId,
      ...(dto.accountType ? { accountType: dto.accountType } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.postableOnly ? { isPostable: true } : {}),
      ...(dto.manualPostableOnly
        ? {
            isManualPostingAllowed: true,
            isPostable: true,
            status: 'ACTIVE' as const,
          }
        : {}),
      ...(dto.search
        ? {
            OR: [
              {
                accountCode: {
                  contains: dto.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                accountName: {
                  contains: dto.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        include: ACCOUNT_INCLUDE,
        orderBy: [{ accountCode: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.account.count({ where }),
    ]);

    return {
      items: (rows as unknown as AccountRow[]).map((row) =>
        toAccountSummary(row),
      ),
      total,
      page,
      pageSize,
    };
  }

  /**
   * The whole chart as a tree.
   *
   * Unpaginated on purpose: a hierarchy with a page boundary through it is not
   * a hierarchy, and a chart of accounts large enough for that to matter would
   * need a different screen rather than a different query.
   */
  async tree(actor: AuthContext): Promise<AccountTreeNode[]> {
    const rows = await this.prisma.account.findMany({
      where: { orgId: actor.orgId },
      include: ACCOUNT_INCLUDE,
      orderBy: [{ accountCode: 'asc' }],
    });

    return toAccountTree(rows);
  }

  async get(actor: AuthContext, accountId: string): Promise<AccountDetail> {
    return toAccountDetail(await this.findInScope(actor, accountId));
  }

  async create(
    actor: AuthContext,
    dto: CreateAccountDto,
    meta: RequestMeta,
  ): Promise<AccountDetail> {
    this.assertConventionalBalance(dto.accountType, dto.normalBalance);
    this.assertControlNotPostable(dto.isControlAccount, dto.isPostable);
    this.assertEffectiveRange(dto.effectiveFrom, dto.effectiveTo);

    if (dto.parentAccountId) {
      await this.assertParentExists(actor, dto.parentAccountId);
    }

    const created = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.account.create({
          data: {
            orgId: actor.orgId,
            accountCode: dto.accountCode,
            accountName: dto.accountName,
            accountType: dto.accountType,
            normalBalance: dto.normalBalance,
            status: dto.status,
            ...(dto.accountCategory
              ? { accountCategory: dto.accountCategory }
              : {}),
            ...(dto.parentAccountId
              ? { parentAccountId: dto.parentAccountId }
              : {}),
            ...(dto.description ? { description: dto.description } : {}),
            isPostable: dto.isPostable ?? true,
            isManualPostingAllowed: dto.isManualPostingAllowed ?? false,
            isControlAccount: dto.isControlAccount ?? false,
            branchScope: dto.branchScope ?? 'ORGANIZATION',
            ...(dto.effectiveFrom
              ? { effectiveFrom: new Date(`${dto.effectiveFrom}T00:00:00Z`) }
              : {}),
            ...(dto.effectiveTo
              ? { effectiveTo: new Date(`${dto.effectiveTo}T00:00:00Z`) }
              : {}),
            createdBy: actor.userId,
            updatedBy: actor.userId,
          },
          include: ACCOUNT_INCLUDE,
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.ACCOUNT_CREATED,
            entityType: 'ACCOUNT',
            entityId: row.accountId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            newData: {
              accountCode: row.accountCode,
              accountName: row.accountName,
              accountType: row.accountType,
              normalBalance: row.normalBalance,
              status: row.status,
            },
          },
          tx,
        );

        return row;
      })
      .catch((error: unknown) => {
        throw this.translateAccountWriteError(error, dto.accountCode);
      });

    return toAccountDetail(created);
  }

  async update(
    actor: AuthContext,
    accountId: string,
    dto: UpdateAccountDto,
    meta: RequestMeta,
  ): Promise<AccountDetail> {
    const existing = await this.findInScope(actor, accountId);
    this.assertVersion(existing, dto.expectedVersion);

    const postedLineCount = existing._count?.journalLines ?? 0;

    // Scenario 8. Once a posted line references the account, its code, type and
    // normal balance are frozen: changing any of them would retroactively alter
    // what an entry already in the ledger means.
    if (postedLineCount > 0) {
      const frozen: string[] = [];
      if (
        dto.accountCode !== undefined &&
        dto.accountCode !== existing.accountCode
      ) {
        frozen.push('Account Code');
      }
      if (
        dto.accountType !== undefined &&
        dto.accountType !== existing.accountType
      ) {
        frozen.push('Account Type');
      }
      if (
        dto.normalBalance !== undefined &&
        dto.normalBalance !== existing.normalBalance
      ) {
        frozen.push('Normal Balance');
      }

      if (frozen.length > 0) {
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.ACCOUNT_IDENTITY_EDIT_BLOCKED,
          entityType: 'ACCOUNT',
          entityId: accountId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { blockedFields: frozen, postedLineCount },
        });

        throw new ConflictException(
          `${frozen.join(', ')} cannot be changed: ${postedLineCount} posted ledger line(s) already reference this account. Create a new account instead.`,
        );
      }
    }

    const nextType = dto.accountType ?? existing.accountType;
    const nextBalance = dto.normalBalance ?? existing.normalBalance;
    this.assertConventionalBalance(nextType, nextBalance);

    this.assertControlNotPostable(
      dto.isControlAccount ?? existing.isControlAccount,
      dto.isPostable ?? existing.isPostable,
    );

    this.assertEffectiveRange(
      dto.effectiveFrom ?? this.dateOnly(existing.effectiveFrom),
      dto.effectiveTo ?? this.dateOnly(existing.effectiveTo),
    );

    if (dto.parentAccountId) {
      await this.assertParentExists(actor, dto.parentAccountId);
      await this.assertNoCycle(actor, accountId, dto.parentAccountId);
    }

    const updated = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.account.update({
          where: {
            orgId_accountId: { orgId: actor.orgId, accountId },
          },
          data: {
            ...(dto.accountCode === undefined
              ? {}
              : { accountCode: dto.accountCode }),
            ...(dto.accountName === undefined
              ? {}
              : { accountName: dto.accountName }),
            ...(dto.accountType === undefined
              ? {}
              : { accountType: dto.accountType }),
            ...(dto.normalBalance === undefined
              ? {}
              : { normalBalance: dto.normalBalance }),
            ...(dto.accountCategory === undefined
              ? {}
              : { accountCategory: dto.accountCategory }),
            ...(dto.parentAccountId === undefined
              ? {}
              : { parentAccountId: dto.parentAccountId }),
            ...(dto.description === undefined
              ? {}
              : { description: dto.description }),
            ...(dto.isPostable === undefined
              ? {}
              : { isPostable: dto.isPostable }),
            ...(dto.isManualPostingAllowed === undefined
              ? {}
              : { isManualPostingAllowed: dto.isManualPostingAllowed }),
            ...(dto.isControlAccount === undefined
              ? {}
              : { isControlAccount: dto.isControlAccount }),
            ...(dto.branchScope === undefined
              ? {}
              : { branchScope: dto.branchScope }),
            ...(dto.effectiveFrom === undefined
              ? {}
              : { effectiveFrom: new Date(`${dto.effectiveFrom}T00:00:00Z`) }),
            ...(dto.effectiveTo === undefined
              ? {}
              : { effectiveTo: new Date(`${dto.effectiveTo}T00:00:00Z`) }),
            updatedBy: actor.userId,
          },
          include: ACCOUNT_INCLUDE,
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.ACCOUNT_UPDATED,
            entityType: 'ACCOUNT',
            entityId: accountId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: {
              accountCode: existing.accountCode,
              accountName: existing.accountName,
              accountType: existing.accountType,
              normalBalance: existing.normalBalance,
              isPostable: existing.isPostable,
              isManualPostingAllowed: existing.isManualPostingAllowed,
            },
            newData: {
              accountCode: row.accountCode,
              accountName: row.accountName,
              accountType: row.accountType,
              normalBalance: row.normalBalance,
              isPostable: row.isPostable,
              isManualPostingAllowed: row.isManualPostingAllowed,
            },
          },
          tx,
        );

        return row;
      })
      .catch((error: unknown) => {
        throw this.translateAccountWriteError(
          error,
          dto.accountCode ?? existing.accountCode,
        );
      });

    return toAccountDetail(updated);
  }

  /**
   * Scenario 9. The account stops accepting new postings and stays visible for
   * historical reporting — nothing about the entries that already reference it
   * changes, because no read filters on status.
   */
  async deactivate(
    actor: AuthContext,
    accountId: string,
    dto: DeactivateAccountDto,
    meta: RequestMeta,
  ): Promise<AccountDetail> {
    return this.setStatus(
      actor,
      accountId,
      'INACTIVE',
      dto.expectedVersion,
      meta,
      dto.reason,
    );
  }

  async activate(
    actor: AuthContext,
    accountId: string,
    dto: ActivateAccountDto,
    meta: RequestMeta,
  ): Promise<AccountDetail> {
    return this.setStatus(
      actor,
      accountId,
      'ACTIVE',
      dto.expectedVersion,
      meta,
    );
  }

  /**
   * Scenario 10. Deletion exists so that it can refuse.
   *
   * An account is deletable only while nothing points at it at all — no posted
   * line, no child account, no disbursement. Anything else is a 409 naming the
   * blocker, because "deactivate instead" is only actionable advice if the user
   * can see why.
   */
  async remove(
    actor: AuthContext,
    accountId: string,
    meta: RequestMeta,
  ): Promise<{ accountId: string; deleted: true }> {
    const existing = await this.findInScope(actor, accountId);

    const [dimensionCount, disbursementCount] = await Promise.all([
      this.prisma.accountDimension.count({
        where: { orgId: actor.orgId, accountId },
      }),
      this.prisma.disbursement.count({
        where: { orgId: actor.orgId, disbursementAccountId: accountId },
      }),
    ]);

    const blockers: { entity: string; label: string; count: number }[] = [];
    const postedLines = existing._count?.journalLines ?? 0;
    const children = existing._count?.childAccounts ?? 0;

    if (postedLines > 0) {
      blockers.push({
        entity: 'journalLine',
        label: 'Posted ledger lines',
        count: postedLines,
      });
    }
    if (children > 0) {
      blockers.push({
        entity: 'childAccount',
        label: 'Child accounts',
        count: children,
      });
    }
    if (dimensionCount > 0) {
      blockers.push({
        entity: 'accountDimension',
        label: 'Analytical dimensions',
        count: dimensionCount,
      });
    }
    if (disbursementCount > 0) {
      blockers.push({
        entity: 'disbursement',
        label: 'Disbursements',
        count: disbursementCount,
      });
    }

    if (blockers.length > 0) {
      // Audited without a tx: the refusal must survive, and there is no
      // transaction here to survive anyway.
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.ACCOUNT_DELETE_BLOCKED,
        entityType: 'ACCOUNT',
        entityId: accountId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { accountCode: existing.accountCode, blockers },
      });

      throw new ConflictException({
        message:
          'This account is referenced and cannot be deleted. Deactivate it instead — it will stay available for historical reporting and stop accepting new postings.',
        blockedBy: blockers,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.account.delete({
        where: { orgId_accountId: { orgId: actor.orgId, accountId } },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.ACCOUNT_DELETED,
          entityType: 'ACCOUNT',
          entityId: accountId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: {
            accountCode: existing.accountCode,
            accountName: existing.accountName,
            accountType: existing.accountType,
          },
        },
        tx,
      );
    });

    return { accountId, deleted: true };
  }

  // --- internals -----------------------------------------------------------

  private async setStatus(
    actor: AuthContext,
    accountId: string,
    status: 'ACTIVE' | 'INACTIVE',
    expectedVersion: string,
    meta: RequestMeta,
    reason?: string,
  ): Promise<AccountDetail> {
    const existing = await this.findInScope(actor, accountId);
    this.assertVersion(existing, expectedVersion);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.account.update({
        where: { orgId_accountId: { orgId: actor.orgId, accountId } },
        data: { status, updatedBy: actor.userId },
        include: ACCOUNT_INCLUDE,
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action:
            status === 'ACTIVE'
              ? AuditAction.ACCOUNT_ACTIVATED
              : AuditAction.ACCOUNT_DEACTIVATED,
          entityType: 'ACCOUNT',
          entityId: accountId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          ...(reason ? { metadata: { reason } } : {}),
          oldData: { status: existing.status },
          newData: { status },
        },
        tx,
      );

      return row;
    });

    return toAccountDetail(updated);
  }

  /**
   * The single definition of reach. A miss is a 404 whether the account belongs
   * to another tenant or does not exist — a 403 would confirm the id is real
   * somewhere else.
   */
  private async findInScope(
    actor: AuthContext,
    accountId: string,
  ): Promise<AccountRow> {
    const row = await this.prisma.account.findFirst({
      where: { orgId: actor.orgId, accountId },
      include: ACCOUNT_INCLUDE,
    });

    if (!row) {
      this.logger.warn(
        `Account ${accountId} not reachable for org ${actor.orgId}`,
      );
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  private assertVersion(row: AccountRow, expectedVersion: string): void {
    if (row.updatedAt.toISOString() !== expectedVersion) {
      throw new ConflictException(STALE);
    }
  }

  private assertConventionalBalance(
    accountType: string,
    normalBalance: string,
  ): void {
    const conventional = CONVENTIONAL_NORMAL_BALANCE[accountType];
    if (conventional && conventional !== normalBalance) {
      // "An asset", not "a asset". The article is chosen from the word rather
      // than hardcoded because ASSET, EQUITY, INCOME and EXPENSE all take "an"
      // while ASSET's neighbours in the enum do not.
      const article = /^[AEIOU]/.test(accountType) ? 'An' : 'A';
      throw new ConflictException(
        `${article} ${accountType.toLowerCase()} account normally carries a ${conventional.toLowerCase()} balance.`,
      );
    }
  }

  /** Rule 39: a control account is driven by its subledger, not posted to. */
  private assertControlNotPostable(
    isControlAccount: boolean | undefined,
    isPostable: boolean | undefined,
  ): void {
    if (isControlAccount && isPostable) {
      throw new ConflictException(
        'A control account is driven by its subsidiary ledger and cannot be posted to directly.',
      );
    }
  }

  private assertEffectiveRange(from?: string | null, to?: string | null): void {
    // String comparison is exact for YYYY-MM-DD and avoids constructing two
    // Dates purely to order them.
    if (from && to && to < from) {
      throw new ConflictException(
        'Effective To must be on or after Effective From.',
      );
    }
  }

  private async assertParentExists(
    actor: AuthContext,
    parentAccountId: string,
  ): Promise<void> {
    const parent = await this.prisma.account.findFirst({
      where: { orgId: actor.orgId, accountId: parentAccountId },
      select: { accountId: true },
    });

    if (!parent) {
      throw new ConflictException(
        'The selected parent account does not exist in this organization.',
      );
    }
  }

  /**
   * Scenario 6. Walks the proposed parent chain looking for the account itself.
   *
   * The database's `accounts_hierarchy_acyclic` trigger is the guarantee — this
   * walk runs outside a lock, so two concurrent edits could each see an acyclic
   * chain and together create a cycle. This exists to name the two accounts
   * involved, which the trigger's message cannot do as legibly.
   */
  private async assertNoCycle(
    actor: AuthContext,
    accountId: string,
    parentAccountId: string,
  ): Promise<void> {
    if (parentAccountId === accountId) {
      throw new ConflictException('An account cannot be its own parent.');
    }

    let cursor: string | null = parentAccountId;
    let depth = 0;

    while (cursor) {
      if (depth > 32) {
        throw new ConflictException(
          'The account hierarchy is too deep to validate.',
        );
      }
      depth += 1;

      if (cursor === accountId) {
        throw new ConflictException(
          'That parent is a descendant of this account, so the change would create a circular hierarchy.',
        );
      }

      const next: { parentAccountId: string | null } | null =
        await this.prisma.account.findFirst({
          where: { orgId: actor.orgId, accountId: cursor },
          select: { parentAccountId: true },
        });

      cursor = next?.parentAccountId ?? null;
    }
  }

  private dateOnly(value: Date | null): string | undefined {
    return value ? value.toISOString().slice(0, 10) : undefined;
  }

  /**
   * Turns Prisma's write failures into answers.
   *
   * `P2002` on the account code is the one a user can act on (Scenario 5).
   * `P2003` is the foreign key from a journal line, which `remove` already
   * pre-checks — reaching it here means the reference appeared between the
   * check and the delete, and the honest answer is the same one.
   */
  private translateAccountWriteError(
    error: unknown,
    accountCode: string,
  ): unknown {
    if (typeof error !== 'object' || error === null) return error;
    const code = (error as { code?: unknown }).code;

    if (code === 'P2002') {
      return new ConflictException(
        `The account code "${accountCode}" is already used in this organization.`,
      );
    }

    if (code === 'P2003') {
      return new ConflictException(
        'This account is referenced by existing records and cannot be changed that way.',
      );
    }

    // A cycle that beat the service's walk-up. The trigger's message names the
    // accounts; surfacing it beats replacing it with something vaguer.
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.includes('circular hierarchy')) {
      return new ConflictException(
        'That change would create a circular account hierarchy.',
      );
    }

    return error;
  }
}
