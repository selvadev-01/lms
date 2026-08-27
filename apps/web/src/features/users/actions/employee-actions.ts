"use server";

import type { UserDeleteBlocker } from "@lms/types";
import {
  assignEmployeeSchema,
  createEmployeeSchema,
  setUserStatusSchema,
  updateEmployeeSchema,
} from "@lms/validation";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Employee Management mutations — the source-defined Add / Assign / Deactivate.
 *
 * Separate from `user-actions.ts` because they post to `/employees` behind the
 * `employees.*` permission family. A Branch Admin may hold those and not the
 * `users.*` ones, which is the whole reason the two surfaces exist.
 */

export interface EmployeeFormState extends ActionState {
  blockedBy?: UserDeleteBlocker[];
}

const SERVICE = "Employee Management";
const MISSING_ID =
  "Employee Management is temporarily unavailable. Please try again shortly.";

/** Scenarios 15, 16. */
export async function createEmployeeAction(
  _previous: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const parsed = createEmployeeSchema.safeParse({
    name: formData.get("name"),
    mobile: formData.get("mobile"),
    email: formData.get("email"),
    employeeCode: formData.get("employeeCode"),
    branchId: formData.get("branchId"),
    roleIds: formData.getAll("roleIds"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/employees",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/employees");
  redirect("/employees");
}

/** Scenarios 5, 25. */
export async function updateEmployeeAction(
  _previous: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const userId = formData.get("userId");
  if (typeof userId !== "string" || userId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = updateEmployeeSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/employees/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/employees");
  revalidatePath(`/employees/${userId}`);
  refresh();

  return { success: "Employee updated." };
}

/**
 * "Assign" — Scenarios 17, 18, 19, 50.
 *
 * Only the branch moves. Historical collections and assignments keep the branch
 * they were recorded under, which is why the API captures the old value.
 */
export async function assignEmployeeAction(
  _previous: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const userId = formData.get("userId");
  if (typeof userId !== "string" || userId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = assignEmployeeSchema.safeParse({
    branchId: formData.get("branchId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/employees/${encodeURIComponent(userId)}/assignment`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/employees");
  revalidatePath(`/employees/${userId}`);
  refresh();

  return { success: "Employee reassigned." };
}

/** Scenarios 10, 11, 20, 21, 53. */
export async function setEmployeeStatusAction(
  _previous: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
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
    `/employees/${encodeURIComponent(userId)}/status`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/employees");
  revalidatePath(`/employees/${userId}`);
  refresh();

  return {
    success:
      parsed.data.status === "ACTIVE"
        ? "Employee activated."
        : "Employee deactivated.",
  };
}

/** Scenario 55 — refused whenever collection history exists. */
export async function deleteEmployeeAction(
  _previous: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const userId = formData.get("userId");
  if (typeof userId !== "string" || userId.length === 0) {
    return { message: MISSING_ID };
  }

  const outcome = await call(
    `/employees/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/employees");
  redirect("/employees");
}
