"use server";

import {
  createMasterDataValueSchema,
  updateMasterDataValueSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Master data mutations — the admin-maintained option lists.
 *
 * Super-Admin-only in practice: `master_data.manage` is deliberately withheld
 * from Branch Admin, because an option list is organization-wide configuration
 * and one branch must not reshape what every other branch can select. A Branch
 * Admin reaching these forms is refused by the server, not merely hidden from
 * the button.
 *
 * Every action revalidates the settings page rather than redirecting: the admin
 * screen is a list the user stays on while making several edits in a row, so
 * navigating away after each one would be the wrong shape.
 */

const SERVICE = "Master Data";

/** Keeps the list the user is looking at in step with what they just changed. */
function revalidateSettings(): void {
  revalidatePath("/settings/master-data");
}

export async function createMasterDataValueAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rawOrder = formData.get("displayOrder");

  const parsed = createMasterDataValueSchema.safeParse({
    category: formData.get("category"),
    code: formData.get("code"),
    label: formData.get("label"),
    // An empty input means "no preference", not zero. Coercing `""` would make
    // every blank submission sort to the top of the list.
    ...(rawOrder === null || rawOrder === "" ? {} : { displayOrder: rawOrder }),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/master-data",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateSettings();
  return { success: `Added "${parsed.data.label}".` };
}

export async function updateMasterDataValueAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const valueId = String(formData.get("valueId") ?? "");
  if (!valueId) {
    return { message: "Select a value to edit." };
  }

  const rawOrder = formData.get("displayOrder");
  const rawLabel = formData.get("label");
  const rawStatus = formData.get("status");

  // Only the fields actually submitted are sent. A form that posts one control
  // must not blank the others by sending them as undefined.
  const parsed = updateMasterDataValueSchema.safeParse({
    ...(rawLabel === null ? {} : { label: rawLabel }),
    ...(rawOrder === null || rawOrder === "" ? {} : { displayOrder: rawOrder }),
    ...(rawStatus === null ? {} : { status: rawStatus }),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/master-data/${encodeURIComponent(valueId)}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateSettings();
  return { success: "Saved." };
}

/**
 * Delete a value.
 *
 * A seeded row comes back as a 409 carrying the server's message, which names
 * deactivation as the alternative. That message is surfaced as-is rather than
 * replaced: the server is the authority on why the refusal happened.
 */
export async function deleteMasterDataValueAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const valueId = String(formData.get("valueId") ?? "");
  if (!valueId) {
    return { message: "Select a value to delete." };
  }

  const outcome = await call(
    `/master-data/${encodeURIComponent(valueId)}`,
    { method: "DELETE" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateSettings();
  return { success: "Deleted." };
}
