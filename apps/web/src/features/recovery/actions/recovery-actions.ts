"use server";

import {
  assessPenaltySchema,
  assignRecoveryCaseSchema,
  closeRecoveryCaseSchema,
  decideSettlementSchema,
  escalateRecoveryCaseSchema,
  issueLegalNoticeSchema,
  openRecoveryCaseSchema,
  penaltyActionSchema,
  proposeSettlementSchema,
  recordRecoveryActionSchema,
  updateRecoveryActionSchema,
  writeOffLoanSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Overdue and recovery mutations (Module 13).
 *
 * One exported function per authority, never one that branches at runtime. The
 * source denies these separately — Scenarios 42 (assignment), 43 (payment and
 * write-off) and 44 (closure) — and a single function deciding from a body
 * field would put every one of them in reach of whoever could call it.
 *
 * # What is absent, and why
 *
 * **No overdue mutation of any kind.** The overdue position is derived from the
 * schedule and the business date (Rule 4), and Rule 8 forbids a recovery user
 * marking an EMI overdue when the schedule does not support it. The surest way
 * to honour that is to expose no action that could try.
 *
 * **No recovery payment action.** A recovery payment is an ordinary collection
 * and goes through `features/collections` (Rules 15, 16). Adding one here would
 * be the duplicate customer payment record Rule 15 exists to prevent.
 *
 * # Two idempotency conventions
 *
 * Creating acts — opening a case, assessing a penalty, proposing a settlement,
 * writing off — send their key in the **body**, minted once per form *mount*.
 * Acts against a row that already exists carry `expectedVersion` instead: the
 * concurrency token is what makes a retry safe there, because the second
 * attempt sees a version that has moved.
 */

export interface RecoveryFormState extends ActionState {
  /** Populated when the API refused on a lifecycle or closure gate. */
  blockers?: { key: string; reason: string }[];
}

const SERVICE = "Recovery";

const UNAVAILABLE = {
  message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
};

/**
 * Carries the API's 409 blocker list through to the form.
 *
 * Read narrowly off the state rather than casting the whole thing, so a shape
 * change in the error body surfaces as a missing list rather than a runtime
 * throw inside a server action.
 */
function withRefusalDetail(state: ActionState): RecoveryFormState {
  const blockers = (state as { blockers?: unknown }).blockers;

  return {
    ...state,
    ...(Array.isArray(blockers)
      ? { blockers: blockers as { key: string; reason: string }[] }
      : {}),
  };
}

function revalidateCase(recoveryCaseId?: string): void {
  if (recoveryCaseId) {
    revalidatePath(`/recovery-cases/${recoveryCaseId}`);
  }
  revalidatePath("/recovery-cases");
  // The overdue book shows whether a loan has an open case, so it goes stale
  // whenever a case is opened or closed.
  revalidatePath("/overdues");
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export async function openRecoveryCaseAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const parsed = openRecoveryCaseSchema.safeParse({
    loanId: formData.get("loanId"),
    priority: formData.get("priority") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/recovery/cases",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  // `endSession` returns `never`, but TS narrows on the discriminant, so read
  // the body through a widened alias, as every other feature's actions do.
  const created = (outcome as { body?: unknown }).body as {
    recoveryCaseId?: string;
  };
  if (!created.recoveryCaseId) return UNAVAILABLE;

  revalidateCase();
  redirect(`/recovery-cases/${created.recoveryCaseId}`);
}

export async function assignRecoveryCaseAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const recoveryCaseId = String(formData.get("recoveryCaseId") ?? "");

  const parsed = assignRecoveryCaseSchema.safeParse({
    assigneeUserId: formData.get("assigneeUserId"),
    reason: formData.get("reason") ?? undefined,
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/recovery/cases/${recoveryCaseId}/assign`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCase(recoveryCaseId);
  return { success: "Recovery officer assigned." };
}

export async function escalateRecoveryCaseAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const recoveryCaseId = String(formData.get("recoveryCaseId") ?? "");

  const parsed = escalateRecoveryCaseSchema.safeParse({
    reason: formData.get("reason"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/recovery/cases/${recoveryCaseId}/escalate`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCase(recoveryCaseId);
  return { success: "Case escalated." };
}

export async function closeRecoveryCaseAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const recoveryCaseId = String(formData.get("recoveryCaseId") ?? "");

  const parsed = closeRecoveryCaseSchema.safeParse({
    resolutionType: formData.get("resolutionType"),
    closureReason: formData.get("closureReason"),
    approvalReference: formData.get("approvalReference") ?? undefined,
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/recovery/cases/${recoveryCaseId}/close`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCase(recoveryCaseId);
  return { success: "Case closed." };
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export async function recordRecoveryActionAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const recoveryCaseId = String(formData.get("recoveryCaseId") ?? "");

  const parsed = recordRecoveryActionSchema.safeParse({
    actionType: formData.get("actionType"),
    actionDate: formData.get("actionDate"),
    outcome: formData.get("outcome"),
    notes: formData.get("notes") ?? undefined,
    nextFollowUpDate: formData.get("nextFollowUpDate") ?? undefined,
    promiseToPayDate: formData.get("promiseToPayDate") ?? undefined,
    promiseToPayAmountPaise:
      formData.get("promiseToPayAmountPaise") ?? undefined,
    customerAckReference: formData.get("customerAckReference") ?? undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/recovery/cases/${recoveryCaseId}/actions`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCase(recoveryCaseId);
  return { success: "Activity recorded." };
}

export async function updateRecoveryActionAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const recoveryActionId = String(formData.get("recoveryActionId") ?? "");
  const recoveryCaseId = String(formData.get("recoveryCaseId") ?? "");

  const parsed = updateRecoveryActionSchema.safeParse({
    outcome: formData.get("outcome") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    nextFollowUpDate: formData.get("nextFollowUpDate") ?? undefined,
    promiseToPayDate: formData.get("promiseToPayDate") ?? undefined,
    promiseToPayAmountPaise:
      formData.get("promiseToPayAmountPaise") ?? undefined,
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/recovery/actions/${recoveryActionId}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidatePath(`/recovery-actions/${recoveryActionId}`);
  revalidateCase(recoveryCaseId);
  return { success: "Activity updated." };
}

// ---------------------------------------------------------------------------
// Penalties
// ---------------------------------------------------------------------------

/**
 * Assessing penal interest.
 *
 * Sends no amount — the figure comes from the configured rule and the
 * authoritative balances (Rule 12). A form that could name it would decide what
 * a borrower is charged.
 */
export async function assessPenaltyAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const parsed = assessPenaltySchema.safeParse({
    loanId: formData.get("loanId"),
    emiId: formData.get("emiId") ?? undefined,
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/recovery/cases/penalties/assess",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidatePath(`/overdues/${parsed.data.loanId}`);
  revalidateCase(String(formData.get("recoveryCaseId") ?? "") || undefined);
  return { success: "Penalty assessed." };
}

export async function actOnPenaltyAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const penaltyId = String(formData.get("penaltyId") ?? "");

  const parsed = penaltyActionSchema.safeParse({
    action: formData.get("action"),
    amountPaise: formData.get("amountPaise") ?? undefined,
    reason: formData.get("reason"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  // `expectedVersion` guards the *form* against a stale render; the API
  // resolves the penalty's own state and its DTO does not declare the field, so
  // sending it would be refused by `forbidNonWhitelisted`. Rebuilt explicitly
  // rather than destructured away, so a new field added to the schema has to be
  // considered here rather than being forwarded by accident.
  const outcome = await call(
    `/recovery/cases/penalties/${penaltyId}/action`,
    {
      method: "POST",
      body: {
        action: parsed.data.action,
        ...(parsed.data.amountPaise !== undefined
          ? { amountPaise: parsed.data.amountPaise }
          : {}),
        reason: parsed.data.reason,
      },
    },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCase(String(formData.get("recoveryCaseId") ?? "") || undefined);
  return { success: "Penalty updated." };
}

// ---------------------------------------------------------------------------
// Settlements, notices and write-off
// ---------------------------------------------------------------------------

export async function proposeSettlementAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const recoveryCaseId = String(formData.get("recoveryCaseId") ?? "");

  const parsed = proposeSettlementSchema.safeParse({
    settlementAmountPaise: formData.get("settlementAmountPaise"),
    agreedDate: formData.get("agreedDate"),
    reason: formData.get("reason"),
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/recovery/cases/${recoveryCaseId}/settlements`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCase(recoveryCaseId);
  return { success: "Settlement proposed." };
}

/**
 * Approving or rejecting a proposal.
 *
 * A separate authority from proposing (Scenario 44): the officer who agreed
 * terms with a borrower does not also approve forgiving the remainder.
 */
export async function decideSettlementAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const settlementId = String(formData.get("settlementId") ?? "");
  const recoveryCaseId = String(formData.get("recoveryCaseId") ?? "");

  const parsed = decideSettlementSchema.safeParse({
    decision: formData.get("decision"),
    approvalReference: formData.get("approvalReference") ?? undefined,
    reason: formData.get("reason") ?? undefined,
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/recovery/settlements/${settlementId}/decide`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCase(recoveryCaseId);
  return {
    success:
      parsed.data.decision === "APPROVE"
        ? "Settlement approved."
        : "Settlement rejected.",
  };
}

/**
 * Completing an approved settlement.
 *
 * The moment value moves: the forgiven principal is recognised as a loss and
 * the receivable retired. The finance surfaces go stale with it.
 */
export async function completeSettlementAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const settlementId = String(formData.get("settlementId") ?? "");
  const recoveryCaseId = String(formData.get("recoveryCaseId") ?? "");

  const parsed = decideSettlementSchema.safeParse({
    decision: "APPROVE",
    approvalReference: formData.get("approvalReference") ?? undefined,
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/recovery/settlements/${settlementId}/complete`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCase(recoveryCaseId);
  revalidatePath("/finance/ledger");
  return { success: "Settlement completed and posted." };
}

export async function issueLegalNoticeAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const recoveryCaseId = String(formData.get("recoveryCaseId") ?? "");

  const parsed = issueLegalNoticeSchema.safeParse({
    noticeDate: formData.get("noticeDate"),
    noticePeriodDays: Number(formData.get("noticePeriodDays") ?? 30),
    noticeReference: formData.get("noticeReference") ?? undefined,
    documentRef: formData.get("documentRef") ?? undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/recovery/cases/${recoveryCaseId}/notices`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCase(recoveryCaseId);
  return { success: "Legal notice issued." };
}

/**
 * Writing the loan off.
 *
 * The most irreversible act in the module: it posts the loss, moves the loan to
 * WRITTEN_OFF and closes the case. Behind a permission the seed grants to no
 * role, so reaching this form at all is a deliberate configuration choice.
 */
export async function writeOffLoanAction(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const recoveryCaseId = String(formData.get("recoveryCaseId") ?? "");

  const parsed = writeOffLoanSchema.safeParse({
    reason: formData.get("reason"),
    approvalReference: formData.get("approvalReference") ?? undefined,
    idempotencyKey: formData.get("idempotencyKey"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/recovery/cases/${recoveryCaseId}/write-off`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidateCase(recoveryCaseId);
  revalidatePath("/finance/ledger");
  revalidatePath("/loans");
  return { success: "Loan written off." };
}
