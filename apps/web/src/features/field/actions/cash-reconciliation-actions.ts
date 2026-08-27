"use server";

import {
  createReconciliationSchema,
  resolveDiscrepancySchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Cash reconciliation mutations (Module 12).
 *
 * Counting and resolving are two authorities, and the split is the point:
 * finding a drawer short is branch work, deciding who bears the shortage is the
 * approval authority's. One function covering both would let a branch discover
 * and forgive its own discrepancies (Scenario 30).
 *
 * Neither writes a journal. An accounting adjustment, where one is needed, goes
 * through Module 14's manual journal and its entry number is recorded here as
 * the approval reference (Scenario 29).
 */

export interface ReconciliationFormState extends ActionState {
  blockers?: { key: string; reason: string }[];
}

const SERVICE = "Cash Reconciliation";

const UNAVAILABLE = {
  message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
};

function withRefusalDetail(state: ActionState): ReconciliationFormState {
  const blockers = (state as { blockers?: unknown }).blockers;

  return {
    ...state,
    ...(Array.isArray(blockers)
      ? { blockers: blockers as { key: string; reason: string }[] }
      : {}),
  };
}

function revalidate(reconciliationId?: string): void {
  revalidatePath("/field/cash-reconciliation");
  revalidatePath("/field/cash-handovers");
  if (reconciliationId) {
    revalidatePath(`/field/cash-reconciliation/${reconciliationId}`);
  }
}

/** Scenarios 26-28 — count the cash against a received handover. */
export async function createReconciliationAction(
  _previous: ReconciliationFormState,
  formData: FormData,
): Promise<ReconciliationFormState> {
  const parsed = createReconciliationSchema.safeParse({
    handoverId: formData.get("handoverId"),
    actualCashPaise: formData.get("actualCashPaise"),
    notes: formData.get("notes") || undefined,
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/field/cash-reconciliations",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  const created = (outcome as { body?: unknown }).body as {
    reconciliationId?: string;
  };

  if (!created.reconciliationId) return UNAVAILABLE;

  revalidate();
  redirect(`/field/cash-reconciliation/${created.reconciliationId}`);
}

/**
 * Scenario 29 — resolve a pending shortage or excess.
 *
 * Behind its own permission, which a Branch Admin does not hold. Records what
 * was decided and leaves the counted figures untouched — the append-only
 * trigger would refuse them anyway, which is what makes "the original values
 * remain historically traceable" a database fact rather than a promise.
 */
export async function resolveDiscrepancyAction(
  _previous: ReconciliationFormState,
  formData: FormData,
): Promise<ReconciliationFormState> {
  const value = formData.get("reconciliationId");
  const reconciliationId = typeof value === "string" && value ? value : null;
  if (!reconciliationId) return UNAVAILABLE;

  const parsed = resolveDiscrepancySchema.safeParse({
    discrepancyType: formData.get("discrepancyType"),
    discrepancyReason: formData.get("discrepancyReason"),
    resolutionAction: formData.get("resolutionAction"),
    resolutionNotes: formData.get("resolutionNotes") || undefined,
    approvalReference: formData.get("approvalReference") || undefined,
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/field/cash-reconciliations/${encodeURIComponent(reconciliationId)}/resolve`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidate(reconciliationId);

  return {
    success:
      "Discrepancy resolved. The counted figures are unchanged and remain on record.",
  };
}
