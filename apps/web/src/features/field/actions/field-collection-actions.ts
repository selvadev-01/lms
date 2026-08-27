"use server";

import type { CollectionBlocker } from "@lms/types";
import {
  recordFieldCollectionSchema,
  syncFieldCollectionSchema,
  verifyCollectionSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Field collection mutations (Module 12).
 *
 * Recording, syncing and verifying are three authorities, not one — an agent
 * records and syncs, a supervisor verifies — so they stay three functions
 * rather than one that decides at runtime which it needs. Collapsing them
 * would make the permission boundary a runtime branch instead of a routing
 * decision (Scenarios 42, 44).
 *
 * These actions validate with zod, and the API validates independently with
 * class-validator DTOs. That is deliberate redundancy: a rule living only here
 * would be enforced on the browser path and nowhere else.
 *
 * # The idempotency key is minted by the form
 *
 * A key generated inside an action would be new on every submit, defeating the
 * mechanism entirely — the retry would look like a different payment and post a
 * second time. The form mints one per *mount*; these actions pass it through.
 */

export interface FieldCollectionFormState extends ActionState {
  /** Populated when the API refused on an eligibility gate. */
  blockers?: CollectionBlocker[];
  maxCollectablePaise?: string;
}

const SERVICE = "Field Collection";

const UNAVAILABLE = {
  message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
};

/**
 * Reads the structured refusal body without asserting a shape onto it.
 *
 * Typed narrowly rather than cast whole: the body is whatever the API sent, and
 * asserting would turn a changed contract into a runtime crash inside a render.
 */
function withRefusalDetail(state: ActionState): FieldCollectionFormState {
  const blockers = (state as { blockers?: unknown }).blockers;
  const max = (state as { maxCollectablePaise?: unknown }).maxCollectablePaise;

  return {
    ...state,
    ...(Array.isArray(blockers)
      ? { blockers: blockers as CollectionBlocker[] }
      : {}),
    ...(typeof max === "string" ? { maxCollectablePaise: max } : {}),
  };
}

/** The evidence fields both the record and sync bodies carry. */
function evidenceFrom(formData: FormData) {
  return {
    gpsCaptureStatus: formData.get("gpsCaptureStatus"),
    // Empty strings become undefined so an absent optional field is absent
    // rather than a blank uuid that fails the format check with a confusing
    // message.
    gpsCheckInId: formData.get("gpsCheckInId") || undefined,
    fieldVisitId: formData.get("fieldVisitId") || undefined,
    customerAckReference: formData.get("customerAckReference") || undefined,
    deviceId: formData.get("deviceId"),
  };
}

function collectionBodyFrom(formData: FormData) {
  return {
    loanId: formData.get("loanId"),
    collectionDate: formData.get("collectionDate"),
    paymentMode: formData.get("paymentMode"),
    amountPaise: formData.get("amountPaise"),
    transactionReference: formData.get("transactionReference") || undefined,
    idempotencyKey: formData.get("idempotencyKey"),
    notes: formData.get("notes") || undefined,
  };
}

/** Scenarios 6-8 — record a collection taken in the field. */
export async function recordFieldCollectionAction(
  _previous: FieldCollectionFormState,
  formData: FormData,
): Promise<FieldCollectionFormState> {
  const parsed = recordFieldCollectionSchema.safeParse({
    ...collectionBodyFrom(formData),
    ...evidenceFrom(formData),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/field/collections",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  // TypeScript still has "session-ended" in the union here; read the body
  // through a widened alias rather than narrowing a branch that cannot occur.
  const created = (outcome as { body?: unknown }).body as {
    collectionId?: string;
  };

  if (!created.collectionId) return UNAVAILABLE;

  revalidatePath("/field/collections");
  redirect(`/field/collections/${created.collectionId}`);
}

/** Scenarios 14-17 — post a collection captured offline. */
export async function syncFieldCollectionAction(
  _previous: FieldCollectionFormState,
  formData: FormData,
): Promise<FieldCollectionFormState> {
  const parsed = syncFieldCollectionSchema.safeParse({
    ...collectionBodyFrom(formData),
    ...evidenceFrom(formData),
    offlineTransactionUuid: formData.get("offlineTransactionUuid"),
    collectedAt: formData.get("collectedAt"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/field/collections/sync",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  const created = (outcome as { body?: unknown }).body as {
    collectionId?: string;
  };

  if (!created.collectionId) return UNAVAILABLE;

  revalidatePath("/field/collections");
  revalidatePath("/field/sync-queue");
  redirect(`/field/collections/${created.collectionId}`);
}

/**
 * Confirm or reject a collection captured offline.
 *
 * Moves no money. A rejection records a judgement about whether the capture was
 * genuine; it does **not** reverse the collection, because reversal is its own
 * permission and its own act (Scenario 38).
 */
export async function verifyCollectionAction(
  _previous: FieldCollectionFormState,
  formData: FormData,
): Promise<FieldCollectionFormState> {
  const value = formData.get("collectionId");
  const collectionId = typeof value === "string" && value ? value : null;
  if (!collectionId) return UNAVAILABLE;

  const parsed = verifyCollectionSchema.safeParse({
    decision: formData.get("decision"),
    verificationNotes: formData.get("verificationNotes") || undefined,
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/field/collections/${encodeURIComponent(collectionId)}/verify`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return withRefusalDetail(outcome.state);

  revalidatePath("/field/collections");
  revalidatePath(`/field/collections/${collectionId}`);

  return {
    success:
      parsed.data.decision === "CONFIRMED"
        ? "Collection confirmed."
        : "Collection rejected. No money has been moved — use the reversal flow if the payment must be undone.",
  };
}
