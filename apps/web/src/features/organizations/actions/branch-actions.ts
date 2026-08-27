"use server";

import type { BranchDeleteBlocker } from "@lms/types";
import {
  createBranchSchema,
  setStatusSchema,
  updateBranchSchema,
} from "@lms/validation";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Branch Management mutations.
 *
 * Grouped in one module because they share an error vocabulary and a response
 * shape; splitting them into five files would mean five copies of the same
 * status-code mapping, which is exactly where a divergence would hide.
 *
 * The request mechanics themselves live in `@/lib/api-call`, shared with every
 * other feature — see that module for why the status codes mean what they do.
 */

export interface BranchFormState extends ActionState {
  /** Populated only when a delete was refused — see `deleteBranchAction`. */
  blockedBy?: BranchDeleteBlocker[];
}

const SERVICE_UNAVAILABLE =
  "Branch Management is temporarily unavailable. Please try again shortly.";

/** This module's name in the shared fallback message. */
const SERVICE = "Branch Management";

function readBranchForm(formData: FormData) {
  return {
    name: formData.get("name"),
    addressLine1: formData.get("addressLine1"),
    addressLine2: formData.get("addressLine2"),
    city: formData.get("city"),
    state: formData.get("state"),
    pincode: formData.get("pincode"),
    phone: formData.get("phone"),
    contactEmail: formData.get("contactEmail"),
  };
}

/** Scenarios 17, 18, 19, 34. */
export async function createBranchAction(
  _previous: BranchFormState,
  formData: FormData,
): Promise<BranchFormState> {
  const parsed = createBranchSchema.safeParse({
    ...readBranchForm(formData),
    code: formData.get("code"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/branches",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/branches");
  redirect("/branches");
}

/** Scenarios 20, 21, 22, 35. */
export async function updateBranchAction(
  _previous: BranchFormState,
  formData: FormData,
): Promise<BranchFormState> {
  const branchId = formData.get("branchId");
  if (typeof branchId !== "string" || branchId.length === 0) {
    return { message: SERVICE_UNAVAILABLE };
  }

  const parsed = updateBranchSchema.safeParse(readBranchForm(formData));

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/branches/${encodeURIComponent(branchId)}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/branches");
  revalidatePath(`/branches/${branchId}`);
  // The branch routes are force-dynamic, so they hold no cached data entry for
  // revalidatePath to invalidate. refresh() refetches the current route's RSC
  // payload, which is what actually puts the saved values back on the screen.
  refresh();
  return { success: "Branch updated." };
}

/** Scenarios 27, 28, 33, 48. */
export async function setBranchStatusAction(
  _previous: BranchFormState,
  formData: FormData,
): Promise<BranchFormState> {
  const branchId = formData.get("branchId");
  if (typeof branchId !== "string" || branchId.length === 0) {
    return { message: SERVICE_UNAVAILABLE };
  }

  const parsed = setStatusSchema.safeParse({
    status: formData.get("status"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/branches/${encodeURIComponent(branchId)}/status`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/branches");
  revalidatePath(`/branches/${branchId}`);
  refresh();

  return {
    success:
      parsed.data.status === "ACTIVE"
        ? "Branch activated."
        : "Branch deactivated.",
  };
}

/**
 * Scenarios 29, 30, 54.
 *
 * A refusal returns `blockedBy` so the dialog can say what is in the way and
 * offer deactivation instead — the story requires directing the user there, and
 * that advice is only actionable if they can see the reason.
 */
export async function deleteBranchAction(
  _previous: BranchFormState,
  formData: FormData,
): Promise<BranchFormState> {
  const branchId = formData.get("branchId");
  if (typeof branchId !== "string" || branchId.length === 0) {
    return { message: SERVICE_UNAVAILABLE };
  }

  const outcome = await call(
    `/branches/${encodeURIComponent(branchId)}`,
    { method: "DELETE" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/branches");
  refresh();
  return { success: "Branch deleted." };
}
