"use server";

import type { AllocationPreview, CollectionBlocker } from "@lms/types";
import {
  postCollectionSchema,
  previewAllocationSchema,
  reverseCollectionSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * EMI collection mutations (Module 11).
 *
 * Posting and reversal are two authorities, not one — a Branch Admin holds the
 * first and is refused the second — so they stay two functions rather than one
 * that decides at runtime which it needs (Scenario 36).
 *
 * These actions validate with zod, but the API validates independently with
 * class-validator DTOs and enforces the conditional rules in its service. That
 * is deliberate redundancy, not duplication to collapse: a rule living only
 * here would be enforced on the browser path and nowhere else.
 *
 * # The idempotency key is minted by the form, not here
 *
 * A key generated inside this action would be new on every submit, which
 * defeats the entire mechanism — the retry would look like a different payment
 * and post a second time. The form mints one per *mount* and sends it; this
 * action only passes it through.
 */

export interface CollectionFormState extends ActionState {
  /**
   * Populated when the API refused on an eligibility gate. The form re-renders
   * naming each blocker rather than a single message, which is what makes
   * Scenarios 29, 30 and 45 legible to the operator instead of just refused.
   */
  blockers?: CollectionBlocker[];
  /**
   * Populated when the amount exceeded what is owed. Carrying the exact figure
   * lets the form offer it rather than leaving the user to guess — a borrower
   * tendering a round rupee sum a few paise over is otherwise just refused.
   */
  maxCollectablePaise?: string;
}

const SERVICE = "Collection";

const UNAVAILABLE = {
  message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
};

/**
 * Reads the structured body the API returns when it refuses.
 *
 * Typed narrowly rather than cast: the body is whatever the API sent, and
 * asserting a shape onto it would turn a changed contract into a runtime crash
 * inside a render rather than a missing list.
 */
function blockersFrom(state: ActionState): CollectionBlocker[] | undefined {
  const body = (state as { blockers?: unknown }).blockers;

  return Array.isArray(body) ? (body as CollectionBlocker[]) : undefined;
}

function withRefusalDetail(state: ActionState): CollectionFormState {
  const blockers = blockersFrom(state);
  const max = (state as { maxCollectablePaise?: unknown }).maxCollectablePaise;

  return {
    ...state,
    ...(blockers ? { blockers } : {}),
    ...(typeof max === "string" ? { maxCollectablePaise: max } : {}),
  };
}

function revalidate(collectionId?: string): void {
  if (collectionId) revalidatePath(`/loans/collections/${collectionId}`);
  revalidatePath("/loans/collections");
}

/**
 * Scenarios 5, 12, 19, 20 — record and post a collection.
 *
 * Sends an amount, never an allocation. The split is recomputed server-side
 * from authoritative balances, which is what makes Rules 12-14 true by
 * construction rather than by a calculation this form would have to keep in
 * step.
 */
export async function postCollectionAction(
  _previous: CollectionFormState,
  formData: FormData,
): Promise<CollectionFormState> {
  const parsed = postCollectionSchema.safeParse({
    loanId: formData.get("loanId"),
    collectionDate: formData.get("collectionDate"),
    paymentMode: formData.get("paymentMode"),
    amountPaise: formData.get("amountPaise"),
    transactionReference: formData.get("transactionReference"),
    idempotencyKey: formData.get("idempotencyKey"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/loans/collections",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  // `endSession` returns `never`, but TS narrows on the discriminant rather
  // than on that, so the "session-ended" arm is still in the union here. Read
  // the body through a widened alias, as every other feature's actions do.
  const created = (outcome as { body?: unknown }).body as {
    collectionId?: string;
  };

  if (!created.collectionId) return UNAVAILABLE;

  revalidate();
  // Redirect rather than return: the money has moved and a receipt exists.
  // Leaving the operator on a filled-in form invites a second collection
  // against the same loan — and with a fresh key, the idempotency guard would
  // not catch it.
  redirect(`/loans/collections/${created.collectionId}`);
}

/**
 * Scenarios 6, 7, 8 — what a given amount would settle.
 *
 * Writes nothing. Asked of the server rather than computed in the browser even
 * though `@lms/emi` is importable here: the preview must agree with what
 * posting will actually do, and the only way to guarantee that is for both to
 * run the same function against the same server-held balances.
 */
export async function previewAllocationAction(
  loanId: string,
  amountPaise: string,
): Promise<{ status: "ok"; preview: AllocationPreview } | CollectionFormState> {
  const parsed = previewAllocationSchema.safeParse({ loanId, amountPaise });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/loans/collections/preview-allocation",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  const preview = (outcome as { body?: unknown }).body as AllocationPreview;

  return preview ? { status: "ok", preview } : UNAVAILABLE;
}

/**
 * Scenarios 31-34 — reverse a posted collection.
 *
 * Behind its own permission, which a Branch Admin does not hold. Carries
 * `expectedVersion`, so an operator acting on a stale screen is refused rather
 * than reversing a collection that has already changed (Scenario 26).
 */
export async function reverseCollectionAction(
  _previous: CollectionFormState,
  formData: FormData,
): Promise<CollectionFormState> {
  const value = formData.get("collectionId");
  const collectionId = typeof value === "string" && value ? value : null;
  if (!collectionId) return UNAVAILABLE;

  const parsed = reverseCollectionSchema.safeParse({
    reversalReason: formData.get("reversalReason"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loans/collections/${encodeURIComponent(collectionId)}/reverse`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidate(collectionId);

  return { success: "Collection reversed. The original record is preserved." };
}
