"use server";

import type { CompletenessCheck } from "@lms/types";
import {
  acceptSanctionSchema,
  approveApplicationSchema,
  createLoanApplicationSchema,
  declineSanctionSchema,
  issueSanctionSchema,
  modifyTermsSchema,
  recordAgreementSchema,
  rejectApplicationSchema,
  requestMoreInfoSchema,
  updateLoanApplicationSchema,
} from "@lms/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, endSession, type ActionState } from "@/lib/api-call";

/**
 * Loan application mutations (Module 07).
 *
 * Each lifecycle step posts to a route behind its own permission — create,
 * submit, review, modify_terms, approve and reject are six authorities, not one
 * — so they stay six functions rather than one that decides at runtime which it
 * needs.
 *
 * `expectedVersion` is threaded through every mutation. The form carries the
 * value it was rendered with, so a reviewer acting on a stale screen is refused
 * rather than silently overwriting someone else's decision (Scenario 52).
 */

export interface ApplicationFormState extends ActionState {
  /**
   * Populated when a submit was refused by the completeness gate. The form
   * re-renders naming each failed check, which is what Scenario 18 asks for —
   * "prevents submission and identifies the missing documents".
   */
  failedChecks?: CompletenessCheck[];
}

const SERVICE = "Loan Applications";

/** Reads the terms shared by create and edit. */
function termFields(formData: FormData) {
  return {
    loanSchemeId: formData.get("loanSchemeId"),
    requestedAmountPaise: formData.get("requestedAmountPaise"),
    purpose: formData.get("purpose"),
    interestType: formData.get("interestType"),
    interestRateBps: formData.get("interestRateBps"),
    repaymentFrequency: formData.get("repaymentFrequency"),
    durationCount: formData.get("durationCount"),
  };
}

/**
 * Reads the 409 body the API returns when the completeness gate refuses.
 *
 * Typed narrowly rather than cast: the body is whatever the API sent, and
 * asserting a shape onto it would turn a changed contract into a runtime crash
 * inside a render instead of a missing list.
 */
function failedChecksFrom(state: ActionState): CompletenessCheck[] | undefined {
  const body = (state as { checks?: unknown }).checks;

  return Array.isArray(body) ? (body as CompletenessCheck[]) : undefined;
}

