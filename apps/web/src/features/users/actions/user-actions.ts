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
  /**
   * The credential to hand to the new user, returned once and never stored.
   *
   * Present only when the administrator set a password. It lives in this action
   * result for exactly one render — there is no route to fetch it back, and a
   * refresh loses it — because the server keeps only the argon2 hash. That is
   * the intended shape: the password exists in the open for as long as it takes
   * to pass it on, and no longer.
   */
  credential?: { mobile: string; password: string };
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
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  // `confirmPassword` is dropped: it is a typo-catcher for the person typing,
  // and the API has no such field.
  const { confirmPassword: _confirmPassword, ...body } = parsed.data;

  const outcome = await call("/users", { method: "POST", body }, SERVICE);

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/users");

  // A password the administrator set has to be shown before leaving the page,
  // so the redirect is skipped and the list is reached from the panel instead.
  // Without a password there is nothing to hand over and nothing to pause for.
  if (body.password) {
    return {
      credential: { mobile: body.mobile, password: body.password },
    };
  }

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
