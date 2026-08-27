"use server";

import type { RoleDeleteBlocker } from "@lms/types";
import {
  createRoleSchema,
  setRolePermissionsSchema,
  setRoleStatusSchema,
  updateRoleSchema,
} from "@lms/validation";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Role & Permission Management mutations.
 *
 * Grouped in one module because they share an error vocabulary and a response
 * shape, following `branch-actions.ts`.
 */

export interface RoleFormState extends ActionState {
  /** Populated only when a delete was refused because users hold the role. */
  blockedBy?: RoleDeleteBlocker[];
}

const SERVICE = "Role Management";
const MISSING_ID =
  "Role Management is temporarily unavailable. Please try again shortly.";

/** Scenarios 27, 28, 51. */
export async function createRoleAction(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const parsed = createRoleSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    description: formData.get("description"),
    // Repeated checkbox inputs; getAll is what turns them into the array.
    permissions: formData.getAll("permissions"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/roles",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/roles");
  redirect("/roles");
}

/** Scenario 51. */
export async function updateRoleAction(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const roleId = formData.get("roleId");
  if (typeof roleId !== "string" || roleId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = updateRoleSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/roles/${encodeURIComponent(roleId)}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/roles");
  revalidatePath(`/roles/${roleId}`);
  // The role routes are force-dynamic, so they hold no cached entry for
  // revalidatePath to invalidate. refresh() refetches the current route's RSC
  // payload, which is what puts the saved values back on the screen.
  refresh();

  return { success: "Role updated." };
}

/**
 * Assign Module Permissions — Scenarios 29, 38, 39, 52.
 *
 * Sends the complete set rather than a delta, matching the API's PUT semantics.
 * An empty selection is a legitimate submission meaning "revoke everything".
 */
export async function setRolePermissionsAction(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const roleId = formData.get("roleId");
  if (typeof roleId !== "string" || roleId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = setRolePermissionsSchema.safeParse({
    permissions: formData.getAll("permissions"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/roles/${encodeURIComponent(roleId)}/permissions`,
    { method: "PUT", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/roles");
  revalidatePath(`/roles/${roleId}`);
  refresh();

  return { success: "Permissions updated." };
}

/** Save & Activate, and its reverse — Scenarios 30, 41. */
export async function setRoleStatusAction(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const roleId = formData.get("roleId");
  if (typeof roleId !== "string" || roleId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = setRoleStatusSchema.safeParse({
    status: formData.get("status"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/roles/${encodeURIComponent(roleId)}/status`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/roles");
  revalidatePath(`/roles/${roleId}`);
  refresh();

  return {
    success:
      parsed.data.status === "ACTIVE" ? "Role activated." : "Role updated.",
  };
}

/**
 * Scenario 56.
 *
 * A refusal returns `blockedBy` so the dialog can say how many users hold the
 * role and offer deactivation instead.
 */
export async function deleteRoleAction(
  _previous: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const roleId = formData.get("roleId");
  if (typeof roleId !== "string" || roleId.length === 0) {
    return { message: MISSING_ID };
  }

  const outcome = await call(
    `/roles/${encodeURIComponent(roleId)}`,
    { method: "DELETE" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/roles");
  redirect("/roles");
}
