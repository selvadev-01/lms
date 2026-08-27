"use server";

import type { DisbursalBlocker } from "@lms/types";
import {
  cancelDisbursementSchema,
  confirmDisbursementSchema,
  failDisbursementSchema,
  recordTransferSchema,
  scheduleDisbursementSchema,
  updateDisbursementScheduleSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Disbursal mutations (Module 09).
 *
 * Each step posts to a route behind its own permission — schedule, record
 * transfer, confirm and cancel are four authorities, not one — so they stay
 * four functions rather than one that decides at runtime which it needs. That
 * split is what lets a Branch Admin hold the first two and be refused the
 * third (Scenarios 29, 30).
 *
 * `expectedVersion` is threaded through every mutation, as in Module 07. The
 * form carries the value it was rendered with, so an operator acting on a stale
 * screen is refused rather than confirming against terms they never saw
 * (Scenarios 41, 42, 45).
 *
 * These actions validate with zod, but the API validates independently with
 * class-validator DTOs and enforces the conditional rules in its service. That
 * is deliberate redundancy, not duplication to collapse: a rule living only
 * here would be enforced on the browser path and nowhere else.
 */

export interface DisbursementFormState extends ActionState {
  /**
   * Populated when the API refused on a gate. The panel re-renders naming each
   * blocker rather than a single message, which is what makes Scenarios 8, 9
   * and 10 legible to the operator instead of just refused.
   */
  blockers?: DisbursalBlocker[];
}

const SERVICE = "Disbursement";

const UNAVAILABLE = {
  message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
};

/**
 * Reads the 409 body the API returns when a gate refuses.
 *
 * Typed narrowly rather than cast: the body is whatever the API sent, and
 * asserting a shape onto it would turn a changed contract into a runtime crash
 * inside a render rather than a missing list.
 */
function blockersFrom(state: ActionState): DisbursalBlocker[] | undefined {
  const body = (state as { blockers?: unknown }).blockers;

  return Array.isArray(body) ? (body as DisbursalBlocker[]) : undefined;
}

function withBlockers(state: ActionState): DisbursementFormState {
  const blockers = blockersFrom(state);

  return blockers ? { ...state, blockers } : state;
}

/** The disbursement id every mutation but `schedule` operates on. */
function idFrom(formData: FormData): string | null {
  const value = formData.get("disbursementId");

  return typeof value === "string" && value ? value : null;
}

function revalidate(disbursementId: string): void {
  revalidatePath(`/loans/disbursements/${disbursementId}`);
  revalidatePath("/loans/disbursements");
}

/**
 * Scenario 5 — schedule a disbursement against a signed agreement.
 *
 * Sends no amount. The figure comes from the sanction letter server-side,
 * which is what makes Rule 6 true by construction rather than by a comparison
 * this form would have to remember.
 */
export async function scheduleDisbursementAction(
  _previous: DisbursementFormState,
  formData: FormData,
): Promise<DisbursementFormState> {
  const parsed = scheduleDisbursementSchema.safeParse({
    applicationId: formData.get("applicationId"),
    disbursementDate: formData.get("disbursementDate"),
    disbursementAccountId: formData.get("disbursementAccountId"),
    notes: formData.get("notes"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/loans/disbursements",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withBlockers(outcome.state);

  // `endSession` returns `never`, but TS narrows on the discriminant rather
  // than on that, so the "session-ended" arm is still in the union here. Read
  // the body through a widened alias, as every other feature's actions do.
  const created = (outcome as { body?: unknown }).body as {
    disbursementId?: string;
  };

  if (!created.disbursementId) return UNAVAILABLE;

  revalidatePath("/loans/disbursements");
  // Redirect rather than return: the disbursement now exists, and leaving the
  // operator on the schedule form would invite a second one against the same
  // loan.
  redirect(`/loans/disbursements/${created.disbursementId}`);
}

/** Scenarios 11, 12 — refused once a transfer has been recorded. */
export async function updateScheduleAction(
  _previous: DisbursementFormState,
  formData: FormData,
): Promise<DisbursementFormState> {
  const disbursementId = idFrom(formData);
  if (!disbursementId) return UNAVAILABLE;

  const parsed = updateDisbursementScheduleSchema.safeParse({
    disbursementDate: formData.get("disbursementDate"),
    disbursementAccountId: formData.get("disbursementAccountId"),
    notes: formData.get("notes"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loans/disbursements/${encodeURIComponent(disbursementId)}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withBlockers(outcome.state);

  revalidate(disbursementId);

  return { success: "Disbursement schedule updated." };
}

/**
 * Scenarios 14-17 — record that the transfer was made.
 *
 * The amount is sent so the server can *compare* it against the sanctioned
 * figure and refuse a mismatch (Scenario 6). It is never what gets posted.
 */
export async function recordTransferAction(
  _previous: DisbursementFormState,
  formData: FormData,
): Promise<DisbursementFormState> {
  const disbursementId = idFrom(formData);
  if (!disbursementId) return UNAVAILABLE;

  const parsed = recordTransferSchema.safeParse({
    paymentMode: formData.get("paymentMode"),
    amountPaise: formData.get("amountPaise"),
    transactionReference: formData.get("transactionReference"),
    transferDate: formData.get("transferDate"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loans/disbursements/${encodeURIComponent(disbursementId)}/transfer`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withBlockers(outcome.state);

  revalidate(disbursementId);

  return {
    success: "Fund transfer recorded. Confirm to complete the disbursement.",
  };
}

/**
 * Scenarios 19-24, 27, 28 — the irreversible one.
 *
 * The idempotency key arrives from the form, where it is minted once per mount
 * rather than per submit. A key regenerated on retry would defeat the whole
 * mechanism: the point is that a retried confirmation after a timeout returns
 * the original result instead of moving money twice.
 */
export async function confirmDisbursementAction(
  _previous: DisbursementFormState,
  formData: FormData,
): Promise<DisbursementFormState> {
  const disbursementId = idFrom(formData);
  if (!disbursementId) return UNAVAILABLE;

  const parsed = confirmDisbursementSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loans/disbursements/${encodeURIComponent(disbursementId)}/confirm`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withBlockers(outcome.state);

  revalidate(disbursementId);
  revalidatePath("/loans/applications");

  return { success: "Disbursement confirmed. The loan is now active." };
}

/**
 * Scenario 26 — the transfer failed.
 *
 * The loan is not disbursed and the disbursement returns to SCHEDULED, so the
 * operator can record a fresh transfer without re-scheduling (Rule 16).
 */
export async function markFailedAction(
  _previous: DisbursementFormState,
  formData: FormData,
): Promise<DisbursementFormState> {
  const disbursementId = idFrom(formData);
  if (!disbursementId) return UNAVAILABLE;

  const parsed = failDisbursementSchema.safeParse({
    failureReason: formData.get("failureReason"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loans/disbursements/${encodeURIComponent(disbursementId)}/fail`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withBlockers(outcome.state);

  revalidate(disbursementId);

  return { success: "Transfer failure recorded. You can retry the transfer." };
}

/**
 * Scenarios 37, 38 — cancel a scheduled disbursement.
 *
 * Never a delete. Rules 30 and 31 forbid removing a financial record, and a
 * completed disbursement is refused outright by the API.
 */
export async function cancelDisbursementAction(
  _previous: DisbursementFormState,
  formData: FormData,
): Promise<DisbursementFormState> {
  const disbursementId = idFrom(formData);
  if (!disbursementId) return UNAVAILABLE;

  const parsed = cancelDisbursementSchema.safeParse({
    cancellationReason: formData.get("cancellationReason"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loans/disbursements/${encodeURIComponent(disbursementId)}/cancel`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withBlockers(outcome.state);

  revalidatePath("/loans/disbursements");
  redirect("/loans/disbursements");
}