/** Wizard steps 1-3 (Scenario 5). Creates a DRAFT. */
export async function createApplicationAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const parsed = createLoanApplicationSchema.safeParse({
    customerId: formData.get("customerId"),
    ...termFields(formData),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    "/loan-applications",
    { method: "POST", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  // `endSession` returns `never`, but TS narrows on the discriminant rather than
  // on that, so the "session-ended" arm is still in the union here. Read the
  // body through a widened alias rather than restructuring the two guards, which
  // every other feature's actions share.
  const created = (outcome as { body?: unknown }).body as {
    applicationId?: string;
  };

  if (!created.applicationId) {
    return {
      message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
    };
  }

  revalidatePath("/loans/applications");
  // Redirect rather than return: the draft now exists, and leaving the user on
  // the create form would invite a second submission of the same application.
  redirect(`/loans/applications/${created.applicationId}`);
}

/** Scenario 14. Draft edits only; a submitted application uses Modify Terms. */
export async function updateApplicationAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const applicationId = formData.get("applicationId");

  if (typeof applicationId !== "string" || !applicationId) {
    return {
      message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
    };
  }

  const parsed = updateLoanApplicationSchema.safeParse({
    ...termFields(formData),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const outcome = await call(
    `/loan-applications/${encodeURIComponent(applicationId)}`,
    { method: "PATCH", body: parsed.data },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/loans/applications/${applicationId}`);

  return { success: "Application updated." };
}

/**
 * Submit, or return a MORE_INFO application to review (Scenarios 5, 21, 23).
 *
 * A refusal here is not a validation error on any one field — it is the gate
 * naming what is still outstanding — so the failed checks are surfaced rather
 * than collapsed into a single message.
 */
export async function submitApplicationAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const state = await transition(formData, "submit", {
    expectedVersion: formData.get("expectedVersion"),
  });

  if (state.message && !state.success) {
    const checks = failedChecksFrom(state);
    if (checks) return { ...state, failedChecks: checks };
  }

  return state.success
    ? { success: "Application submitted for review." }
    : state;
}

/** T4 — an explicit claim on the application. */
export async function startReviewAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const state = await transition(formData, "start-review", {
    expectedVersion: formData.get("expectedVersion"),
  });

  return state.success ? { success: "Review started." } : state;
}

/** T5 — Scenario 22. */
export async function requestMoreInfoAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const parsed = requestMoreInfoSchema.safeParse({
    comments: formData.get("comments"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const state = await transition(formData, "request-info", parsed.data);

  return state.success
    ? { success: "More information requested from the branch." }
    : state;
}

/** T7 — Scenario 16. Recalculates the EMI server-side before storing. */
export async function modifyTermsAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const parsed = modifyTermsSchema.safeParse({
    interestType: formData.get("interestType"),
    interestRateBps: formData.get("interestRateBps"),
    repaymentFrequency: formData.get("repaymentFrequency"),
    durationCount: formData.get("durationCount"),
    comments: formData.get("comments"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const state = await transition(formData, "modify-terms", parsed.data);

  return state.success
    ? { success: "Terms updated and EMI recalculated." }
    : state;
}

/** T8 — Scenario 25. Approval does not disburse. */
export async function approveApplicationAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const parsed = approveApplicationSchema.safeParse({
    comments: formData.get("comments"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const state = await transition(formData, "approve", parsed.data);

  return state.success ? { success: "Application approved." } : state;
}

/** T9/T10 — Scenarios 26, 27. The reason is mandatory and is the record. */
export async function rejectApplicationAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const parsed = rejectApplicationSchema.safeParse({
    rejectionReason: formData.get("rejectionReason"),
    comments: formData.get("comments"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const state = await transition(formData, "reject", parsed.data);

  return state.success ? { success: "Application rejected." } : state;
}

// --- Module 08: sanction, customer response and agreement --------------------
//
// The verbs below carry a slash ("sanction/accept"). `transition` interpolates
// `action` into the path unescaped, so a nested route works exactly as a flat
// one does — only `applicationId` is encoded, which is the part that comes from
// data rather than from this file.

/** T11 — Scenario 30. Terms are snapshotted server-side, never sent. */
export async function issueSanctionAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const parsed = issueSanctionSchema.safeParse({
    validUntil: formData.get("validUntil"),
    notes: formData.get("notes"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const state = await transition(formData, "sanction", parsed.data);

  return state.success ? { success: "Sanction letter issued." } : state;
}

/**
 * T8 and T11 together, for a caller who may do both.
 *
 * Reuses `issueSanctionSchema` because the combined body is the sanction's
 * fields plus optional approval comments — validating against a second schema
 * that said the same thing would be one more place to keep in step. The API
 * requires both permissions, so this adds no authority; the separate Approve and
 * Issue buttons remain for anyone holding only one of them.
 */
export async function approveAndSanctionAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const parsed = issueSanctionSchema.safeParse({
    validUntil: formData.get("validUntil"),
    notes: formData.get("notes"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const state = await transition(formData, "approve-and-sanction", {
    ...parsed.data,
    comments: formData.get("comments"),
  });

  return state.success
    ? { success: "Application approved and sanction letter issued." }
    : state;
}

/** T12 — Scenario 33. Recording what the customer answered, not deciding it. */
export async function acceptSanctionAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const parsed = acceptSanctionSchema.safeParse({
    comments: formData.get("comments"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const state = await transition(formData, "sanction/accept", parsed.data);

  return state.success ? { success: "Customer acceptance recorded." } : state;
}

/**
 * T13 — Scenario 32. The application becomes REJECTED, not a separate
 * "customer rejected" state (Rule 13), so the message says so plainly rather
 * than implying a status the system does not have.
 */
export async function declineSanctionAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const parsed = declineSanctionSchema.safeParse({
    declineReason: formData.get("declineReason"),
    comments: formData.get("comments"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const state = await transition(formData, "sanction/decline", parsed.data);

  return state.success
    ? { success: "Customer decline recorded. The application is now rejected." }
    : state;
}

/** T14 — Scenario 33. Recording receipt of a signed agreement; not disbursal. */
export async function recordAgreementAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const parsed = recordAgreementSchema.safeParse({
    signedDate: formData.get("signedDate"),
    agreementReference: formData.get("agreementReference"),
    comments: formData.get("comments"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const state = await transition(formData, "agreement", parsed.data);

  return state.success ? { success: "Signed agreement recorded." } : state;
}

/** Scenario 36. Only an unreferenced draft; the API refuses anything else. */
export async function deleteDraftAction(
  _previous: ApplicationFormState,
  formData: FormData,
): Promise<ApplicationFormState> {
  const applicationId = formData.get("applicationId");

  if (typeof applicationId !== "string" || !applicationId) {
    return {
      message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
    };
  }

  const outcome = await call(
    `/loan-applications/${encodeURIComponent(applicationId)}`,
    { method: "DELETE" },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath("/loans/applications");
  redirect("/loans/applications");
}

/**
 * The one request shape every lifecycle step goes through.
 *
 * Centralised so the id handling and the revalidation cannot be written
 * correctly in five places and wrongly in a sixth.
 */
async function transition(
  formData: FormData,
  action: string,
  body: unknown,
): Promise<ApplicationFormState> {
  const applicationId = formData.get("applicationId");

  if (typeof applicationId !== "string" || !applicationId) {
    return {
      message: `${SERVICE} is temporarily unavailable. Please try again shortly.`,
    };
  }

  const outcome = await call(
    `/loan-applications/${encodeURIComponent(applicationId)}/${action}`,
    { method: "POST", body },
    SERVICE,
  );

  if (outcome.kind === "session-ended") await endSession();
  if (outcome.kind === "failed") return outcome.state;

  revalidatePath(`/loans/applications/${applicationId}`);
  revalidatePath("/loans/applications");

  return { success: "Done." };
}
