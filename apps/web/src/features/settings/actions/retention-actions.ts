"use server";

import { revalidatePath } from "next/cache";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Module 17 — data retention policies (Scenarios 55-58).
 *
 * # `immutableEvidence` is never sent
 *
 * The API derives it from the record category and would reject it as an
 * unrecognised property anyway (the global pipe runs `forbidNonWhitelisted`).
 * Sending it would also be the wrong shape of trust: whether ledger evidence is
 * purgeable is not a client decision (Rule 76).
 *
 * # Day counts are parsed, not coerced silently
 *
 * An empty box means "not set" and is sent as `null`; a non-numeric entry is
 * refused here rather than being sent as `NaN`, which would serialize to `null`
 * and silently store "never purge" when the user typed something they expected
 * to take effect.
 */

const SERVICE = "Retention";

function revalidateRetention(): void {
  revalidatePath("/admin/settings/retention");
}

/**
 * Optional whole-day count from a form field.
 *
 * Returns `undefined` for "leave unset" and `null` for "explicitly cleared" —
 * the API treats those differently on update, so collapsing them would make a
 * cleared field indistinguishable from an untouched one.
 */
function optionalDays(
  raw: FormDataEntryValue | null,
): { ok: true; value: number | null } | { ok: false } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, value: null };

  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) return { ok: false };
  return { ok: true, value: parsed };
}

export async function createRetentionPolicyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const recordCategory = String(formData.get("recordCategory") ?? "");
  const retentionRaw = String(formData.get("retentionPeriodDays") ?? "").trim();

  if (!name) return { errors: { name: ["Policy Name is required"] } };
  if (!recordCategory) {
    return { errors: { recordCategory: ["Choose a record category"] } };
  }

  const retentionPeriodDays = Number(retentionRaw);
  if (!Number.isInteger(retentionPeriodDays) || retentionPeriodDays < 1) {
    return {
      errors: {
        retentionPeriodDays: ["Retention Period must be at least one day"],
      },
    };
  }

  const archive = optionalDays(formData.get("archiveAfterDays"));
  if (!archive.ok) {
    return {
      errors: { archiveAfterDays: ["Archive After must be a whole number of days"] },
    };
  }

  const purge = optionalDays(formData.get("purgeAfterDays"));
  if (!purge.ok) {
    return {
      errors: { purgeAfterDays: ["Purge After must be a whole number of days"] },
    };
  }

  const outcome = await call(
    "/retention/policies",
    {
      method: "POST",
      body: {
        name,
        recordCategory,
        retentionPeriodDays,
        archiveAfterDays: archive.value,
        purgeAfterDays: purge.value,
        legalHoldSupported: formData.get("legalHoldSupported") === "on",
      },
    },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  // The cross-field rules (purge before retention, a purge schedule on
  // immutable evidence) are refused server-side with a message naming the field
  // to change, so it is passed through rather than restated here.
  if (outcome.kind === "failed") return outcome.state;

  revalidateRetention();
  return { success: `Retention policy "${name}" created.` };
}

export async function updateRetentionPolicyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const retentionPolicyId = String(formData.get("retentionPolicyId") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion") ?? 0);

  if (!retentionPolicyId) return { message: "Select a retention policy." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { errors: { name: ["Policy Name cannot be blank"] } };

  const retentionPeriodDays = Number(
    String(formData.get("retentionPeriodDays") ?? "").trim(),
  );
  if (!Number.isInteger(retentionPeriodDays) || retentionPeriodDays < 1) {
    return {
      errors: {
        retentionPeriodDays: ["Retention Period must be at least one day"],
      },
    };
  }

  const archive = optionalDays(formData.get("archiveAfterDays"));
  if (!archive.ok) {
    return {
      errors: { archiveAfterDays: ["Archive After must be a whole number of days"] },
    };
  }

  const purge = optionalDays(formData.get("purgeAfterDays"));
  if (!purge.ok) {
    return {
      errors: { purgeAfterDays: ["Purge After must be a whole number of days"] },
    };
  }

  const outcome = await call(
    `/retention/policies/${retentionPolicyId}`,
    {
      method: "PATCH",
      body: {
        name,
        retentionPeriodDays,
        archiveAfterDays: archive.value,
        purgeAfterDays: purge.value,
        legalHoldSupported: formData.get("legalHoldSupported") === "on",
        expectedVersion,
      },
    },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateRetention();
  return { success: `Retention policy "${name}" saved.` };
}

/**
 * Activate or deactivate (Scenarios 55, 57).
 *
 * Deactivation is the sanctioned way to retire a policy that has governed
 * processing, so this is offered wherever deletion is not.
 */
export async function setRetentionPolicyStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const retentionPolicyId = String(formData.get("retentionPolicyId") ?? "");
  const status = String(formData.get("status") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion") ?? 0);

  if (!retentionPolicyId) return { message: "Select a retention policy." };
  if (status !== "ACTIVE" && status !== "INACTIVE") {
    return { message: "Choose whether to activate or deactivate." };
  }

  const outcome = await call(
    `/retention/policies/${retentionPolicyId}`,
    { method: "PATCH", body: { status, expectedVersion } },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  // A 409 here is the partial unique index refusing a second ACTIVE policy for
  // the category — the server explains that better than this layer could.
  if (outcome.kind === "failed") return outcome.state;

  revalidateRetention();
  return {
    success:
      status === "ACTIVE"
        ? "Retention policy activated."
        : "Retention policy deactivated. It no longer governs new processing.",
  };
}

export async function deleteRetentionPolicyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const retentionPolicyId = String(formData.get("retentionPolicyId") ?? "");
  if (!retentionPolicyId) return { message: "Select a retention policy." };

  const outcome = await call(
    `/retention/policies/${retentionPolicyId}`,
    { method: "DELETE" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  // Scenario 56: a referenced policy comes back as a 409 naming deactivation as
  // the alternative. Passed through, because a generic "could not delete" would
  // leave the user believing the policy is stuck.
  if (outcome.kind === "failed") return outcome.state;

  revalidateRetention();
  return { success: "Retention policy deleted." };
}
