"use server";

import { reviewKycSchema, verifyDocumentSchema } from "@lms/validation";
import { revalidatePath } from "next/cache";

import {
  call,
  callMultipart,
  endSession,
  type ActionState,
} from "@/lib/api-call";

/**
 * KYC review and document mutations (Module 04, Scenarios 6-12).
 *
 * Submit and review are separate actions behind separate permissions, because
 * they are separate authorities: a clerk assembles the pack, a Branch Admin
 * decides (Rule 9). Collapsing them into one action would make the
 * source-named approval authority unenforceable from the UI.
 *
 * The upload action is the only place in the app that sends bytes, and it uses
 * `callMultipart` rather than `call` — the file has to reach the server as
 * multipart, and re-encoding it as JSON would both inflate it and lose the
 * filename.
 */

const SERVICE = "Customer KYC";
const MISSING_ID = `${SERVICE} is temporarily unavailable. Please try again shortly.`;

export type KycFormState = ActionState;

/** Scenario 6 — the assembled pack goes to review. */
export async function submitKycAction(
  _previous: KycFormState,
  formData: FormData,
): Promise<KycFormState> {
  const customerId = formData.get("customerId");
  const expectedVersion = formData.get("expectedVersion");

  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }
  if (typeof expectedVersion !== "string" || expectedVersion.length === 0) {
    return { message: MISSING_ID };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}/kyc/submit`,
    { method: "POST", body: { expectedVersion } },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/customers/${customerId}`);

  return { success: "KYC submitted for review." };
}

/**
 * Scenarios 8, 9 — approve, reject, or return for revision.
 *
 * One action for all three, matching the API: they are one transition with
 * different outcomes and share every precondition. The schema enforces that a
 * revision or rejection carries a reason.
 */
export async function reviewKycAction(
  _previous: KycFormState,
  formData: FormData,
): Promise<KycFormState> {
  const customerId = formData.get("customerId");
  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = reviewKycSchema.safeParse({
    decision: formData.get("decision"),
    reason: formData.get("reason"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}/kyc/review`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");

  const message =
    parsed.data.decision === "APPROVE"
      ? "KYC approved. The customer is now active."
      : parsed.data.decision === "REJECT"
        ? "KYC rejected."
        : "Returned for revision.";

  return { success: message };
}

/** Scenarios 6, 11 — upload, or replace with a new version. */
export async function uploadDocumentAction(
  _previous: KycFormState,
  formData: FormData,
): Promise<KycFormState> {
  const customerId = formData.get("customerId");
  const documentType = formData.get("documentType");
  const file = formData.get("file");

  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }
  if (typeof documentType !== "string" || documentType.length === 0) {
    return { errors: { documentType: ["Document Type is required"] } };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { errors: { file: ["Select a file to upload"] } };
  }

  /**
   * Rebuilt rather than forwarded: the incoming `FormData` carries `customerId`
   * and the React action id, neither of which belongs in the API request. The
   * API runs `forbidNonWhitelisted`, so forwarding them verbatim would be a 400.
   */
  const upload = new FormData();
  upload.set("documentType", documentType);
  upload.set("file", file);

  const documentNumber = formData.get("documentNumber");
  if (typeof documentNumber === "string" && documentNumber.trim().length > 0) {
    upload.set("documentNumber", documentNumber.trim());
  }

  const outcome = await callMultipart(
    `/customers/${encodeURIComponent(customerId)}/documents`,
    upload,
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/customers/${customerId}`);

  return { success: `${documentType} document uploaded.` };
}

/** Per-document review, independent of the overall KYC decision. */
export async function verifyDocumentAction(
  _previous: KycFormState,
  formData: FormData,
): Promise<KycFormState> {
  const customerId = formData.get("customerId");
  const documentId = formData.get("documentId");

  if (typeof customerId !== "string" || customerId.length === 0) {
    return { message: MISSING_ID };
  }
  if (typeof documentId !== "string" || documentId.length === 0) {
    return { message: MISSING_ID };
  }

  const parsed = verifyDocumentSchema.safeParse({
    status: formData.get("status"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/customers/${encodeURIComponent(customerId)}/documents/${encodeURIComponent(
      documentId,
    )}/verify`,
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/customers/${customerId}`);

  return {
    success:
      parsed.data.status === "VERIFIED"
        ? "Document verified."
        : "Document rejected.",
  };
}
