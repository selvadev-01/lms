"use server";

import {
  reviewGuarantorKycSchema,
  submitGuarantorKycSchema,
  verifyGuarantorDocumentSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";

import {
  call,
  callMultipart,
  endSession,
  type ActionState,
} from "@/lib/api-call";

/**
 * Guarantor KYC (Module 05, Scenarios 20-25).
 *
 * Separate from `kyc-actions.ts` throughout, and deliberately so: Scenario 22
 * requires guarantor KYC to be independent of the borrower's, and one shared
 * action family taking an optional `guarantorId` is exactly how the two would
 * end up addressing the same endpoints.
 *
 * Submitting rides on `customers.guarantors.manage`; reviewing needs
 * `customers.guarantors.kyc.review`. The split is what lets a branch assemble a
 * pack it cannot approve itself (Scenario 25).
 */

const SERVICE = "Guarantor KYC";
const MISSING_ID = `${SERVICE} is temporarily unavailable. Please try again shortly.`;

export type GuarantorKycState = ActionState;

function ids(formData: FormData) {
  const customerId = formData.get("customerId");
  const guarantorId = formData.get("guarantorId");

  if (typeof customerId !== "string" || customerId.length === 0) return null;
  if (typeof guarantorId !== "string" || guarantorId.length === 0) return null;

  return { customerId, guarantorId };
}

function revalidateBoth(customerId: string, guarantorId: string): void {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath(`/guarantors/${guarantorId}`);
}

/** Scenario 20 — the file lands unverified whatever it replaces. */
export async function uploadGuarantorDocumentAction(
  _previous: GuarantorKycState,
  formData: FormData,
): Promise<GuarantorKycState> {
  const target = ids(formData);
  if (!target) return { message: MISSING_ID };

  const documentType = formData.get("documentType");
  const file = formData.get("file");

  if (typeof documentType !== "string" || documentType.length === 0) {
    return { errors: { documentType: ["Document Type is required"] } };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { errors: { file: ["Select a file to upload"] } };
  }

  /**
   * Rebuilt rather than forwarded: the incoming `FormData` carries the ids and
   * the React action id, none of which belongs in the API request. The API runs
   * `forbidNonWhitelisted`, so forwarding them verbatim would be a 400.
   */
  const upload = new FormData();
  upload.set("documentType", documentType);
  upload.set("file", file);

  const documentNumber = formData.get("documentNumber");
  if (typeof documentNumber === "string" && documentNumber.trim().length > 0) {
    upload.set("documentNumber", documentNumber.trim());
  }

  const outcome = await callMultipart(
    `/customers/${encodeURIComponent(
      target.customerId,
    )}/guarantors/${encodeURIComponent(target.guarantorId)}/documents`,
    upload,
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateBoth(target.customerId, target.guarantorId);

  return { success: "Document uploaded." };
}

export async function verifyGuarantorDocumentAction(
  _previous: GuarantorKycState,
  formData: FormData,
): Promise<GuarantorKycState> {
  const target = ids(formData);
  if (!target) return { message: MISSING_ID };

  const documentId = formData.get("documentId");
  if (typeof documentId !== "string" || documentId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = verifyGuarantorDocumentSchema.safeParse({
    status: formData.get("status"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(
      target.customerId,
    )}/guarantors/${encodeURIComponent(
      target.guarantorId,
    )}/documents/${encodeURIComponent(documentId)}/verify`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateBoth(target.customerId, target.guarantorId);

  return { success: "Document reviewed." };
}

export async function submitGuarantorKycAction(
  _previous: GuarantorKycState,
  formData: FormData,
): Promise<GuarantorKycState> {
  const target = ids(formData);
  if (!target) return { message: MISSING_ID };

  const parsed = submitGuarantorKycSchema.safeParse({
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(
      target.customerId,
    )}/guarantors/${encodeURIComponent(target.guarantorId)}/kyc/submit`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateBoth(target.customerId, target.guarantorId);

  return { success: "Guarantor KYC submitted for review." };
}

/** Scenarios 21, 23, 24 — approve, reject, or send back for revision. */
export async function reviewGuarantorKycAction(
  _previous: GuarantorKycState,
  formData: FormData,
): Promise<GuarantorKycState> {
  const target = ids(formData);
  if (!target) return { message: MISSING_ID };

  const parsed = reviewGuarantorKycSchema.safeParse({
    decision: formData.get("decision"),
    reason: formData.get("reason"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(
      target.customerId,
    )}/guarantors/${encodeURIComponent(target.guarantorId)}/kyc/review`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidateBoth(target.customerId, target.guarantorId);

  return { success: "Guarantor KYC decision recorded." };
}
