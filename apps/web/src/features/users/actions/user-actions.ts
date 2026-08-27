"use server";

import type { UserDeleteBlocker } from "@lms/types";
import {
  assignRolesSchema,
  createUserSchema,
  setUserStatusSchema,
  updateUserSchema,
} from "@lms/validation";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Admin Management mutations.
 *
 * Separate from `employee-actions.ts` despite addressing the same table, because
 * they post to different routes behind different permissions. Merging them would
 * mean a single action deciding which permission family it needs at runtime,
 * which is exactly the kind of branch that ends up wrong.
 */

export interface UserFormState extends ActionState {
  /** Populated only when a delete was refused — see `deleteUserAction`. */
  blockedBy?: UserDeleteBlocker[];
}

const SERVICE = "Admin Management";
const MISSING_ID =
  "Admin Management is temporarily unavailable. Please try again shortly.";

/** Scenarios 2, 3, 4. */
export async function createUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    mobile: formData.get("mobile"),
    email: formData.get("email"),
    branchId: formData.get("branchId"),
    roleIds: formData.getAll("roleIds"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/users",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/users");
  redirect("/users");
}

/** Scenarios 5, 6, 7. */
export async function updateUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const userId = formData.get("userId");
  if (typeof userId !== "string" || userId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = updateUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/users/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/users");
  revalidatePath(`/users/${userId}`);
  refresh();

  return { success: "User updated." };
}

/** Scenarios 34, 35, 36, 37. */
export async function assignRolesAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const userId = formData.get("userId");
  if (typeof userId !== "string" || userId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = assignRolesSchema.safeParse({
    roleIds: formData.getAll("roleIds"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/users/${encodeURIComponent(userId)}/roles`,
    { method: "PUT", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/users");
  revalidatePath(`/users/${userId}`);
  refresh();

  return { success: "Roles updated." };
}

/**
 * Scenarios 8, 12, 13, 49.
 *
 * Deactivating revokes the target's sessions server-side, and because
 * authorization is re-resolved per request the change takes effect on their very
 * next call rather than at their next sign-in.
 */
export async function setUserStatusAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const userId = formData.get("userId");
  if (typeof userId !== "string" || userId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = setUserStatusSchema.safeParse({
    status: formData.get("status"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/users/${encodeURIComponent(userId)}/status`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/users");
  revalidatePath(`/users/${userId}`);
  refresh();

  return {
    success:
      parsed.data.status === "ACTIVE"
        ? "Account activated."
        : "Account deactivated.",
  };
}

/**
 * Scenario 54.
 *
 * Almost always refused in practice: anyone who has ever signed in is referenced
 * by an audit row and therefore undeletable. The refusal carries `blockedBy` so
 * the dialog can say so and point at deactivation instead.
 */
export async function deleteUserAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const userId = formData.get("userId");
  if (typeof userId !== "string" || userId.length === 0) {
    return { message: MISSING_ID };
  }

  const outcome = await call(
    `/users/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/users");
  redirect("/users");
}
