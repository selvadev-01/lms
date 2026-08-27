"use server";

import {
  deactivateGuarantorSchema,
  reactivateGuarantorSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Guarantor lifecycle (Module 05, Scenarios 28-30).
 *
 * Deactivation rather than deletion is the sanctioned way to withdraw a
 * guarantor once anything references them (Rule 34), so it has its own
 * permission and its own action. It never detaches a historical loan
 * relationship — that is enforced server-side, but the wording here says so too,
 * because a user choosing between "Deactivate" and "Remove" needs to know the
 * first is not a quieter version of the second.
 *
 * Every action revalidates **both** surfaces. A guarantor appears on the
 * customer profile tab and in the standalone directory, and revalidating one
 * would leave the other showing a state that no longer exists.
 */

const SERVICE = "Guarantors";
const MISSING_ID = `${SERVICE} are temporarily unavailable. Please try again shortly.`;

export type GuarantorLifecycleState = ActionState;

function ids(formData: FormData) {
  const customerId = formData.get("customerId");
  const guarantorId = formData.get("guarantorId");

  if (typeof customerId !== "string" || customerId.length === 0) return null;
  if (typeof guarantorId !== "string" || guarantorId.length === 0) return null;

  return { customerId, guarantorId };
}

function revalidateBoth(customerId: string, guarantorId: string): void {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath(`/guarantors/${guarantorId}`);
  revalidatePath("/guarantors");
}

/** Scenario 28. */
export async function deactivateGuarantorAction(
  _previous: GuarantorLifecycleState,
  formData: FormData,
): Promise<GuarantorLifecycleState> {
  const target = ids(formData);
  if (!target) return { message: MISSING_ID };

  const parsed = deactivateGuarantorSchema.safeParse({
    reason: formData.get("reason"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(
      target.customerId,
    )}/guarantors/${encodeURIComponent(target.guarantorId)}/deactivate`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateBoth(target.customerId, target.guarantorId);

  return { success: "Guarantor deactivated." };
}

export async function reactivateGuarantorAction(
  _previous: GuarantorLifecycleState,
  formData: FormData,
): Promise<GuarantorLifecycleState> {
  const target = ids(formData);
  if (!target) return { message: MISSING_ID };

  const parsed = reactivateGuarantorSchema.safeParse({
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(
      target.customerId,
    )}/guarantors/${encodeURIComponent(target.guarantorId)}/reactivate`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateBoth(target.customerId, target.guarantorId);

  return { success: "Guarantor reactivated." };
}
