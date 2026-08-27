"use server";

import { revalidatePath } from "next/cache";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Offline sync queue mutations (Module 12).
 *
 * Re-queuing does **not** re-post the collection. The stored payload was
 * captured by a device and the server does not trust it as a posting request —
 * replaying it would bypass the DTO validation, the scope checks and the
 * eligibility gates that the sync endpoint applies. This signals "try this
 * again"; the capture then posts through `/field/collections/sync`, where all
 * of that runs.
 */

const SERVICE = "Sync Queue";

const UNAVAILABLE = {
  message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
};

export async function retrySyncItemAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const value = formData.get("syncItemId");
  const syncItemId = typeof value === "string" && value ? value : null;
  if (!syncItemId) return UNAVAILABLE;

  const outcome = await call(
    `/field/sync-items/${encodeURIComponent(syncItemId)}/retry`,
    { method: "POST" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/field/sync-queue");

  return { success: "Item re-queued. The device can submit it again." };
}
