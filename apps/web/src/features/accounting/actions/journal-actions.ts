"use server";

import type { JournalValidation } from "@lms/types";
import {
  createJournalSchema,
  postJournalSchema,
  reverseJournalSchema,
  updateJournalSchema,
  validateJournalSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Journal mutations (Module 14).
 *
 * Authoring, posting and reversing are three authorities, not one — a Branch
 * Admin holds the first and is refused the other two — so they stay three
 * functions rather than one that decides at runtime which it needs (Scenarios
 * 44, 49, 50).
 *
 * # The idempotency key is minted by the form, not here
 *
 * A key generated inside an action would be new on every submit, which defeats
 * the entire mechanism: the retry would look like a different journal and post
 * a second time. The form mints one per *mount* and sends it; these actions
 * only pass it through.
 */

export interface JournalFormState extends ActionState {
  /**
   * Populated when the API refused with a structured list of what is wrong.
   * Re-rendering each issue against its line is what makes a refusal legible
   * rather than merely final.
   */
  issues?: Array<{ code: string; message: string; lineNumber?: number }>;
}

const SERVICE = "Journal";

const UNAVAILABLE = {
  message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
};

/**
 * Reads the structured issue list the API returns when it refuses.
 *
 * Typed narrowly rather than cast: the body is whatever the API sent, and
 * asserting a shape onto it would turn a changed contract into a runtime crash
 * inside a render rather than a missing list.
 */
function withIssues(state: ActionState): JournalFormState {
  const body = (state as { issues?: unknown }).issues;

  return Array.isArray(body)
    ? { ...state, issues: body as JournalFormState["issues"] }
    : state;
}

function revalidate(journalEntryId?: string): void {
  if (journalEntryId) revalidatePath(`/finance/journals/${journalEntryId}`);
  revalidatePath("/finance/journals");
  // A posting changes every balance the ledger reports.
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/trial-balance");
}

/**
 * Reads the line rows out of a `FormData`.
 *
 * The builder submits four parallel arrays rather than indexed names —
 * `lineAccountId`, `lineDebitPaise`, `lineCreditPaise`, `lineDescription` —
 * which are zipped positionally here. Indexed names (`lines[0].accountId`)
 * would have to survive a row being removed from the middle, and a gap in the
 * indices is a bug waiting to happen; parallel arrays cannot develop one.
 *
 * Rows with no account are dropped: a blank row the operator added and never
 * filled in is not a line they meant to post.
 */
function linesFrom(formData: FormData): Array<{
  accountId: string;
  debitPaise: string;
  creditPaise: string;
  description?: string;
}> {
  const accountIds = formData.getAll("lineAccountId");
  const debits = formData.getAll("lineDebitPaise");
  const credits = formData.getAll("lineCreditPaise");
  const descriptions = formData.getAll("lineDescription");

  const lines: Array<{
    accountId: string;
    debitPaise: string;
    creditPaise: string;
    description?: string;
  }> = [];

  for (let index = 0; index < accountIds.length; index += 1) {
    const accountId = String(accountIds[index] ?? "");
    if (!accountId) continue;

    const description = String(descriptions[index] ?? "");

    lines.push({
      accountId,
      debitPaise: String(debits[index] ?? "0"),
      creditPaise: String(credits[index] ?? "0"),
      ...(description ? { description } : {}),
    });
  }

  return lines;
}

function headerFrom(formData: FormData) {
  return {
    entryDate: formData.get("entryDate"),
    entryType: formData.get("entryType"),
    description: formData.get("description"),
    adjustmentReason: formData.get("adjustmentReason"),
    approvalReference: formData.get("approvalReference"),
    lines: linesFrom(formData),
  };
}

/**
 * Scenarios 13-18 — what a set of lines would do, without saving it.
 *
 * Asked of the server rather than computed in the browser even though the
 * totals are simple: the answer must agree with what posting will actually do,
 * and the only way to guarantee that is for both to run the same checks against
 * the same server-held accounts.
 */
export async function validateJournalAction(
  formData: FormData,
): Promise<{ status: "ok"; validation: JournalValidation } | JournalFormState> {
  const parsed = validateJournalSchema.safeParse(headerFrom(formData));

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/accounting/journals/validate",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withIssues(outcome.state);

  const body = (outcome as { body?: unknown }).body as {
    validation?: JournalValidation;
  };

  return body.validation
    ? { status: "ok", validation: body.validation }
    : UNAVAILABLE;
}

/**
 * Scenario 12 — save a draft.
 *
 * A draft may be unbalanced and may be mid-build; that is what the Module 14
 * trigger rewrite made legal, and the balance decision moves to the moment it
 * is posted. Nothing here moves money: the ledger and the trial balance filter
 * on posted entries.
 */
export async function createJournalAction(
  _previous: JournalFormState,
  formData: FormData,
): Promise<JournalFormState> {
  const parsed = createJournalSchema.safeParse({
    ...headerFrom(formData),
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/accounting/journals",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withIssues(outcome.state);

  const created = (outcome as { body?: unknown }).body as {
    journal?: { journalEntryId?: string };
  };

  if (!created.journal?.journalEntryId) return UNAVAILABLE;

  revalidate();
  redirect(`/finance/journals/${created.journal.journalEntryId}`);
}

/** Scenarios 35, 57 — edit a draft. Lines are replaced wholesale. */
export async function updateJournalAction(
  _previous: JournalFormState,
  formData: FormData,
): Promise<JournalFormState> {
  const value = formData.get("journalEntryId");
  const journalEntryId = typeof value === "string" && value ? value : null;
  if (!journalEntryId) return UNAVAILABLE;

  const parsed = updateJournalSchema.safeParse({
    ...headerFrom(formData),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/accounting/journals/${encodeURIComponent(journalEntryId)}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withIssues(outcome.state);

  revalidate(journalEntryId);

  return { success: "Draft saved." };
}

/** Scenario 38 — discard a draft. */
export async function deleteJournalAction(
  _previous: JournalFormState,
  formData: FormData,
): Promise<JournalFormState> {
  const value = formData.get("journalEntryId");
  const journalEntryId = typeof value === "string" && value ? value : null;
  if (!journalEntryId) return UNAVAILABLE;

  const outcome = await call(
    `/accounting/journals/${encodeURIComponent(journalEntryId)}`,
    { method: "DELETE" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withIssues(outcome.state);

  revalidate();
  redirect("/finance/journals");
}

/**
 * Scenarios 28-31 — post a draft to the authoritative ledger.
 *
 * Behind its own permission, which a Branch Admin does not hold. The
 * `Idempotency-Key` the API requires is sent in the body here and lifted to a
 * header by `call` — a retry after a lost response must return the posting that
 * already happened rather than making a second one.
 */
export async function postJournalAction(
  _previous: JournalFormState,
  formData: FormData,
): Promise<JournalFormState> {
  const value = formData.get("journalEntryId");
  const journalEntryId = typeof value === "string" && value ? value : null;
  if (!journalEntryId) return UNAVAILABLE;

  const key = formData.get("idempotencyKey");
  if (typeof key !== "string" || !key) return UNAVAILABLE;

  const parsed = postJournalSchema.safeParse({
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/accounting/journals/${encodeURIComponent(journalEntryId)}/post`,
    { method: "POST", body: parsed.data, idempotencyKey: key },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withIssues(outcome.state);

  revalidate(journalEntryId);

  return { success: "Journal posted to the ledger." };
}

/**
 * Scenarios 39-42 — reverse a posted journal.
 *
 * Behind its own permission again, and a different one from posting: unwinding
 * a committed posting is the approval authority's act. The original is
 * preserved; a new opposite entry is written and the original marked reversed.
 */
export async function reverseJournalAction(
  _previous: JournalFormState,
  formData: FormData,
): Promise<JournalFormState> {
  const value = formData.get("journalEntryId");
  const journalEntryId = typeof value === "string" && value ? value : null;
  if (!journalEntryId) return UNAVAILABLE;

  const key = formData.get("idempotencyKey");
  if (typeof key !== "string" || !key) return UNAVAILABLE;

  const parsed = reverseJournalSchema.safeParse({
    reversalReason: formData.get("reversalReason"),
    entryDate: formData.get("entryDate") || undefined,
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/accounting/journals/${encodeURIComponent(journalEntryId)}/reverse`,
    { method: "POST", body: parsed.data, idempotencyKey: key },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withIssues(outcome.state);

  const created = (outcome as { body?: unknown }).body as {
    journal?: { journalEntryId?: string };
  };

  revalidate(journalEntryId);

  if (created.journal?.journalEntryId) {
    redirect(`/finance/journals/${created.journal.journalEntryId}`);
  }

  return { success: "Journal reversed. The original entry is preserved." };
}
