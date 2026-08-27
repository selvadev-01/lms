"use server";

import {
  uploadApplicationDocumentSchema,
  verifyApplicationDocumentSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";

import {
  call,
  callMultipart,
  endSession,
  type ActionState,
} from "@/lib/api-call";

/**
 * Loan application document mutations (Scenarios 17-20).
 *
 * The upload rebuilds its FormData rather than forwarding what the browser sent.
 * The API runs `forbidNonWhitelisted`, so any stray field a form happened to
 * include — a React action id, a hidden `applicationId` used for routing — would
 * make the whole request a 400. Only the three fields the API declares are
 * forwarded.
 */

const SERVICE = "Loan Applications";
const UNAVAILABLE = `${SERVICE} is temporarily unavailable. Please try again shortly.`;

export async function uploadApplicationDocumentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = formData.get("applicationId");

  if (typeof applicationId !== "string" || !applicationId) {
    return { message: UNAVAILABLE };
  }

  const parsed = uploadApplicationDocumentSchema.safeParse({
    documentType: formData.get("documentType"),
    documentNumber: formData.get("documentNumber"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const file = formData.get("file");

  // Checked here so an empty picker reports against the field rather than
  // travelling to the API to be refused as a malformed multipart body.
  if (!(file instanceof File) || file.size === 0) {
    return { errors: { file: ["Select a file to upload"] } };
  }

  const payload = new FormData();
  payload.set("documentType", parsed.data.documentType);
  if (parsed.data.documentNumber) {
    payload.set("documentNumber", parsed.data.documentNumber);
  }
  payload.set("file", file);

  const outcome = await callMultipart(
    `/loan-applications/${encodeURIComponent(applicationId)}/documents`,
    payload,
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/loans/applications/${applicationId}`);

  return { success: `${parsed.data.documentType} document uploaded.` };
}

/**
 * Verify or reject one document.
 *
 * Uploading is not verifying: a replacement always arrives PENDING, even when it
 * supersedes a verified document, so a rejected pack cannot be re-approved by
 * swapping the file underneath it.
 */
export async function verifyApplicationDocumentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = formData.get("applicationId");
  const documentId = formData.get("documentId");

  if (
    typeof applicationId !== "string" ||
    !applicationId ||
    typeof documentId !== "string" ||
    !documentId
  ) {
    return { message: UNAVAILABLE };
  }

  const parsed = verifyApplicationDocumentSchema.safeParse({
    status: formData.get("status"),
    verificationReason: formData.get("verificationReason"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loan-applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(documentId)}/verify`,
    {
      method: "POST",
      // The API names this field `reason`; the shared schema names it
      // `verificationReason` so the form can report against a field the user
      // recognises. Mapped here rather than renaming either side.
      body: {
        status: parsed.data.status,
        ...(parsed.data.verificationReason
          ? { reason: parsed.data.verificationReason }
          : {}),
      },
    },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/loans/applications/${applicationId}`);

  return {
    success:
      parsed.data.status === "VERIFIED"
        ? "Document verified."
        : "Document rejected.",
  };
}
