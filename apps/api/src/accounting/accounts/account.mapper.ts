import type {
  AccountDetail,
  AccountSummary,
  AccountTreeNode,
} from '@lms/types';

/**
 * Prisma rows to the chart-of-accounts API shapes.
 *
 * The row types are hand-written structural interfaces rather than the
 * generated Prisma payload types, following `collection.mapper.ts`: the mapper
 * stays readable, and a spec can build one by hand without a database.
 */

export const ACCOUNT_INCLUDE = {
  parentAccount: { select: { accountId: true, accountCode: true } },
  _count: { select: { journalLines: true, childAccounts: true } },
} as const;

export interface AccountRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: string;
  status: string;
  isPostable: boolean;
  isManualPostingAllowed: boolean;
  isControlAccount: boolean;
  branchScope: string;
  parentAccountId: string | null;
  accountCategory: string | null;
  description: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
  parentAccount?: { accountId: string; accountCode: string } | null;
  _count?: { journalLines: number; childAccounts: number };
}

export function toAccountSummary(row: AccountRow): AccountSummary {
  return {
    accountId: row.accountId,
    accountCode: row.accountCode,
    accountName: row.accountName,
    accountType: row.accountType as AccountSummary['accountType'],
    normalBalance: row.normalBalance as AccountSummary['normalBalance'],
    status: row.status as AccountSummary['status'],
    isPostable: row.isPostable,
    isManualPostingAllowed: row.isManualPostingAllowed,
    isControlAccount: row.isControlAccount,
    branchScope: row.branchScope as AccountSummary['branchScope'],
    ...(row.parentAccountId ? { parentAccountId: row.parentAccountId } : {}),
    ...(row.parentAccount
      ? { parentAccountCode: row.parentAccount.accountCode }
      : {}),
    ...(row.accountCategory ? { accountCategory: row.accountCategory } : {}),
    // The optimistic-concurrency token. `updatedAt` rather than an Int counter,
    // matching every other module in the codebase.
    version: row.updatedAt.toISOString(),
  };
}

export function toAccountDetail(row: AccountRow): AccountDetail {
  const postedLineCount = row._count?.journalLines ?? 0;
  const childAccountCount = row._count?.childAccounts ?? 0;

  return {
    ...toAccountSummary(row),
    ...(row.description ? { description: row.description } : {}),
    // DATE columns, not timestamps: sliced rather than serialized whole so a
    // timezone shift cannot move the day.
    ...(row.effectiveFrom
      ? { effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10) }
      : {}),
    ...(row.effectiveTo
      ? { effectiveTo: row.effectiveTo.toISOString().slice(0, 10) }
      : {}),
    createdAt: row.createdAt.toISOString(),
    postedLineCount,
    childAccountCount,
    /**
     * The server's verdicts, so the UI never re-derives a lifecycle rule.
     *
     * A client computing these itself would need to know about posted lines,
     * child accounts and disbursement references, and would be wrong the first
     * time any of those changed.
     */
    canDelete: postedLineCount === 0 && childAccountCount === 0,
    canEditIdentity: postedLineCount === 0,
  };
}

/**
 * Assembles the flat account list into its hierarchy.
 *
 * Built in one pass over a map rather than by recursive querying: the chart is
 * small, and a query per level would be a request count that grows with the
 * depth of somebody's account structure.
 *
 * An account whose parent is missing from the input — because a filter excluded
 * it, not because the data is broken — is returned at the top level rather than
 * dropped. Silently omitting it would make a filtered tree lie about what the
 * organization has.
 */
export function toAccountTree(rows: AccountRow[]): AccountTreeNode[] {
  const nodes = new Map<string, AccountTreeNode>();
  for (const row of rows) {
    nodes.set(row.accountId, { ...toAccountSummary(row), children: [] });
  }

  const roots: AccountTreeNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.accountId)!;
    const parent = row.parentAccountId
      ? nodes.get(row.parentAccountId)
      : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
