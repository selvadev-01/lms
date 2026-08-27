import "server-only";

import type {
  AccountDetail,
  AccountSummary,
  AccountTreeNode,
} from "@lms/types";

import { apiGet, apiGetRecord, type FetchFailure } from "@/lib/api-fetch";

/**
 * Chart of accounts data layer (Module 14).
 *
 * Follows `features/collections/api/collections.ts` exactly, including the
 * property that matters most on a financial surface: `apiGetRecord` collapses a
 * 403 into `not-found`, so an account id cannot be confirmed to exist by the
 * shape of the refusal. The API already answers 404 rather than 403 for an
 * out-of-scope row; this keeps the client from reintroducing the distinction.
 *
 * Nothing here filters by branch, and there is no parameter through which one
 * could. Accounts are organization-wide by design — which branch a posting
 * belongs to is carried by the journal entry, not by owning a separate account
 * per branch.
 */

export type AccountListResult =
  { status: "ok"; accounts: AccountSummary[]; total: number } | FetchFailure;

export type AccountDetailResult =
  | { status: "ok"; account: AccountDetail }
  /** Out of scope, another tenant, or absent — deliberately indistinguishable. */
  | { status: "not-found" }
  | FetchFailure;

export type AccountTreeResult =
  { status: "ok"; nodes: AccountTreeNode[] } | FetchFailure;

export async function fetchAccounts(params?: {
  search?: string;
  accountType?: string;
  status?: string;
  postableOnly?: boolean;
  manualPostableOnly?: boolean;
}): Promise<AccountListResult> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.accountType) query.set("accountType", params.accountType);
  if (params?.status) query.set("status", params.status);
  if (params?.postableOnly) query.set("postableOnly", "true");
  if (params?.manualPostableOnly) query.set("manualPostableOnly", "true");

  const suffix = query.toString() ? `?${query.toString()}` : "";

  const result = await apiGet<{ accounts: AccountSummary[]; total: number }>(
    `/accounting/accounts${suffix}`,
  );

  return result.status === "ok"
    ? { status: "ok", accounts: result.data.accounts, total: result.data.total }
    : result;
}

export async function fetchAccount(
  accountId: string,
): Promise<AccountDetailResult> {
  const result = await apiGetRecord<{ account: AccountDetail }>(
    `/accounting/accounts/${encodeURIComponent(accountId)}`,
  );

  return result.status === "ok"
    ? { status: "ok", account: result.data.account }
    : result;
}

/**
 * The whole chart, nested.
 *
 * Unpaginated: a hierarchy with a page boundary through it is not a hierarchy.
 */
export async function fetchAccountTree(): Promise<AccountTreeResult> {
  const result = await apiGet<{ nodes: AccountTreeNode[] }>(
    "/accounting/accounts/tree",
  );

  return result.status === "ok"
    ? { status: "ok", nodes: result.data.nodes }
    : result;
}

/**
 * The accounts a hand-authored journal may reference.
 *
 * Strictly narrower than the full list: a control account such as Loan
 * Receivable is postable by its source module and closed to manual posting, so
 * it never appears in the journal builder's picker. The server refuses one
 * independently, so this is convenience rather than the control.
 */
export async function fetchPostableAccounts(): Promise<AccountListResult> {
  return fetchAccounts({ manualPostableOnly: true, status: "ACTIVE" });
}
