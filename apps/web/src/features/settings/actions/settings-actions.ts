"use server";

import { getSettingDefinition, rejectChangeSchema } from "@lms/validation";
import { revalidatePath } from "next/cache";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Module 17 — settings and configuration governance.
 *
 * # The value is not parsed here
 *
 * Every other action file in this app parses its form with a zod schema before
 * calling the API. This one deliberately does not parse `value`: what is legal
 * depends on the setting CODE, and the registry's per-code schema is the only
 * thing that knows. Sending it through and letting the server decide keeps ONE
 * definition of validity rather than a copy here that could drift looser.
 *
 * The mandatory fields around it — a change reason, a rejection reason — are
 * still checked here so the user sees them without a round trip.
 *
 * # An approval-gated setting returns a change request, not a saved value
 *
 * `upsertSettingAction` reports which happened. A UI that said "Saved" for a
 * change awaiting approval would tell the user their configuration is effective
 * when the previous value is still the one in force (Scenario 9).
 */

const SERVICE = "Settings";

function revalidateSettings(): void {
  revalidatePath("/admin/settings/organization");
  revalidatePath("/admin/settings/branch");
  revalidatePath("/admin/settings/changes");
}

export async function upsertSettingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const settingCode = String(formData.get("settingCode") ?? "");
  const changeReason = String(formData.get("changeReason") ?? "").trim();
  const rawValue = formData.get("value");
  const rawVersion = formData.get("expectedVersion");
  const rawBranch = formData.get("branchId");

  const definition = getSettingDefinition(settingCode);
  if (!definition) {
    return { errors: { settingCode: ["That setting is not supported"] } };
  }
  if (!changeReason) {
    return { errors: { changeReason: ["Change Reason is required"] } };
  }

  // A BOOLEAN setting's unchecked checkbox sends nothing at all. Passing `null`
  // would be a value; passing `false` is what "unchecked" means.
  const value =
    definition.valueType === "BOOLEAN"
      ? rawValue === "on" || rawValue === "true"
      : (rawValue ?? "");

  const outcome = await call(
    "/settings",
    {
      method: "PUT",
      body: {
        settingCode,
        value,
        changeReason,
        ...(rawBranch ? { branchId: String(rawBranch) } : {}),
        ...(rawVersion ? { expectedVersion: Number(rawVersion) } : {}),
      },
    },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateSettings();

  // `body` exists only on the ok branch; the failure paths returned above.
  const raised =
    outcome.kind === "ok"
      ? (outcome.body as { changeRequestId?: string } | undefined)?.changeRequestId
      : undefined;

  return {
    success: raised
      ? `Submitted for approval. "${definition.name}" keeps its current value until a second administrator approves the change.`
      : `Saved "${definition.name}".`,
  };
}

export async function setSettingStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const settingId = String(formData.get("settingId") ?? "");
  const status = String(formData.get("status") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion") ?? 0);

  if (!settingId) return { message: "Select a setting to change." };
  if (status !== "ACTIVE" && status !== "INACTIVE") {
    return { message: "Choose whether to activate or deactivate." };
  }

  const outcome = await call(
    `/settings/${settingId}/status`,
    { method: "PATCH", body: { status, expectedVersion } },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateSettings();
  return {
    success: status === "ACTIVE" ? "Setting activated." : "Setting deactivated.",
  };
}

export async function approveChangeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const changeRequestId = String(formData.get("changeRequestId") ?? "");
  if (!changeRequestId) return { message: "Select a change request." };

  const outcome = await call(
    `/settings/changes/${changeRequestId}/approve`,
    { method: "POST", body: {} },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  // A 403 here is the maker-checker refusal (Scenario 11) and a 409 is an
  // apply-time failure (Scenario 63). Both carry the server's own message,
  // which explains the refusal better than anything this layer could invent.
  if (outcome.kind === "failed") return outcome.state;

  revalidateSettings();
  return { success: "Change approved and applied." };
}

export async function rejectChangeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const changeRequestId = String(formData.get("changeRequestId") ?? "");
  if (!changeRequestId) return { message: "Select a change request." };

  const parsed = rejectChangeSchema.safeParse({
    rejectionReason: formData.get("rejectionReason"),
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/settings/changes/${changeRequestId}/reject`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateSettings();
  return { success: "Change rejected. The previous configuration stands." };
}

export async function cancelChangeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const changeRequestId = String(formData.get("changeRequestId") ?? "");
  if (!changeRequestId) return { message: "Select a change request." };

  const outcome = await call(
    `/settings/changes/${changeRequestId}/cancel`,
    { method: "POST", body: {} },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateSettings();
  return { success: "Change request withdrawn." };
}
