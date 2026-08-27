"use server";

import {
  activateAccountSchema,
  createAccountSchema,
  deactivateAccountSchema,
  updateAccountSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Chart-of-accounts mutations (Module 14).
 *
 * These validate with zod, but the API validates independently with
 * class-validator DTOs and enforces the rest in its service and its database
 * triggers. That is deliberate redundancy rather than duplication to collapse:
 * a rule living only here would be enforced on the browser path and nowhere
 * else.
 *
 * Deleting and deactivating stay two functions rather than one that decides at
 * runtime. Deleting an account is legal only while nothing references it, and
 * for every account that has ever been posted to the answer is "deactivate
 * instead" — a distinction the caller has to make deliberately.
 */

export interface AccountFormState extends ActionState {
  /**
   * Populated when a delete was refused because something references the
   * account. Naming each blocker is what makes "deactivate instead" actionable
   * rather than merely a refusal.
   */
  blockedBy?: Array<{ entity: string; label: string; count: number }>;
}

const SERVICE = "Chart of Accounts";

const UNAVAILABLE = {
  message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
};

function revalidate(accountId?: string): void {
  if (accountId) revalidatePath(`/finance/accounts/${accountId}`);
  revalidatePath("/finance/accounts");
}

/** Scenarios 4, 5, 6, 65 — create an account. */
export async function createAccountAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const parsed = createAccountSchema.safeParse({
    accountCode: formData.get("accountCode"),
    accountName: formData.get("accountName"),
    accountType: formData.get("accountType"),
    normalBalance: formData.get("normalBalance"),
    status: formData.get("status"),
    accountCategory: formData.get("accountCategory"),
    parentAccountId: formData.get("parentAccountId") || undefined,
    description: formData.get("description"),
    isPostable: formData.get("isPostable") === "on",
    isManualPostingAllowed: formData.get("isManualPostingAllowed") === "on",
    isControlAccount: formData.get("isControlAccount") === "on",
    branchScope: formData.get("branchScope") || undefined,
    effectiveFrom: formData.get("effectiveFrom") || undefined,
    effectiveTo: formData.get("effectiveTo") || undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/accounting/accounts",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  const created = (outcome as { body?: unknown }).body as {
    account?: { accountId?: string };
  };

  if (!created.account?.accountId) return UNAVAILABLE;

  revalidate();
  redirect(`/finance/accounts/${created.account.accountId}`);
}

/**
 * Scenarios 7, 8 — edit an account.
 *
 * Carries `expectedVersion`, so an operator acting on a stale screen is refused
 * rather than overwriting a change they never saw. Identity fields are sent
 * whether or not they changed: whether they *may* change depends on how many
 * posted lines reference the account, which is the server's answer to give.
 */
export async function updateAccountAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const value = formData.get("accountId");
  const accountId = typeof value === "string" && value ? value : null;
  if (!accountId) return UNAVAILABLE;

  const parsed = updateAccountSchema.safeParse({
    accountCode: formData.get("accountCode"),
    accountName: formData.get("accountName"),
    accountType: formData.get("accountType"),
    normalBalance: formData.get("normalBalance"),
    accountCategory: formData.get("accountCategory"),
    parentAccountId: formData.get("parentAccountId") || undefined,
    description: formData.get("description"),
    isPostable: formData.get("isPostable") === "on",
    isManualPostingAllowed: formData.get("isManualPostingAllowed") === "on",
    isControlAccount: formData.get("isControlAccount") === "on",
    branchScope: formData.get("branchScope") || undefined,
    effectiveFrom: formData.get("effectiveFrom") || undefined,
    effectiveTo: formData.get("effectiveTo") || undefined,
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/accounting/accounts/${encodeURIComponent(accountId)}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidate(accountId);

  return { success: "Account updated." };
}

/**
 * Scenario 9 — deactivate an account.
 *
 * The account stays visible for historical reporting and stops accepting new
 * postings. Nothing about the entries that already reference it changes.
 */
export async function deactivateAccountAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const value = formData.get("accountId");
  const accountId = typeof value === "string" && value ? value : null;
  if (!accountId) return UNAVAILABLE;

  const parsed = deactivateAccountSchema.safeParse({
    reason: formData.get("reason"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/accounting/accounts/${encodeURIComponent(accountId)}/deactivate`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidate(accountId);

  return {
    success:
      "Account deactivated. It stays available for historical reporting and will not accept new postings.",
  };
}

export async function activateAccountAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const value = formData.get("accountId");
  const accountId = typeof value === "string" && value ? value : null;
  if (!accountId) return UNAVAILABLE;

  const parsed = activateAccountSchema.safeParse({
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/accounting/accounts/${encodeURIComponent(accountId)}/activate`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidate(accountId);

  return { success: "Account activated." };
}

/**
 * Scenario 10 — delete an account, which usually refuses.
 *
 * Only an account nothing references can be removed. Anything else comes back
 * as a 409 naming the blockers, which `call` forwards on `blockedBy`.
 */
export async function deleteAccountAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const value = formData.get("accountId");
  const accountId = typeof value === "string" && value ? value : null;
  if (!accountId) return UNAVAILABLE;

  const outcome = await call(
    `/accounting/accounts/${encodeURIComponent(accountId)}`,
    { method: "DELETE" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidate();
  redirect("/finance/accounts");
}
