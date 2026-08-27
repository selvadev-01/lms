"use server";

import type { CustomerDeleteBlocker } from "@lms/types";
import {
  convertCustomerTypeSchema,
  createCustomerSchema,
  setCustomerStatusSchema,
  updateCustomerSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Customer profile mutations (Module 04).
 *
 * Each action posts to a route behind its own permission — create, update,
 * status and convert are four authorities, not one — so they stay four
 * functions rather than one that decides at runtime which it needs.
 *
 * `expectedVersion` is threaded through every edit (Q-CUST-22). The form carries
 * the value it was rendered with, so a stale tab submitting an edit is refused
 * by the server rather than silently overwriting someone else's change.
 */

export interface CustomerFormState extends ActionState {
  /** Populated only when a delete was refused — see `deleteCustomerAction`. */
  blockedBy?: CustomerDeleteBlocker[];
  /**
   * Populated when creation stopped at a possible duplicate (Scenario 5). The
   * form re-renders with these listed and a confirm control that re-submits with
   * `force`, which is what makes the override deliberate rather than automatic.
   */
  duplicateOf?: Array<{
    customerId: string;
    customerCode: string;
    fullName: string;
    status: string;
  }>;
}

const SERVICE = "Customer Management";
const MISSING_ID = `${SERVICE} is temporarily unavailable. Please try again shortly.`;

/** Reads the profile fields shared by create and update. */
function profileFields(formData: FormData) {
  return {
    fullName: formData.get("fullName"),
    mobile: formData.get("mobile"),
    email: formData.get("email"),
    dateOfBirth: formData.get("dateOfBirth"),
    gender: formData.get("gender"),
    addressLine1: formData.get("addressLine1"),
    addressLine2: formData.get("addressLine2"),
    city: formData.get("city"),
    state: formData.get("state"),
    pincode: formData.get("pincode"),
  };
}

/** Scenarios 1-5. */
export async function createCustomerAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const parsed = createCustomerSchema.safeParse({
    ...profileFields(formData),
    customerType: formData.get("customerType"),
    // Only ever set by the confirm control on a flagged duplicate.
    force: formData.get("force") === "true",
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const branchId = formData.get("branchId");

  const outcome = await call(
    "/customers",
    {
      method: "POST",
      body: {
        ...parsed.data,
        // Sent only when the form rendered a branch picker, which happens only
        // for an organization-wide caller. A branch-scoped caller has theirs
        // applied server-side and this is ignored (Scenario 31).
        ...(typeof branchId === "string" && branchId.length > 0
          ? { branchId }
          : {}),
      },
    },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();

  if (outcome.kind === "failed") {
    /**
     * A duplicate arrives as a 409 carrying `duplicateOf`. It is surfaced as
     * data rather than a bare message so the form can name the existing
     * customers and offer a deliberate override — a message alone would leave
     * the user unable to tell which record already exists.
     */
    const body = outcome.state as CustomerFormState;
    return body;
  }

  /**
   * Checked explicitly rather than relying on narrowing past the two branches
   * above: `endSession()` returns `never` at runtime but sits behind an `await`
   * inside an `if`, which TypeScript does not treat as narrowing the union.
   */
  if (outcome.kind !== "ok") return { message: MISSING_ID };

  const created = outcome.body as { customerId?: string } | null;
  revalidatePath("/customers");
  redirect(
    created?.customerId ? `/customers/${created.customerId}` : "/customers",
  );
}

/** Scenarios 23, 41. */
export async function updateCustomerAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const customerId = formData.get("customerId");
  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = updateCustomerSchema.safeParse({
    ...profileFields(formData),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");

  return { success: "Customer details saved." };
}

/** Activation and deactivation — refused for an unverified or unapproved customer. */
export async function setCustomerStatusAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const customerId = formData.get("customerId");
  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = setCustomerStatusSchema.safeParse({
    status: formData.get("status"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}/status`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");

  return {
    success:
      parsed.data.status === "ACTIVE"
        ? "Customer activated."
        : "Customer status updated.",
  };
}

/** Scenarios 27-29 — LOCAL to KYC on the existing record. */
export async function convertCustomerAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const customerId = formData.get("customerId");
  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = convertCustomerTypeSchema.safeParse({
    expectedVersion: formData.get("expectedVersion"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}/convert`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/customers/${customerId}`);

  return {
    success:
      "Customer converted to KYC. Upload the required documents to continue.",
  };
}

/** Scenario 37 — blocked when the customer has financial history. */
export async function deleteCustomerAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const customerId = formData.get("customerId");
  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}`,
    { method: "DELETE" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  if (outcome.kind !== "ok") return { message: MISSING_ID };

  /**
   * The API answers 200 for both outcomes so the blocked and successful shapes
   * are one readable object. A `deleted: false` therefore has to be inspected
   * here — treating any 200 as success would silently report a refused delete as
   * having worked.
   */
  const body = outcome.body as {
    deleted?: boolean;
    message?: string;
    blockedBy?: CustomerDeleteBlocker[];
  } | null;

  if (body?.deleted !== true) {
    return {
      message:
        body?.message ??
        "This customer cannot be deleted. Deactivate them instead.",
      blockedBy: body?.blockedBy,
    };
  }

  revalidatePath("/customers");
  redirect("/customers");
}

/** LOCAL mobile verification (Scenarios 2, 14). */
export async function sendMobileOtpAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const customerId = formData.get("customerId");
  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}/mobile/send-otp`,
    { method: "POST" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  return { success: "Verification code sent to the customer's mobile." };
}

export async function verifyMobileOtpAction(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const customerId = formData.get("customerId");
  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }

  const otp = formData.get("otp");
  if (typeof otp !== "string" || otp.trim().length === 0) {
    return { errors: { otp: ["Enter the verification code"] } };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}/mobile/verify-otp`,
    { method: "POST", body: { otp: otp.trim() } },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/customers/${customerId}`);

  return { success: "Mobile number verified." };
}
