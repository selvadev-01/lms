"use server";

import {
  createGuarantorSchema,
  recordConsentSchema,
  updateGuarantorSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Guarantor mutations (Module 04, Scenarios 24-26).
 *
 * Consent is its own action rather than a field on the guarantor form, matching
 * the API. Recording that someone agreed is a different event from recording who
 * they are, and folding it into the edit form would make it possible to create a
 * guarantor already consenting — an agreement nobody gave.
 */

const SERVICE = "Guarantors";
const MISSING_ID = `${SERVICE} are temporarily unavailable. Please try again shortly.`;

export type GuarantorFormState = ActionState;

function guarantorFields(formData: FormData) {
  return {
    fullName: formData.get("fullName"),
    mobile: formData.get("mobile"),
    address: formData.get("address"),
    relationship: formData.get("relationship"),
  };
}

/**
 * A guarantor already on this customer with the same mobile (Scenario 10).
 *
 * The API answers 409 with this list rather than creating a second row, and the
 * caller confirms by resubmitting with `force`. Surfaced here so the panel can
 * say *who* the match is — a bare "duplicate" would leave staff unable to tell
 * whether they are about to correct a typo or record a second, real person.
 */
export interface GuarantorDuplicate {
  guarantorId: string;
  fullName: string;
  mobile: string;
}

/** Scenario 24. */
export async function createGuarantorAction(
  _previous: GuarantorFormState,
  formData: FormData,
): Promise<GuarantorFormState> {
  const customerId = formData.get("customerId");
  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = createGuarantorSchema.safeParse({
    ...guarantorFields(formData),
    // Scenario 10 — set only when the user has already been shown the match and
    // chosen to continue, so a first submission never silently overrides.
    force: formData.get("force") === "true" ? true : undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}/guarantors`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/customers/${customerId}`);

  return { success: "Guarantor added." };
}

export async function updateGuarantorAction(
  _previous: GuarantorFormState,
  formData: FormData,
): Promise<GuarantorFormState> {
  const customerId = formData.get("customerId");
  const guarantorId = formData.get("guarantorId");

  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }
  if (typeof guarantorId !== "string" || guarantorId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = updateGuarantorSchema.safeParse({
    ...guarantorFields(formData),
    // Scenario 46 — the row's `updatedAt` as the caller last read it. A stale
    // value is refused rather than applied over a change they never saw.
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}/guarantors/${encodeURIComponent(
      guarantorId,
    )}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/customers/${customerId}`);

  return { success: "Guarantor updated." };
}

/** Scenario 25 — the decision and its timestamp. */
export async function recordConsentAction(
  _previous: GuarantorFormState,
  formData: FormData,
): Promise<GuarantorFormState> {
  const customerId = formData.get("customerId");
  const guarantorId = formData.get("guarantorId");

  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }
  if (typeof guarantorId !== "string" || guarantorId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = recordConsentSchema.safeParse({
    consentStatus: formData.get("consentStatus"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}/guarantors/${encodeURIComponent(
      guarantorId,
    )}/consent`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/customers/${customerId}`);

  return { success: "Consent recorded." };
}

export async function deleteGuarantorAction(
  _previous: GuarantorFormState,
  formData: FormData,
): Promise<GuarantorFormState> {
  const customerId = formData.get("customerId");
  const guarantorId = formData.get("guarantorId");

  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }
  if (typeof guarantorId !== "string" || guarantorId.length === 0) {
    return { message: MISSING_ID };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}/guarantors/${encodeURIComponent(
      guarantorId,
    )}`,
    { method: "DELETE" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  if (outcome.kind !== "ok") return { message: MISSING_ID };

  /**
   * Scenarios 32, 55 — a blocked delete is a 200 carrying `deleted: false`, not
   * an error status, matching `CustomerController.remove`. Treating the whole
   * 2xx range as success would report "Guarantor removed" for a guarantor that
   * is still there because a loan refers to them.
   */
  const body = outcome.body as {
    deleted?: boolean;
    message?: string;
    blockedBy?: ActionState["blockedBy"];
  } | null;

  // `!== true` rather than `=== false`, matching `deleteCustomerAction`: a body
  // that failed to parse must not be read as a successful deletion.
  if (body?.deleted !== true) {
    return {
      message:
        body?.message ??
        "This guarantor is referenced by a loan and cannot be deleted. Deactivate them instead.",
      blockedBy: body?.blockedBy,
    };
  }

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/guarantors");

  return { success: "Guarantor removed." };
}
